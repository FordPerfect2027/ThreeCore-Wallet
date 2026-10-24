/** Page-local read-access lock; never a wallet password or permission revoker. */
export const LOCK_IDLE_CHOICES = Object.freeze([60_000, 300_000, 900_000]);
export const LOCK_REASONS = Object.freeze(["manual", "idle", "hidden", "page-exit", "clock", "disposed"]);

export function createSecurityLock({
  now = () => performance.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  unschedule = timer => clearTimeout(timer),
  idleMs = 300_000,
  onLock = () => {},
  onChange = () => {},
} = {}) {
  if (![now, schedule, unschedule, onLock, onChange].every(value => typeof value === "function") ||
      !LOCK_IDLE_CHOICES.includes(idleMs)) throw TypeError("Invalid lock configuration");
  let locked = false;
  let disposed = false;
  let reason = null;
  let version = 0;
  let lastActivity = now();
  let timer = null;
  let timerVersion = 0;
  if (!Number.isFinite(lastActivity) || lastActivity < 0) throw TypeError("Invalid lock clock");

  function state() {
    return Object.freeze({ locked, disposed, reason, idleMs, version,
      canRead: !locked && !disposed, canSign: false, canSendTransactions: false });
  }
  function publish() {
    try { onChange(state()); } catch { /* An observer cannot unlock this gate. */ }
  }
  function stopTimer() {
    timerVersion++;
    if (timer !== null) { try { unschedule(timer); } catch {} }
    timer = null;
  }
  function lock(nextReason = "manual") {
    if (disposed || locked) return false;
    if (!LOCK_REASONS.includes(nextReason)) throw TypeError("Unknown lock reason");
    locked = true;
    reason = nextReason;
    version++;
    stopTimer();
    // Gate closes before disconnect callbacks or UI observers can reenter.
    try { onLock(state()); } catch { /* Remain locked when a cleanup fails. */ }
    publish();
    return true;
  }
  function clock() {
    let current;
    try { current = now(); } catch { lock("clock"); return null; }
    if (!Number.isFinite(current) || current < lastActivity) { lock("clock"); return null; }
    return current;
  }
  function arm(delay) {
    stopTimer();
    if (locked || disposed) return;
    const ticket = timerVersion;
    timer = schedule(() => {
      if (disposed || locked || ticket !== timerVersion) return;
      timer = null;
      check();
      if (!locked) arm(Math.max(1, idleMs - (clock() - lastActivity)));
    }, delay);
  }
  function check() {
    if (disposed || locked) return false;
    const current = clock();
    if (current === null) return false;
    if (current - lastActivity >= idleMs) lock("idle");
    return !locked;
  }
  function activity() {
    // Activity after suspension cannot rescue an expired connection.
    if (!check()) return false;
    lastActivity = clock();
    if (lastActivity === null) return false;
    arm(idleMs);
    return true;
  }
  function unlock() {
    if (disposed || !locked) return false;
    let current;
    try { current = now(); } catch { return false; }
    if (!Number.isFinite(current) || current < 0) return false;
    lastActivity = current;
    locked = false;
    reason = null;
    version++;
    arm(idleMs);
    publish();
    // This only permits a new explicit Connect action. No session is restored.
    return true;
  }
  function configure(next) {
    if (disposed || !LOCK_IDLE_CHOICES.includes(next)) return false;
    if (!locked) check();
    idleMs = next;
    if (!locked) {
      check();
      if (!locked) arm(Math.max(1, idleMs - (clock() - lastActivity)));
    }
    publish();
    return true;
  }
  function ticket() {
    return check() ? version : null;
  }
  function valid(ticketValue) {
    return check() && Number.isSafeInteger(ticketValue) && ticketValue === version;
  }
  function dispose() {
    if (disposed) return;
    if (!locked) lock("disposed");
    disposed = true;
    version++;
    stopTimer();
    publish();
  }
  arm(idleMs);
  return Object.freeze({ state, check, activity, lock, unlock, configure, ticket, valid, dispose });
}
