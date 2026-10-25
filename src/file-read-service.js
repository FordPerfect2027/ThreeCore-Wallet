import { readAbortState } from "./security-abort.js";
import { acceptTimerHandle, consumeCallback, readSynchronousClock, observeCallbackResult } from "./security-callback.js";
import { createStateNotifier } from "./state-notifier.js";
import { SecurityFileError, FILE_SECURITY_LIMIT, FILE_READ_TIMEOUT, FILE_CHUNK_LIMIT,
  FILE_READ_CONCURRENCY, FILE_READ_RESERVED_LIMIT, FILE_READ_OBSERVER_LIMIT,
  fileReadFail as fail, fileReadCode, consumeCleanup } from "./file-read-policy.js";
import { captureFileSource, inspectReadPacket, snapshotFileChunk, openFileStream } from "./file-read-source.js";

/**
 * Page-wide admission budget. A cancelled waiter retains capacity until its
 * actual worker settles. There is no queue, retry, storage or wallet operation.
 */
export function createFileReadService({ now = () => globalThis.performance.now(),
  schedule = (action, delay) => setTimeout(action, delay),
  unschedule = timer => clearTimeout(timer) } = {}) {
  if ([now, schedule, unschedule].some(fn => typeof fn !== "function")) fail("FILE_OPTIONS");
  const jobs = new Set();
  const observers = new Set();
  let reservedBytes = 0;
  let disposed = false;
  let clockFault = false;
  let lastTime = null;
  let cancellationEpoch = 0;
  let cancelling = false;
  const counts = { accepted: 0, completed: 0, failed: 0, cancelled: 0, timedOut: 0, rejected: 0 };
  const bump = key => { counts[key] = Math.min(Number.MAX_SAFE_INTEGER, counts[key] + 1); };
  function state() {
    let waiting = 0;
    for (const job of jobs) if (!job.ended) waiting++;
    return Object.freeze({ schema: "threecore-file-read-status-v1", disposed, clockFault,
      canStart: !disposed && !clockFault && jobs.size < FILE_READ_CONCURRENCY && reservedBytes < FILE_READ_RESERVED_LIMIT,
      active: jobs.size, waiting, retained: jobs.size - waiting, reservedBytes,
      maxActive: FILE_READ_CONCURRENCY, maxReservedBytes: FILE_READ_RESERVED_LIMIT, ...counts });
  }
  const notifications = createStateNotifier({ observers, read: state, deferred: false });
  const notify = notifications.notify;
  function tripClock() {
    if (!clockFault) {
      clockFault = true;
      for (const job of [...jobs]) job.stop("FILE_CLOCK");
      notify();
    }
    fail("FILE_CLOCK");
  }
  function clock() {
    if (clockFault) fail("FILE_CLOCK");
    let value;
    try { value = readSynchronousClock(now); } catch { return tripClock(); }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - 120_000 ||
        (lastTime !== null && value < lastTime)) return tripClock();
    lastTime = value;
    return value;
  }
  function subscribe(listener) {
    if (typeof listener !== "function") fail("FILE_OPTIONS");
    if (disposed) return () => {};
    if (!observers.has(listener) && observers.size >= FILE_READ_OBSERVER_LIMIT) fail("FILE_BUSY");
    observers.add(listener);
    notifications.initial(listener);
    return () => { notifications.forget(listener); return observers.delete(listener); };
  }
  async function read(file, options, mode) {
    const epoch = cancellationEpoch;
    let maxBytes, timeoutMs, signal, addAbort, removeAbort, captured, start;
    try {
      if (disposed) fail("FILE_DISPOSED");
      if (cancelling) fail("FILE_BUSY");
      if (clockFault) fail("FILE_CLOCK");
      if (!options || typeof options !== "object" || Array.isArray(options)) fail("FILE_OPTIONS");
      ({ maxBytes = FILE_SECURITY_LIMIT, timeoutMs = FILE_READ_TIMEOUT, signal } = options);
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > FILE_SECURITY_LIMIT ||
          !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) fail("FILE_OPTIONS");
      if (signal !== undefined && signal !== null) {
        addAbort = signal.addEventListener;
        removeAbort = signal.removeEventListener;
        const aborted = readAbortState(signal);
        if (typeof addAbort !== "function" || typeof removeAbort !== "function" || typeof aborted !== "boolean") fail("FILE_OPTIONS");
        if (aborted || readAbortState(signal) === true) fail("FILE_CANCELLED");
      }
      start = clock();
      captured = captureFileSource(file, maxBytes);
      if (disposed) fail("FILE_DISPOSED");
      if (clockFault) fail("FILE_CLOCK");
      if (epoch !== cancellationEpoch) fail("FILE_CANCELLED");
      if (jobs.size >= FILE_READ_CONCURRENCY || reservedBytes + captured.size > FILE_READ_RESERVED_LIMIT) fail("FILE_BUSY");
    } catch (error) {
      bump("rejected"); notify();
      throw new SecurityFileError(fileReadCode(error));
    }
    let resolveResult, rejectResult;
    const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    result.catch(() => {});
    let timer = null;
    let timerVersion = 0;
    let removeNeeded = false;
    let source = null;
    const parts = [];
    const byteChunks = [];
    let received = 0;
    let chunkCount = 0;
    let failureCode = null;
    let decoder = mode === "text" ? new TextDecoder("utf-8", { fatal: true }) : null;
    const deadline = start + timeoutMs;
    const job = { ended: false, stop };
    jobs.add(job);
    reservedBytes += captured.size;
    bump("accepted");
    function clearTimer() {
      timerVersion++;
      const old = timer;
      timer = null;
      if (old !== null) consumeCleanup(() => unschedule(old));
    }
    function detachAbort() {
      if (!removeNeeded) return;
      removeNeeded = false;
      consumeCleanup(() => removeAbort.call(signal, "abort", onAbort));
    }
    function clearBuffers() { parts.length = 0; byteChunks.length = 0; decoder = null; }
    function stop(code) {
      if (job.ended) return false;
      job.ended = true;
      failureCode = code;
      clearTimer(); detachAbort(); clearBuffers();
      source?.cleanup(true);
      bump(code === "FILE_CANCELLED" ? "cancelled" : code === "FILE_TIMEOUT" ? "timedOut" : "failed");
      rejectResult(new SecurityFileError(code));
      notify();
      return true;
    }
    function onAbort() { stop("FILE_CANCELLED"); }
    function checkpoint() {
      if (job.ended) fail(failureCode || "FILE_CANCELLED");
      if (disposed) { stop("FILE_DISPOSED"); fail("FILE_DISPOSED"); }
      let aborted;
      try { aborted = readAbortState(signal); } catch { stop("FILE_READ"); fail("FILE_READ"); }
      if (typeof aborted !== "boolean") { stop("FILE_READ"); fail("FILE_READ"); }
      if (aborted) { stop("FILE_CANCELLED"); fail("FILE_CANCELLED"); }
      const time = clock();
      if (job.ended) fail(failureCode || "FILE_CANCELLED");
      if (time >= deadline) { stop("FILE_TIMEOUT"); fail("FILE_TIMEOUT"); }
      return time;
    }
    function armTimer() {
      const time = checkpoint();
      const version = ++timerVersion;
      let installing = true;
      const handle = schedule(() => {
        if (job.ended || version !== timerVersion) return;
        if (installing) { stop("FILE_READ"); return; }
        timer = null;
        try { armTimer(); } catch (error) { stop(fileReadCode(error)); }
      }, Math.max(1, Math.ceil(deadline - time)));
      installing = false;
      const valid = acceptTimerHandle(handle, unschedule);
      if (!valid) stop("FILE_READ");
      else if (job.ended || version !== timerVersion) consumeCallback(() => unschedule(handle));
      else timer = handle;
    }
    function accept(value, fallback = false) {
      checkpoint();
      if (++chunkCount > FILE_CHUNK_LIMIT) fail("FILE_SIZE");
      const bytes = snapshotFileChunk(value, captured.size - received, fallback);
      checkpoint();
      received += bytes.byteLength;
      if (mode === "bytes") byteChunks.push(bytes);
      else {
        try { parts.push(decoder.decode(bytes, { stream: true })); }
        catch { fail("FILE_ENCODING"); }
      }
    }
    async function work() {
      try {
        checkpoint();
        if (captured.stream) {
          source = openFileStream(captured, checkpoint);
          checkpoint();
          while (true) {
            checkpoint();
            const raw = await source.read();
            checkpoint();
            const packet = inspectReadPacket(raw);
            checkpoint();
            if (packet.done) break;
            accept(packet.value);
          }
        } else {
          checkpoint();
          const buffer = await captured.arrayBuffer.call(captured.file);
          checkpoint();
          accept(buffer, true);
        }
        if (received !== captured.size) fail("FILE_SIZE");
        let value;
        if (mode === "bytes") {
          value = new Uint8Array(received);
          let offset = 0;
          for (const chunk of byteChunks) { value.set(chunk, offset); offset += chunk.byteLength; }
        } else {
          try { parts.push(decoder.decode()); } catch { fail("FILE_ENCODING"); }
          value = parts.join("");
        }
        checkpoint();
        job.ended = true;
        bump("completed");
        clearTimer(); detachAbort(); clearBuffers();
        source?.cleanup(false);
        resolveResult(value);
      } catch (error) { stop(fileReadCode(error)); }
      finally {
        clearTimer(); detachAbort(); clearBuffers();
        source?.cleanup(Boolean(failureCode));
        // Only actual worker settlement returns the reservation.
        jobs.delete(job);
        reservedBytes -= captured.size;
        notify();
      }
    }
    try {
      if (signal) {
        removeNeeded = true;
        const registration = addAbort.call(signal, "abort", onAbort, { once: true });
        // If a broken adapter attaches later, remove that late listener as well.
        const kind = observeCallbackResult(registration,
          () => consumeCleanup(() => removeAbort.call(signal, "abort", onAbort)));
        if (kind !== "synchronous" || registration === false) stop("FILE_READ");
        if (!job.ended) {
          const aborted = readAbortState(signal);
          if (typeof aborted !== "boolean") stop("FILE_READ");
          else if (aborted) onAbort();
        }
      }
      if (!job.ended) armTimer();
    } catch (error) { stop(fileReadCode(error)); }
    notify();
    Promise.resolve().then(work).catch(() => stop("FILE_READ"));
    return result;
  }
  function cancelAll() {
    if (cancelling) return 0;
    cancellationEpoch++;
    cancelling = true;
    let count = 0;
    try { for (const job of [...jobs]) if (job.stop("FILE_CANCELLED")) count++; }
    finally { cancelling = false; }
    return count;
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancellationEpoch++;
    for (const job of [...jobs]) job.stop("FILE_DISPOSED");
    notify(); observers.clear();
  }
  return Object.freeze({ readText: (file, options = {}) => read(file, options, "text"),
    readBytes: (file, options = {}) => read(file, options, "bytes"), state, subscribe, cancelAll, dispose });
}
export const walletFileReadService = createFileReadService();
