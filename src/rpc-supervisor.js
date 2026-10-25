import { createStateNotifier } from "./state-notifier.js";
import { createRpcCapacity } from "./rpc-capacity.js";
import { safeProviderFailure } from "./security-provider-error.js";

export const RPC_COUNTER_MAX = 1_000_000_000;
export const RPC_SUPERVISOR_CODES = Object.freeze([
  "RPC_CAPACITY", "RPC_CLOCK", "RPC_TIMER", "RPC_SUPERVISOR_CLOSED",
  "READ_TIMEOUT", "CONNECT_TIMEOUT", "PERMISSION_TIMEOUT",
  "SESSION_CHANGED", "SESSION_CANCELLED",
]);
const timeoutCodes = new Set(["READ_TIMEOUT", "CONNECT_TIMEOUT", "PERMISSION_TIMEOUT"]);
const cancelCodes = new Set(["SESSION_CHANGED", "SESSION_CANCELLED"]);
export class RpcSupervisorError extends Error {
  constructor(code) {
    super(RPC_SUPERVISOR_CODES.includes(code) ? code : "RPC_SUPERVISOR_CLOSED");
    this.name = "RpcSupervisorError";
    this.code = this.message;
  }
}

/**
 * Owns local waiting deadlines and actual outstanding provider work separately.
 * Cancellation is local: EIP-1193 has no request cancellation primitive.
 * A request that never settles retains its capacity until the page is destroyed.
 */
export function createRpcSupervisor({
  perProvider = 32, perPage = 96,
  now = () => performance.now(),
  schedule = (fn, ms) => setTimeout(fn, ms),
  unschedule = id => clearTimeout(id),
} = {}) {
  if (![now, schedule, unschedule].every(value => typeof value === "function")) {
    throw TypeError("Invalid supervisor environment");
  }
  const capacity = createRpcCapacity({ perProvider, perPage });
  const active = new Set();
  const observers = new Set();
  const counters = { started: 0, completed: 0, failed: 0, timedOut: 0,
    cancelled: 0, denied: 0, late: 0 };
  let fault = null;
  let disposed = false;
  let previous = null;

  function bump(name) {
    counters[name] = Math.min(RPC_COUNTER_MAX, counters[name] + 1);
  }
  function state() {
    return Object.freeze({ schema: "threecore-rpc-status-v1", ...capacity.state(),
      ...counters, fault, disposed, canStart: !fault && !disposed });
  }
  const notifications = createStateNotifier({ observers, read: state, deferred: true });
  const publish = notifications.notify;
  function closeForClock() {
    if (fault) return;
    fault = "RPC_CLOCK";
    for (const terminate of [...active]) terminate("RPC_CLOCK");
    publish();
  }
  function clock() {
    let value;
    try { value = now(); } catch { closeForClock(); return null; }
    if (!Number.isFinite(value) || value < 0 ||
        (previous !== null && value < previous)) {
      closeForClock();
      return null;
    }
    previous = value;
    return value;
  }
  function start({ provider, invoke, timeoutMs = 30_000,
    timeoutCode = "READ_TIMEOUT", cancelCode = "SESSION_CHANGED" } = {}) {
    if ((!provider || typeof provider !== "object") && typeof provider !== "function") {
      throw TypeError("A provider identity is required");
    }
    if (typeof invoke !== "function" || !Number.isSafeInteger(timeoutMs) ||
        timeoutMs < 1 || timeoutMs > 300_000 || !timeoutCodes.has(timeoutCode) ||
        !cancelCodes.has(cancelCode)) throw TypeError("Invalid request wait");

    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    let finished = false;
    let dispatched = false;
    let lease = null;
    let timer = null;
    let timerVersion = 0;
    let deadline = null;
    function clearTimer() {
      timerVersion++;
      if (timer !== null) { try { unschedule(timer); } catch {} }
      timer = null;
    }
    function finish(error, value, counter) {
      if (finished) return false;
      finished = true;
      clearTimer();
      active.delete(terminate);
      // Keep native work charged even when no local consumer is waiting.
      if (dispatched) lease?.abandon();
      else { lease?.release(); lease = null; invoke = null; provider = null; }
      if (counter) bump(counter);
      if (error) reject(error); else resolve(value);
      publish();
      return true;
    }
    function terminate(code) {
      const counter = timeoutCodes.has(code) ? "timedOut" :
        cancelCodes.has(code) ? "cancelled" : code === "RPC_CAPACITY" ? "denied" : "failed";
      return finish(new RpcSupervisorError(code), undefined, counter);
    }
    function expired() {
      if (finished) return true;
      const current = clock();
      if (current === null || fault) { terminate("RPC_CLOCK"); return true; }
      if (current >= deadline) { terminate(timeoutCode); return true; }
      return false;
    }
    function arm(delay) {
      if (finished) return;
      clearTimer();
      const version = timerVersion;
      let scheduling = true;
      let synchronous = false;
      try {
        const handle = schedule(() => {
          if (scheduling) { synchronous = true; return; }
          if (finished || version !== timerVersion) return;
          timer = null;
          if (!expired()) arm(Math.max(1, deadline - previous));
        }, delay);
        scheduling = false;
        if (finished) {
          try { unschedule(handle); } catch {}
        } else if (synchronous || handle === undefined || handle === null) {
          try { unschedule(handle); } catch {}
          terminate("RPC_TIMER");
        } else timer = handle;
      } catch { scheduling = false; terminate("RPC_TIMER"); }
    }
    function returned(ok, result) {
      lease?.release();
      lease = null;
      if (finished) {
        bump("late");
        publish();
        return;
      }
      // Timer callbacks can be throttled. Check elapsed time at every result.
      if (expired()) { bump("late"); publish(); return; }
      if (ok) finish(null, result, "completed");
      else {
        const safe = safeProviderFailure(result);
        // Inspecting a provider's error code can reenter or consume the deadline.
        if (!expired()) finish(safe, undefined, "failed");
        else { bump("late"); publish(); }
      }
    }
    const startedAt = clock();
    if (disposed) terminate("RPC_SUPERVISOR_CLOSED");
    else if (fault || startedAt === null) terminate("RPC_CLOCK");
    else {
      deadline = startedAt + timeoutMs;
      if (!Number.isFinite(deadline) || deadline <= startedAt) {
        closeForClock();
        terminate("RPC_CLOCK");
      }
      else {
        lease = capacity.acquire(provider);
        if (!lease) terminate("RPC_CAPACITY");
        active.add(terminate);
        if (finished) active.delete(terminate);
        arm(timeoutMs);
        // Register the cancel handle with the caller before calling extension code.
        queueMicrotask(() => {
          if (finished || expired()) return;
          dispatched = true;
          bump("started");
          publish();
          try {
            Promise.resolve(invoke()).then(value => returned(true, value), error => returned(false, error));
          } catch (error) { returned(false, error); }
          finally { invoke = null; provider = null; }
        });
      }
    }
    // No cancellation method releases outstanding transport capacity.
    return Object.freeze({ promise, cancel: () => terminate(cancelCode),
      state: () => Object.freeze({ finished, dispatched }) });
  }
  function subscribe(observer) {
    if (typeof observer !== "function" || observers.size >= 16 || disposed) {
      throw TypeError("Cannot subscribe to request status");
    }
    observers.add(observer);
    return () => { notifications.forget(observer); return observers.delete(observer); };
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const terminate of [...active]) terminate("RPC_SUPERVISOR_CLOSED");
    observers.clear();
    publish();
  }
  return Object.freeze({ start, state, subscribe, dispose });
}

/** Shared across sessions/controllers in this loaded page, never across tabs. */
export const walletRpcSupervisor = createRpcSupervisor();
