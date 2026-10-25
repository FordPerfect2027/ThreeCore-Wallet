import { acceptTimerHandle, consumeCallback, readSynchronousClock } from "./security-callback.js";
import { createStateNotifier } from "./state-notifier.js";
import { EXPORT_LIMITS, ExportSecurityError, exportFail, exportErrorCode,
  requireSyncExport, consumeExportCallback } from "./export-policy.js";
import { inspectExportPayload } from "./export-payload.js";

/** Bounded, synchronous handoff. An offer is not proof of a saved file. */
export function createExportGuard({ createResource, now = () => performance.now(),
  schedule = (fn, ms) => setTimeout(fn, ms), unschedule = id => clearTimeout(id) } = {}) {
  if ([createResource, now, schedule, unschedule].some(fn => typeof fn !== "function")) exportFail("EXPORT_OPTIONS");
  const jobs = new Set(), observers = new Set();
  const counts = { accepted: 0, offered: 0, rejected: 0, failed: 0, released: 0 };
  let reservedBytes = 0, disposed = false, clockFault = false, lastTime = null;
  let offering = false, stopping = 0, epoch = 0;
  const bump = key => { counts[key] = Math.min(Number.MAX_SAFE_INTEGER, counts[key] + 1); };
  function state() {
    const pendingCleanup = [...jobs].filter(job => job.cleanupFailed).length;
    return Object.freeze({ schema: "threecore-export-status-v1", disposed, clockFault,
      cleanupBlocked: pendingCleanup > 0,
      canOffer: !disposed && !clockFault && !pendingCleanup && jobs.size < EXPORT_LIMITS.active && reservedBytes < EXPORT_LIMITS.totalBytes,
      active: jobs.size, pendingCleanup, reservedBytes,
      maxActive: EXPORT_LIMITS.active, maxReservedBytes: EXPORT_LIMITS.totalBytes, ...counts });
  }
  const notifications = createStateNotifier({ observers, read: state, deferred: false });
  const notify = notifications.notify;
  function subscribe(listener) {
    if (typeof listener !== "function") exportFail("EXPORT_OPTIONS");
    if (disposed) return () => {};
    if (!observers.has(listener) && observers.size >= EXPORT_LIMITS.observers) exportFail("EXPORT_BUSY");
    observers.add(listener);
    notifications.initial(listener);
    return () => { notifications.forget(listener); return observers.delete(listener); };
  }
  function clearTimer(job) {
    const old = job.timer;
    job.timer = null;
    job.timerVersion++;
    if (old !== null) consumeExportCallback(() => unschedule(old));
  }
  function reclaim(job) {
    if (job.releasing) return false;
    job.releasing = true;
    job.stopped = true;
    clearTimer(job);
    let released = true;
    if (job.release) {
      try { requireSyncExport(job.release(), "EXPORT_CLEANUP"); }
      catch { released = false; }
    }
    job.cleanupFailed = !released;
    // A reentrant stop may run before allocation returns. Keep its reservation
    // until the synchronous offer unwinds and all newly returned resources close.
    if (released && !job.executing && jobs.delete(job)) {
      reservedBytes -= job.bytes;
      job.release = null;
      bump("released");
    }
    job.releasing = false;
    notify();
    return released && !job.executing;
  }
  function clear() {
    epoch++;
    stopping++;
    try { for (const job of [...jobs]) reclaim(job); }
    finally { stopping--; }
    return jobs.size === 0;
  }
  function tripClock() {
    clockFault = true;
    clear();
    exportFail("EXPORT_CLOCK");
  }
  function clock() {
    if (clockFault) exportFail("EXPORT_CLOCK");
    let time;
    try { time = readSynchronousClock(now); } catch { return tripClock(); }
    if (typeof time !== "number" || !Number.isFinite(time) || time < 0 ||
        time > Number.MAX_SAFE_INTEGER - EXPORT_LIMITS.retentionMs ||
        (lastTime !== null && time < lastTime)) return tripClock();
    lastTime = time;
    return time;
  }
  function arm(job) {
    if (job.stopped) return;
    const remaining = job.deadline - clock();
    if (job.stopped) return;
    if (remaining <= 0) { reclaim(job); return; }
    const version = ++job.timerVersion;
    let installing = true;
    const handle = schedule(() => {
      if (job.stopped || version !== job.timerVersion) return;
      if (installing) { reclaim(job); return; }
      job.timer = null;
      try { arm(job); } catch { reclaim(job); }
    }, Math.max(1, Math.ceil(remaining)));
    installing = false;
    if (!acceptTimerHandle(handle, unschedule)) exportFail("EXPORT_FAILED");
    if (job.stopped || version !== job.timerVersion) consumeCallback(() => unschedule(handle));
    else job.timer = handle;
  }
  function offer(input) {
    let job = null, receipt, code, initialEpoch = epoch;
    if (offering || stopping) { bump("rejected"); notify(); exportFail("EXPORT_BUSY"); }
    offering = true;
    try {
      if (disposed) exportFail("EXPORT_DISPOSED");
      if (clockFault) exportFail("EXPORT_CLOCK");
      if (state().cleanupBlocked) exportFail("EXPORT_CLEANUP");
      if (jobs.size >= EXPORT_LIMITS.active || reservedBytes >= EXPORT_LIMITS.totalBytes) exportFail("EXPORT_BUSY");
      const payload = inspectExportPayload(input);
      const start = clock();
      if (disposed || epoch !== initialEpoch) exportFail(disposed ? "EXPORT_DISPOSED" : "EXPORT_CANCELLED");
      if (jobs.size >= EXPORT_LIMITS.active || reservedBytes + payload.byteLength > EXPORT_LIMITS.totalBytes) exportFail("EXPORT_BUSY");
      job = { bytes: payload.byteLength, deadline: start + EXPORT_LIMITS.retentionMs,
        executing: true, stopped: false, cleanupFailed: false, release: null, timer: null, timerVersion: 0 };
      jobs.add(job); reservedBytes += job.bytes; bump("accepted");
      const current = () => !job.stopped && !disposed && !clockFault && epoch === initialEpoch;
      const checkpoint = () => { if (!current()) exportFail("EXPORT_CANCELLED"); };
      const resource = requireSyncExport(createResource(payload, current));
      // Capture release first so a broken activation getter still closes it.
      const release = resource?.release;
      if (typeof release !== "function") exportFail("EXPORT_UNAVAILABLE");
      job.release = () => release.call(resource);
      const activate = resource.activate;
      if (typeof activate !== "function") exportFail("EXPORT_UNAVAILABLE");
      checkpoint(); arm(job); checkpoint();
      requireSyncExport(activate.call(resource));
      checkpoint(); clock(); checkpoint();
      if (lastTime >= job.deadline) exportFail("EXPORT_CANCELLED");
      bump("offered");
      receipt = Object.freeze({ schema: "threecore-export-offer-v1", offered: true,
        downloadComplete: false, byteLength: payload.byteLength, kind: payload.kind });
    } catch (error) {
      code = exportErrorCode(error);
      if (job) { bump("failed"); reclaim(job); }
      else bump("rejected");
    } finally {
      if (job) {
        job.executing = false;
        if (job.stopped) reclaim(job);
      }
      offering = false;
      notify();
    }
    if (code) throw new ExportSecurityError(code);
    return receipt;
  }
  function retryCleanup() {
    stopping++;
    try { for (const job of [...jobs]) if (job.cleanupFailed) reclaim(job); }
    finally { stopping--; }
    return !state().cleanupBlocked;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    clear(); notify(); observers.clear();
  }
  return Object.freeze({ offer, state, subscribe, clear, retryCleanup, dispose });
}
