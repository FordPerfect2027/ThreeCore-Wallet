import { secureFail } from "./secure-backup-format.js";

/** Check elapsed time at use, even when a background browser delays timers. */
export function createSecureDeadline({
  timeoutMs = 120_000,
  now = () => performance.now(),
  schedule = (fn, ms) => { const handle = setTimeout(fn, ms); handle?.unref?.(); return handle; },
  unschedule = handle => clearTimeout(handle),
  onExpire = () => {}, timeoutCode = "SECURE_EXPIRED",
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 ||
      ![now, schedule, unschedule, onExpire].every(fn => typeof fn === "function") ||
      !["SECURE_EXPIRED", "SECURE_TIMEOUT"].includes(timeoutCode)) secureFail("SECURE_INTERNAL");
  let phase = "idle";
  let code = null;
  let last = null;
  let expires = null;
  let timer = null;
  let version = 0;
  let reading = false;
  let fault = null;
  function clearTimer() {
    version++;
    const handle = timer;
    timer = null;
    if (handle !== null) {
      try { unschedule(handle); } catch { /* Invalidated callbacks cannot revive access. */ }
    }
  }
  function expire(reason) {
    if (phase !== "armed") return false;
    phase = "expired";
    code = reason;
    if (reason === "SECURE_CLOCK" || reason === "SECURE_TIMER") fault = reason;
    expires = null;
    clearTimer();
    try { Promise.resolve(onExpire(reason)).catch(() => {}); } catch {}
    return false;
  }
  function clock() {
    if (reading) { expire("SECURE_CLOCK"); return null; }
    reading = true;
    let value;
    try { value = now(); } catch { value = NaN; }
    finally { reading = false; }
    if (!Number.isFinite(value) || value < 0 || (last !== null && value < last)) {
      expire("SECURE_CLOCK");
      return null;
    }
    last = value;
    return value;
  }
  function check() {
    if (phase !== "armed") return false;
    const revision = version;
    const current = clock();
    if (current === null || phase !== "armed" || revision !== version) return false;
    if (current >= expires) return expire(timeoutCode);
    return true;
  }
  function armTimer(delay) {
    const revision = version;
    let installing = true;
    let synchronous = false;
    let handle;
    try {
      handle = schedule(() => {
        if (installing) { synchronous = true; return; }
        if (phase !== "armed" || version !== revision) return;
        timer = null;
        if (check()) {
          version++;
          armTimer(Math.max(1, expires - last));
        }
      }, delay);
      installing = false;
    } catch {
      installing = false;
      if (version === revision) expire("SECURE_TIMER");
      return false;
    }
    if (phase !== "armed" || version !== revision || synchronous || handle == null) {
      try { unschedule(handle); } catch {}
      if (phase === "armed" && version === revision) expire("SECURE_TIMER");
      return false;
    }
    timer = handle;
    return true;
  }
  function arm() {
    if (phase === "disposed" || fault) return false;
    clearTimer();
    phase = "armed";
    code = null;
    const revision = version;
    const current = clock();
    if (current === null || phase !== "armed" || version !== revision) return false;
    expires = current + timeoutMs;
    if (!Number.isFinite(expires) || expires <= current) return expire("SECURE_CLOCK");
    if (!armTimer(timeoutMs)) return false;
    return check();
  }
  function clear() {
    if (phase === "disposed") return;
    phase = "idle";
    expires = null;
    code = null;
    clearTimer();
  }
  function dispose() {
    phase = "disposed";
    expires = null;
    clearTimer();
  }
  const state = () => Object.freeze({ phase, code, fault });
  return Object.freeze({ arm, check, clear, dispose, state });
}
