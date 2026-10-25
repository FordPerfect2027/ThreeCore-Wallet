import { observeCallbackResult } from "./security-callback.js";

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
