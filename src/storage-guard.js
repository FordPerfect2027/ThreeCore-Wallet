import { createStateNotifier } from "./state-notifier.js";
import { STORAGE_CONCURRENCY, STORAGE_OBSERVERS, STORAGE_COUNTER_LIMIT,
  storageFail, observeStorageCleanup } from "./storage-guard-policy.js";

export const STORAGE_STATUS_SCHEMA = "threecore-storage-guard-v1";
const phases = ["opening", "reading", "writing", "draining"];
const reasons = ["CHECKPOINT_CANCELLED", "CHECKPOINT_TIMEOUT", "CHECKPOINT_CLOSED",
  "CHECKPOINT_ABORTED", "CHECKPOINT_CLOCK", "CHECKPOINT_TIMER", "CHECKPOINT_STORAGE"];

/** Per-page admission. A stopped native operation retains its slot until terminal.
 * This service cannot read, delete, export or write any saved document itself.
 */
export function createStorageGuard() {
  let disposed = false;
  let clockFault = false;
  let cancelling = false;
  const active = new Set();
  const observers = new Set();
  const counts = { accepted: 0, completed: 0, failed: 0, cancelled: 0,
    timedOut: 0, rejected: 0, late: 0, uncertain: 0 };
  const bump = name => { counts[name] = Math.min(STORAGE_COUNTER_LIMIT, counts[name] + 1); };
  function state() {
    const byPhase = { opening: 0, reading: 0, writing: 0, draining: 0 };
    for (const token of active) byPhase[token.phase]++;
    return Object.freeze({ schema: STORAGE_STATUS_SCHEMA, disposed, clockFault,
      canStart: !disposed && !clockFault && !cancelling && active.size < STORAGE_CONCURRENCY,
      active: active.size, maxActive: STORAGE_CONCURRENCY, ...byPhase, ...counts });
  }
  const notifications = createStateNotifier({ observers, read: state, deferred: true });
  const publish = notifications.notify;
  function stop(token, code) {
    if (token.finished || token.stopped) return false;
    token.stopped = true;
    token.phase = "draining";
    bump(code === "CHECKPOINT_TIMEOUT" ? "timedOut" :
      ["CHECKPOINT_CANCELLED", "CHECKPOINT_CLOSED", "CHECKPOINT_ABORTED"].includes(code) ? "cancelled" : "failed");
    publish();
    observeStorageCleanup(() => token.onStop(code));
    return true;
  }
  function cancelAll(code = "CHECKPOINT_CANCELLED") {
    if (!reasons.includes(code)) storageFail("CHECKPOINT_ADAPTER");
    if (cancelling) return 0;
    cancelling = true;
    let count = 0;
    try { for (const token of [...active]) if (stop(token, code)) count++; }
    finally { cancelling = false; publish(); }
    return count;
  }
  function acquire(onStop) {
    if (typeof onStop !== "function") storageFail("CHECKPOINT_ADAPTER");
    if (disposed || clockFault || cancelling || active.size >= STORAGE_CONCURRENCY) {
      bump("rejected");
      publish();
      storageFail(disposed ? "CHECKPOINT_CLOSED" : clockFault ? "CHECKPOINT_CLOCK" : "CHECKPOINT_BUSY");
    }
    const token = { phase: "opening", stopped: false, finished: false, onStop };
    active.add(token);
    bump("accepted");
    publish();
    return Object.freeze({
      phase(value) {
        if (!phases.includes(value) || value === "draining") storageFail("CHECKPOINT_ADAPTER");
        if (token.finished || token.stopped) return false;
        token.phase = value;
        publish();
        return true;
      },
      stop(code = "CHECKPOINT_CANCELLED") {
        if (!reasons.includes(code)) storageFail("CHECKPOINT_ADAPTER");
        return stop(token, code);
      },
      finish({ success = false, late = false, uncertain = false } = {}) {
        if ((uncertain && !late) || [success, late, uncertain].some(value => typeof value !== "boolean")) storageFail("CHECKPOINT_ADAPTER");
        if (token.finished) return false;
        token.finished = true;
        active.delete(token);
        if (!token.stopped) bump(success ? "completed" : "failed");
        if (late) bump("late");
        if (uncertain) bump("uncertain");
        token.onStop = null;
        publish();
        return true;
      },
    });
  }
  return Object.freeze({ state, acquire, cancelAll,
    tripClock() { clockFault = true; cancelAll("CHECKPOINT_CLOCK"); },
    subscribe(observer) {
      if (disposed || typeof observer !== "function" || observers.size >= STORAGE_OBSERVERS) {
        storageFail("CHECKPOINT_ADAPTER");
      }
      observers.add(observer);
      return () => { notifications.forget(observer); return observers.delete(observer); };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAll("CHECKPOINT_CLOSED");
      observers.clear();
    },
  });
}

export const walletStorageGuard = createStorageGuard();
