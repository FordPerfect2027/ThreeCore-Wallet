import { readPortfolioSnapshot } from "./portfolio-snapshot.js";

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

  function emit(next) {
    state = Object.freeze({ ...next, revision: state.revision + 1 });
    // UI subscribers cannot prevent invalidation or corrupt operation state.
    for (const listener of [...subscribers]) {
      try { listener(state); }
      catch { /* Observer failures are isolated from wallet state. */ }
    }
  }

  function invalidate() {
    epoch++;
    const old = active;
    active = null;
    old?.abort();
  }

  function requireActive() {
    if (disposed) throw Error("Portfolio controller is disposed");
  }

  function cancel() {
    requireActive();
    invalidate();
    emit({ status: "cancelled", result: null, errorCode: null });
  }

  function clear() {
    requireActive();
    invalidate();
    emit({ status: "idle", result: null, errorCode: null });
  }

  async function refresh(session, options = {}) {
    requireActive();
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw TypeError("Expected snapshot options");
    }
    // Capture caller input before notifying potentially reentrant observers.
    const plan = { ...options,
      tokens: Array.isArray(options.tokens) ? [...options.tokens] : options.tokens,
    };
    const external = plan.signal;
    if (external !== undefined && !(external instanceof AbortSignal)) {
      throw TypeError("Expected an AbortSignal");
    }
    invalidate();
    const current = epoch;
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
      if (!result || result.readOnly !== true || result.securityAudit !== false ||
          !Array.isArray(result.holdings) || !Object.isFrozen(result)) {
        throw Object.assign(Error("Invalid snapshot result"), { code: "INVALID_SNAPSHOT" });
      }
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
        let code = "SNAPSHOT_FAILED";
        try {
          if (typeof error?.code === "string" && /^[A-Z_]{1,64}$/.test(error.code)) code = error.code;
        } catch { /* A hostile getter must not break cleanup. */ }
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
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
      emit({ status: "disposed", result: null, errorCode: null });
      subscribers.clear();
    },
  });
}
