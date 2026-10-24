import { SecureBackupError, secureFail } from "./secure-backup-format.js";
import { createSecureDeadline } from "./secure-deadline.js";

/** Native WebCrypto keeps its slot until settlement, even after local cancellation. */
export function createSecureBackupRunner({ timeoutMs = 60_000,
  now = () => performance.now(), schedule = (fn, ms) => setTimeout(fn, ms),
  unschedule = handle => clearTimeout(handle),
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 ||
      ![now, schedule, unschedule].every(fn => typeof fn === "function")) secureFail("SECURE_INTERNAL");
  let active = null;
  let disposed = false;
  let last = null;
  let clockFault = false;
  let entering = false;
  let notification = false;
  const observers = new Set();
  const counters = { started: 0, completed: 0, failed: 0, cancelled: 0, timedOut: 0, late: 0, denied: 0 };
  function publish() {
    if (notification || !observers.size) return;
    notification = true;
    queueMicrotask(() => {
      notification = false;
      const value = state();
      for (const observer of [...observers]) {
        if (!observers.has(observer)) continue;
        try { Promise.resolve(observer(value)).catch(() => {}); } catch {}
      }
    });
  }
  const bump = name => { counters[name] = Math.min(1_000_000_000, counters[name] + 1); publish(); };
  function clock() {
    let value;
    try { value = now(); } catch { value = NaN; }
    if (clockFault || !Number.isFinite(value) || value < 0 || (last !== null && value < last)) {
      clockFault = true;
      return NaN;
    }
    last = value;
    return value;
  }
  function state() {
    return Object.freeze({ phase: disposed ? "disposed" : active ? active.finished ? "draining" : "running" : "idle",
      busy: active !== null, disposed, clockFault, ...counters });
  }
  async function run(work, { signal } = {}) {
    if (typeof work !== "function") secureFail("SECURE_INTERNAL");
    if (disposed) secureFail("SECURE_DISPOSED");
    if (active || entering) { bump("denied"); secureFail("SECURE_BUSY"); }
    let add, remove;
    entering = true;
    try {
      if (signal != null) {
        add = signal.addEventListener;
        remove = signal.removeEventListener;
        if (typeof add !== "function" || typeof remove !== "function" ||
            typeof signal.aborted !== "boolean") secureFail("SECURE_INTERNAL");
        if (signal.aborted) secureFail("SECURE_CANCELLED");
      }
    } catch (error) {
      if (error instanceof SecureBackupError) throw error;
      secureFail("SECURE_INTERNAL");
    } finally { entering = false; }
    if (disposed) secureFail("SECURE_DISPOSED");
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const token = { finished: false, dispatched: false, stop: null };
    active = token;
    publish();
    let attached = false;
    let deadline;
    const onAbort = () => stop("SECURE_CANCELLED");
    function cleanup() {
      deadline?.dispose();
      if (attached) {
        attached = false;
        try { remove.call(signal, "abort", onAbort); } catch {}
      }
      signal = add = remove = null;
    }
    function finish(error, value, ok = false) {
      if (token.finished) return false;
      token.finished = true;
      cleanup();
      if (!token.dispatched && active === token) active = null;
      publish();
      if (ok) resolve(value); else reject(error);
      return true;
    }
    function stop(code) {
      if (token.finished) return false;
      bump(code === "SECURE_TIMEOUT" ? "timedOut" :
        ["SECURE_CANCELLED", "SECURE_DISPOSED"].includes(code) ? "cancelled" : "failed");
      return finish(new SecureBackupError(code));
    }
    token.stop = stop;
    function guard() {
      if (token.finished || disposed) return false;
      try {
        if (signal?.aborted) { stop("SECURE_CANCELLED"); return false; }
      } catch { stop("SECURE_INTERNAL"); return false; }
      return deadline.check();
    }
    function returned(ok, result) {
      if (active === token) active = null;
      if (token.finished) { bump("late"); return; }
      if (!guard()) { bump("late"); return; }
      bump(ok ? "completed" : "failed");
      finish(ok ? null : result, ok ? result : undefined, ok);
    }
    deadline = createSecureDeadline({ timeoutMs, now: clock, schedule, unschedule,
      timeoutCode: "SECURE_TIMEOUT", onExpire: stop });
    try {
      if (signal) {
        attached = true;
        const receiver = signal;
        add.call(receiver, "abort", onAbort, { once: true });
        if (!token.finished && receiver.aborted) stop("SECURE_CANCELLED");
      }
      if (!token.finished && !deadline.arm()) stop(deadline.state().code ?? "SECURE_INTERNAL");
    } catch { stop("SECURE_INTERNAL"); }
    queueMicrotask(() => {
      if (!guard()) { work = null; return; }
      token.dispatched = true;
      bump("started");
      try {
        Promise.resolve(work(guard)).then(value => returned(true, value), error => returned(false, error));
      } catch (error) { returned(false, error); }
      finally { work = null; }
    });
    return promise;
  }
  return Object.freeze({ run, busy: () => active !== null, state,
    subscribe(observer) {
      if (disposed || typeof observer !== "function" || observers.size >= 16) secureFail("SECURE_INTERNAL");
      observers.add(observer);
      return () => observers.delete(observer);
    },
    cancel() { return active?.stop("SECURE_CANCELLED") ?? false; },
    dispose() { disposed = true; active?.stop("SECURE_DISPOSED"); observers.clear(); },
  });
}

// Shared across remounted panels in this realm; other tabs have their own realm.
export const secureBackupRunner = createSecureBackupRunner();
