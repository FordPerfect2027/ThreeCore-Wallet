import { acceptTimerHandle, consumeCallback, readSynchronousClock, observeCallbackResult } from "./security-callback.js";
/** Page-local read-access lock; never a wallet password or permission revoker. */
export const LOCK_IDLE_CHOICES = Object.freeze([60_000, 300_000, 900_000]);
export const LOCK_REASONS = Object.freeze(["manual", "idle", "hidden", "page-exit", "clock", "timer", "disposed",
  "broadcast-stop", "peer-stop", "channel-error", "page-freeze", "page-restored"]);

// Cleanup is synchronous. A delayed result is consumed, never permission.
function asynchronous(value) {
  return observeCallbackResult(value) !== "synchronous";
}

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
  let locked = false, disposed = false, reason = null, fault = null;
  let version = 0, timerVersion = 0, boundaryDepth = 0;
  let stopVersion = 0;
  let lastActivity = readSynchronousClock(now), lastObserved = lastActivity, timer = null;
  let readingClock = false, notifying = false, cleaning = false, cleanupComplete = true;
  if (!Number.isFinite(lastActivity) || lastActivity < 0 || lastActivity > Number.MAX_SAFE_INTEGER - idleMs ||
      !Number.isFinite(lastActivity + idleMs) || lastActivity + idleMs <= lastActivity) {
    throw TypeError("Invalid lock clock");
  }
  function state() {
    return Object.freeze({ locked, disposed, reason, idleMs, version, fault, cleanupComplete,
      canRead: !locked && !disposed,
      canResume: locked && !disposed && !fault && cleanupComplete && !cleaning,
      canSign: false, canSendTransactions: false });
  }
  function boundary(fn) {
    boundaryDepth++;
    try { return fn(); } finally { boundaryDepth--; }
  }
  function publish() {
    if (notifying) return;
    notifying = true;
    try {
      // A stop/dispose requested by a view callback must also reach that view.
      // Only restrictive transitions are allowed inside callbacks, so this
      // bounded follow-up cannot become an unlock/lock notification loop.
      for (let count = 0; count < 3; count++) {
        const revision = version;
        try { boundary(() => asynchronous(onChange(state()))); } catch {}
        if (revision === version) break;
      }
    }
    finally { notifying = false; }
  }
  function stopTimer() {
    timerVersion++;
    const handle = timer;
    timer = null;
    if (handle !== null) {
      try { boundary(() => asynchronous(unschedule(handle))); } catch {}
    }
  }
  function cleanup() {
    if (cleaning) return false;
    cleaning = true;
    cleanupComplete = false;
    try {
      const result = boundary(() => onLock(state()));
      cleanupComplete = !boundary(() => asynchronous(result)) && result !== false;
    } catch {}
    finally { cleaning = false; }
    return cleanupComplete;
  }
  function lock(nextReason = "manual") {
    stopVersion++;
    if (disposed || locked) return false;
    if (!LOCK_REASONS.includes(nextReason)) throw TypeError("Unknown lock reason");
    // Gate closes before cancellation, cleanup and observers can reenter.
    locked = true;
    reason = nextReason;
    if (nextReason === "clock" || nextReason === "timer") fault = nextReason;
    version++;
    stopTimer();
    cleanup();
    publish();
    return true;
  }
  function trip(next) {
    fault = next;
    if (!locked && !disposed) lock(next);
    else if (!disposed) { reason = next; stopTimer(); publish(); }
    return null;
  }
  function clock() {
    if (readingClock) return trip("clock");
    readingClock = true;
    let current;
    try { current = boundary(() => readSynchronousClock(now)); } catch { current = NaN; }
    finally { readingClock = false; }
    if (!Number.isFinite(current) || current < 0 || current > Number.MAX_SAFE_INTEGER - idleMs || current < lastObserved ||
        !Number.isFinite(current + idleMs) || current + idleMs <= current) return trip("clock");
    lastObserved = current;
    return current;
  }
  function check() {
    if (disposed || locked) return false;
    const revision = version;
    const current = clock();
    if (current === null || disposed || locked || revision !== version) return false;
    if (current - lastActivity >= idleMs) lock("idle");
    return !locked && !disposed && revision === version;
  }
  function arm(delay) {
    stopTimer();
    if (locked || disposed) return false;
    const ticket = timerVersion;
    let installing = true, firedSynchronously = false, handle;
    try {
      handle = boundary(() => schedule(() => {
        if (installing) { firedSynchronously = true; return; }
        if (disposed || locked || ticket !== timerVersion) return;
        timer = null;
        if (check()) arm(Math.max(1, idleMs - (lastObserved - lastActivity)));
      }, delay));
    } catch {
      installing = false;
      if (!locked && !disposed && ticket === timerVersion) trip("timer");
      return false;
    }
    installing = false;
    const release = value => boundary(() => consumeCallback(() => unschedule(value)));
    const valid = boundary(() => acceptTimerHandle(handle, release));
    if (locked || disposed || ticket !== timerVersion || firedSynchronously || !valid) {
      if (valid) release(handle);
      if (!locked && !disposed && ticket === timerVersion) trip("timer");
      return false;
    }
    timer = handle;
    return true;
  }
  function activity() {
    if (boundaryDepth || !check()) return false;
    lastActivity = lastObserved;
    return arm(idleMs) && check();
  }
  function unlock() {
    if (boundaryDepth || disposed || !locked || fault || !cleanupComplete || cleaning) return false;
    const revision = version;
    const stopRevision = stopVersion;
    const current = clock();
    if (current === null || disposed || fault || revision !== version || stopRevision !== stopVersion || !locked) return false;
    lastActivity = current;
    locked = false;
    reason = null;
    version++;
    if (!arm(idleMs) || !check()) return false;
    publish();
    // Resume permits only a subsequent explicit Connect action.
    return !locked && !disposed;
  }
  function configure(next) {
    if (boundaryDepth || disposed || !LOCK_IDLE_CHOICES.includes(next)) return false;
    if (!locked) check();
    if (disposed) return false;
    idleMs = next;
    if (!locked && check()) arm(Math.max(1, idleMs - (lastObserved - lastActivity)));
    publish();
    return !disposed;
  }
  function retryCleanup() {
    if (boundaryDepth || disposed || !locked || cleaning) return false;
    const completed = cleanup();
    publish();
    return completed && !disposed;
  }
  function ticket() { return check() ? version : null; }
  function valid(ticketValue) {
    return check() && Number.isSafeInteger(ticketValue) && ticketValue === version;
  }
  function dispose() {
    if (disposed) return;
    const needsCleanup = !locked;
    disposed = true;
    locked = true;
    reason ??= "disposed";
    version++;
    stopTimer();
    if (needsCleanup) cleanup();
    publish();
  }
  arm(idleMs);
  return Object.freeze({ state, check, activity, lock, unlock, configure, retryCleanup, ticket, valid, dispose });
}
