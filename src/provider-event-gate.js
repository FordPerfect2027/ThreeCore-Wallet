/** Bound repeated provider notifications before inspecting their payloads. */
export const PROVIDER_EVENT_LIMITS = Object.freeze({ count: 256, windowMs: 1000 });

export function createProviderEventGate({ now = () => performance.now(),
  limit = PROVIDER_EVENT_LIMITS.count, windowMs = PROVIDER_EVENT_LIMITS.windowMs } = {}) {
  if (typeof now !== "function" || !Number.isSafeInteger(limit) || limit < 1 || limit > 256 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 60_000) {
    throw TypeError("Invalid provider event budget");
  }
  let previous = null;
  let windowStart = null;
  let count = 0;
  let blocked = false;
  let reason = null;
  function stop(next) {
    if (blocked) return false;
    blocked = true;
    reason = next;
    return false;
  }
  function accept() {
    if (blocked) return false;
    let time;
    try { time = now(); } catch { return stop("clock"); }
    if (!Number.isFinite(time) || time < 0 || (previous !== null && time < previous)) return stop("clock");
    previous = time;
    if (windowStart === null || time - windowStart >= windowMs) {
      windowStart = time;
      count = 0;
    }
    if (count >= limit) return stop("limit");
    count++;
    return true;
  }
  function state() {
    return Object.freeze({ blocked, reason, count, limit, windowMs });
  }
  // A blocked observer cannot be revived by the provider or by waiting longer.
  return Object.freeze({ accept, state });
}
