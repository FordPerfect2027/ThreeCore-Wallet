import { readPortfolioSnapshot } from "./portfolio-snapshot.js";
import { createStateNotifier } from "./state-notifier.js";
import { captureDataArray, captureOptionalDataFields } from "./security-data.js";
import { readOwnErrorCode } from "./provider-error.js";

/**
 * Local-only operation controller. Connecting remains a separate explicit UI
 * action. A newer refresh cancels the previous local wait; stale completion
 * cannot replace the current view. No keys or wallet accounts are persisted.
 */
export function createPortfolioController({ reader = readPortfolioSnapshot } = {}) {
  if (typeof reader !== "function") throw TypeError("Expected a snapshot reader");
  let epoch = 0;
  let active = null;
  let disposed = false;
  let state = Object.freeze({ status: "idle", result: null, errorCode: null, revision: 0 });
  const subscribers = new Set();
  const listeners = new Map();
  const notifier = createStateNotifier({ observers: subscribers, read: () => Object.freeze({ revision: state.revision }) });

  function emit(next) {
    state = Object.freeze({ ...next, revision: state.revision + 1 });
    notifier.notify();
  }

  function invalidate() {
    const current = ++epoch;
    const old = active;
    active = null;
    old?.abort();
    return current;
  }

  function requireActive() {
    if (disposed) throw Error("Portfolio controller is disposed");
  }

  function cancel() {
    requireActive();
    const current = invalidate();
    if (disposed || epoch !== current) return;
    emit({ status: "cancelled", result: null, errorCode: null });
  }

  function clear() {
    requireActive();
    const current = invalidate();
    if (disposed || epoch !== current) return;
    emit({ status: "idle", result: null, errorCode: null });
  }

  async function refresh(session, options = {}) {
    requireActive();
    const initialEpoch = epoch;
    let plan;
    try {
      const captured = captureOptionalDataFields(options, ["tokens", "timeoutMs", "signal", "onProgress"]);
      plan = { ...captured, tokens: captured.tokens === undefined ? undefined : captureDataArray(captured.tokens, 32) };
    } catch { throw TypeError("Expected own-data snapshot options and token slots"); }
    if (disposed || epoch !== initialEpoch) {
      return Object.freeze({ accepted: false, result: null });
    }
    const external = plan.signal;
    if (external !== undefined && !(external instanceof AbortSignal)) {
      throw TypeError("Expected an AbortSignal");
    }
    const current = invalidate();
    if (disposed || epoch !== current) return Object.freeze({ accepted: false, result: null });
    const controller = new AbortController();
    active = controller;
    const forwardAbort = () => controller.abort();
    if (external?.aborted) controller.abort();
    else external?.addEventListener("abort", forwardAbort, { once: true });
    const isCurrent = () => !disposed && current === epoch && active === controller;
    emit({ status: "loading", result: null, errorCode: null });
    try {
      // A subscriber may synchronously cancel or dispose during notification.
      if (!isCurrent()) return Object.freeze({ accepted: false, result: null });
      const result = await reader(session, { ...plan, signal: controller.signal });
      if (!isCurrent()) return Object.freeze({ accepted: false, result: null });
      if (controller.signal.aborted) {
        emit({ status: "cancelled", result: null, errorCode: null });
        return Object.freeze({ accepted: false, result: null });
      }
      // Readers are trusted application dependencies. This guard prevents an
      // accidentally substituted non-snapshot object from appearing as ready.
      let fields;
      try { fields = captureOptionalDataFields(result, ["readOnly", "securityAudit", "holdings"]); }
      catch { throw Object.assign(Error("Invalid snapshot result"), { code: "INVALID_SNAPSHOT" }); }
      if (!isCurrent()) return Object.freeze({ accepted: false, result: null });
      if (fields.readOnly !== true || fields.securityAudit !== false ||
          !Array.isArray(fields.holdings) || !Object.isFrozen(result)) {
        throw Object.assign(Error("Invalid snapshot result"), { code: "INVALID_SNAPSHOT" });
      }
      if (!isCurrent()) return Object.freeze({ accepted: false, result: null });
      emit({ status: "ready", result, errorCode: null });
      if (!isCurrent()) return Object.freeze({ accepted: false, result: null });
      return Object.freeze({ accepted: true, result });
    } catch (error) {
      if (!isCurrent()) return Object.freeze({ accepted: false, result: null });
      if (controller.signal.aborted) {
        emit({ status: "cancelled", result: null, errorCode: null });
      } else {
        // Avoid leaking provider payloads, arbitrary messages, or stack traces
        // into a display/export. Known string codes are enough for a UI label.
        const rawCode = readOwnErrorCode(error);
        if (!isCurrent()) return Object.freeze({ accepted: false, result: null });
        const code = typeof rawCode === "string" && /^[A-Z_]{1,64}$/.test(rawCode) ? rawCode : "SNAPSHOT_FAILED";
        emit({ status: "error", result: null, errorCode: code });
      }
      return Object.freeze({ accepted: false, result: null });
    } finally {
      external?.removeEventListener("abort", forwardAbort);
      if (active === controller) active = null;
    }
  }

  return Object.freeze({
    get state() { return state; },
    refresh,
    cancel,
    clear,
    subscribe(listener) {
      requireActive();
      if (typeof listener !== "function") throw TypeError("Expected listener");
      let observer = listeners.get(listener);
      if (!observer) {
        observer = () => listener(state);
        listeners.set(listener, observer);
        subscribers.add(observer);
      }
      return () => {
        if (listeners.get(listener) !== observer) return false;
        listeners.delete(listener);
        notifier.forget(observer);
        return subscribers.delete(observer);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      subscribers.clear();
      listeners.clear();
      invalidate();
      emit({ status: "disposed", result: null, errorCode: null });
    },
  });
}
