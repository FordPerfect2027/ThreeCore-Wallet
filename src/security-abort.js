import { observeCallbackResult, consumeCallback } from "./security-callback.js";

// Native state remains authoritative if an instance property shadows `aborted`.
// Duck-typed adapters remain supported for hosts without AbortSignal and tests.
const nativeAborted = typeof globalThis.AbortSignal === "function" ?
  Object.getOwnPropertyDescriptor(globalThis.AbortSignal.prototype, "aborted")?.get : null;

export function readAbortState(signal) {
  if (signal == null) return false;
  if (nativeAborted) {
    try { return Reflect.apply(nativeAborted, signal, []); }
    catch { /* A non-native signal must supply a synchronous boolean itself. */ }
  }
  const value = signal.aborted;
  observeCallbackResult(value);
  return typeof value === "boolean" ? value : undefined;
}

const nativeAddListener = EventTarget.prototype.addEventListener;
const nativeRemoveListener = EventTarget.prototype.removeEventListener;

/**
 * Read APIs accept native AbortSignals, not arbitrary cancellation adapters.
 * Own getters/methods must not hide cancellation or replace a completed result.
 * A manually dispatched event is insufficient: the native aborted state decides.
 * Captured intrinsics assume an uncompromised realm at module initialization.
 */
export function subscribeReadAbort(signal, onAbort) {
  if (signal === undefined) return Object.freeze({ aborted: () => false, dispose() {} });
  if (!(signal instanceof AbortSignal) || typeof onAbort !== "function") throw new TypeError("Invalid read signal");
  const aborted = () => Reflect.apply(nativeAborted, signal, []);
  aborted(); // Native brand/state check before acquiring a listener.
  let closed = false;
  const dispose = () => {
    if (closed) return;
    closed = true;
    consumeCallback(() => Reflect.apply(nativeRemoveListener, signal, ["abort", listener]));
  };
  const listener = () => {
    if (closed || !aborted()) return;
    dispose();
    onAbort();
  };
  try {
    // Do not use once: an artificial event must not consume real cancellation.
    Reflect.apply(nativeAddListener, signal, ["abort", listener]);
    listener();
    return Object.freeze({ aborted, dispose });
  } catch (error) {
    dispose();
    throw error;
  }
}
