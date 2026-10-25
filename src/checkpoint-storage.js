import { CheckpointError, checkpointFail, emptyCheckpointDocument,
  validateCheckpointDocument, mutateCheckpoints } from "./checkpoint-model.js";
import { createSecureDeadline } from "./secure-deadline.js";
import { observeCallbackResult, readSynchronousClock } from "./security-callback.js";
import { walletStorageGuard } from "./storage-guard.js";
import { StorageGuardError, captureStorageInput, ownStorageData,
  synchronousStorageValue, observeStorageCleanup } from "./storage-guard-policy.js";

export const CHECKPOINT_DATABASE = "threecore-workspace-checkpoints-v1";
const STORE = "checkpoints";
const KEY = "current";
const nativeNames = Object.freeze({
  QuotaExceededError: "CHECKPOINT_QUOTA", SecurityError: "CHECKPOINT_UNAVAILABLE",
  NotAllowedError: "CHECKPOINT_UNAVAILABLE", VersionError: "CHECKPOINT_VERSION",
  AbortError: "CHECKPOINT_ABORTED", InvalidStateError: "CHECKPOINT_CLOSED",
});
const checkpointCodes = new Set([
  "ADAPTER", "UNAVAILABLE", "QUOTA", "VERSION", "ABORTED", "CLOSED", "STORAGE",
  "TIMEOUT", "BLOCKED", "SCHEMA", "CANCELLED", "SHAPE", "CAPACITY", "STALE",
  "OPERATION", "CONFLICT", "DUPLICATE", "MISSING", "CONFIRMATION", "REVISION",
  "LABEL", "TIME", "ID", "FILE", "DRAFT_CHANGED", "BUSY", "CLOCK", "TIMER",
].map(code => "CHECKPOINT_" + code));

export function checkpointStorageError(error) {
  let name;
  try {
    const getter = typeof DOMException === "function" &&
      Object.getOwnPropertyDescriptor(DOMException.prototype, "name")?.get;
    name = getter && error instanceof DOMException ? getter.call(error) : ownStorageData(error, "name");
  } catch {}
  const code = ownStorageData(error, "code");
  try {
    if ((error instanceof CheckpointError || error instanceof StorageGuardError) && checkpointCodes.has(code)) {
      return new CheckpointError(code);
    }
  } catch { /* A throwing prototype trap is not a trusted error. */ }
  return new CheckpointError(typeof name === "string" && Object.hasOwn(nativeNames, name)
    ? nativeNames[name] : "CHECKPOINT_STORAGE");
}

/** All five repositories use the same guarded, origin-scoped transaction boundary.
 * No automatic reads, migration, deletion, retries, eviction or network access.
 */
export function createCheckpointStorage({ indexedDB, name = CHECKPOINT_DATABASE,
  openTimeoutMs = 8000, transactionTimeoutMs = 30000, documentPolicy,
  guard = walletStorageGuard, deadlineOptions = {}, snapshotLimits,
} = {}) {
  const source = documentPolicy ?? { empty: emptyCheckpointDocument,
    validate: validateCheckpointDocument, mutate: mutateCheckpoints, mapError: checkpointStorageError };
  const policy = {};
  for (const key of ["empty", "validate", "mutate", "mapError"]) {
    const fn = ownStorageData(source, key);
    if (typeof fn !== "function") checkpointFail("CHECKPOINT_ADAPTER");
    policy[key] = (...args) => fn.call(source, ...args);
  }
  if (typeof name !== "string" || !name.length || name.length > 160 ||
      !Number.isSafeInteger(openTimeoutMs) || openTimeoutMs < 1 || openTimeoutMs > 60000 ||
      !Number.isSafeInteger(transactionTimeoutMs) || transactionTimeoutMs < 1 || transactionTimeoutMs > 60000 ||
      !guard || ![guard.acquire, guard.tripClock].every(fn => typeof fn === "function")) {
    checkpointFail("CHECKPOINT_ADAPTER");
  }
  const time = {
    now: deadlineOptions.now ?? (() => performance.now()),
    schedule: deadlineOptions.schedule ?? ((fn, delay) => setTimeout(fn, delay)),
    unschedule: deadlineOptions.unschedule ?? (handle => clearTimeout(handle)),
  };
  if (!Object.values(time).every(fn => typeof fn === "function")) checkpointFail("CHECKPOINT_ADAPTER");
  const sourceClock = time.now;
  let lastClock = null;
  time.now = () => {
    const value = readSynchronousClock(sourceClock);
    if (!Number.isFinite(value) || value < 0 || (lastClock !== null && value < lastClock)) return NaN;
    lastClock = value;
    return value;
  };
  let disposed = false;
  let connection = null;
  let opening = null;
  let admitting = false;
  const contexts = new Set();
  function mapped(error) {
    try {
      const safe = error instanceof StorageGuardError ? checkpointStorageError(error) : error;
      const result = synchronousStorageValue(policy.mapError(safe));
      return result instanceof Error ? result : new CheckpointError("CHECKPOINT_STORAGE");
    } catch { return new CheckpointError("CHECKPOINT_STORAGE"); }
  }
  function closeHandle(db) { observeStorageCleanup(() => db?.close()); }
  function failOpen(record, error) {
    if (record.terminal) return;
    record.failed = true;
    for (const ctx of [...record.waiters]) ctx.stop(error);
  }
  function endOpen(record, error, db) {
    if (record.terminal) { if (db && db !== connection?.db) closeHandle(db); return; }
    record.terminal = true;
    if (opening === record) opening = null;
    const waiting = [...record.waiters];
    record.waiters.clear();
    const eligible = !error && !record.failed && !disposed && waiting.some(ctx => ctx.alive());
    if (eligible) {
      const handle = { db };
      connection = handle;
      const detach = () => {
        if (connection === handle) connection = null;
        for (const ctx of [...contexts]) {
          if (ctx.db === db) ctx.stop(new CheckpointError("CHECKPOINT_CLOSED"));
        }
      };
      try {
        db.onversionchange = () => { detach(); closeHandle(db); };
        db.onclose = detach;
      } catch (problem) {
        connection = null;
        closeHandle(db);
        for (const ctx of waiting) {
          ctx.openPending = false;
          ctx.stop(problem);
          ctx.release();
        }
        return;
      }
    } else if (db) closeHandle(db);
    for (const ctx of waiting) {
      ctx.openPending = false;
      if (error) ctx.stop(error);
      if (!eligible || !ctx.alive()) {
        ctx.stop(new CheckpointError(disposed ? "CHECKPOINT_CLOSED" : "CHECKPOINT_CANCELLED"));
        ctx.release();
      } else queueMicrotask(() => beginTransaction(ctx, db));
    }
  }
  function joinOpen(ctx) {
    if (!ctx.alive()) { ctx.release(); return; }
    if (connection) { const db = connection.db; queueMicrotask(() => beginTransaction(ctx, db)); return; }
    if (opening) {
      if (opening.failed || ![...opening.waiters].some(item => item.active)) {
        ctx.stop(new CheckpointError("CHECKPOINT_BLOCKED"));
        ctx.release();
      } else {
        ctx.openPending = true;
        opening.waiters.add(ctx);
      }
      return;
    }
    const record = { terminal: false, failed: false, waiters: new Set([ctx]), request: null };
    opening = record;
    ctx.openPending = true;
    try {
      const factory = indexedDB === undefined ? globalThis.indexedDB : indexedDB;
      const open = factory?.open;
      if (typeof open !== "function") checkpointFail("CHECKPOINT_UNAVAILABLE");
      if (!ctx.alive()) { endOpen(record, new CheckpointError("CHECKPOINT_CANCELLED")); return; }
      const request = open.call(factory, name, 1);
      record.request = request;
      synchronousStorageValue(request);
      request.onblocked = () => failOpen(record, new CheckpointError("CHECKPOINT_BLOCKED"));
      request.onerror = () => {
        let error;
        try { error = request.error; } catch { error = new CheckpointError("CHECKPOINT_STORAGE"); }
        endOpen(record, error ?? new CheckpointError("CHECKPOINT_STORAGE"));
      };
      request.onupgradeneeded = () => {
        try {
          if (record.terminal || record.failed || disposed || ![...record.waiters].some(item => item.alive())) {
            request.transaction.abort();
            return;
          }
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        } catch (error) {
          failOpen(record, error);
          observeStorageCleanup(() => request.transaction.abort());
        }
      };
      request.onsuccess = () => {
        let db;
        try {
          db = request.result;
          if (record.terminal || record.failed || disposed) { endOpen(record, new CheckpointError("CHECKPOINT_CLOSED"), db); return; }
          if (!db || !db.objectStoreNames.contains(STORE)) checkpointFail("CHECKPOINT_SCHEMA");
          endOpen(record, null, db);
        } catch (error) { endOpen(record, error, db); }
      };
    } catch (error) {
      // A returned request may still be running even if handler registration fails.
      if (record.request) failOpen(record, error);
      else endOpen(record, error);
    }
  }
  function beginTransaction(ctx, db) {
    if (!ctx.alive() || disposed || connection?.db !== db) {
      ctx.stop(new CheckpointError(disposed ? "CHECKPOINT_CLOSED" : "CHECKPOINT_CANCELLED"));
      ctx.release();
      return;
    }
    ctx.deadline.dispose();
    ctx.arm(transactionTimeoutMs);
    if (!ctx.alive()) { ctx.release(); return; }
    ctx.db = db;
    ctx.lease.phase(ctx.write ? "writing" : "reading");
    try {
      const create = db.transaction;
      if (!ctx.alive()) { ctx.release(); return; }
      const tx = create.call(db, STORE, ctx.write ? "readwrite" : "readonly");
      ctx.transaction = tx;
      ctx.nativePending = true;
      synchronousStorageValue(tx);
      const abort = tx.abort;
      if (typeof abort !== "function") checkpointFail("CHECKPOINT_ADAPTER");
      ctx.abortNative = () => abort.call(tx);
      tx.onabort = () => {
        if (!ctx.nativePending) return;
        ctx.abortAttempted = true;
        let error;
        try { error = tx.error; } catch {}
        ctx.stop(error ?? new CheckpointError("CHECKPOINT_ABORTED"));
        ctx.release({ late: !ctx.active });
      };
      tx.onerror = () => {
        let error;
        try { error = tx.error; } catch {}
        ctx.stop(error ?? new CheckpointError("CHECKPOINT_STORAGE"));
      };
      tx.oncomplete = () => {
        if (!ctx.nativePending) return;
        const accepted = ctx.alive() && ctx.readSeen;
        if (accepted) ctx.resolveResult();
        else ctx.stop(new CheckpointError("CHECKPOINT_STORAGE"));
        ctx.release({ success: accepted, late: !accepted, uncertain: !accepted && ctx.putQueued });
      };
      if (!ctx.alive()) { ctx.abortOnce(); return; }
      const obtainStore = tx.objectStore;
      if (!ctx.alive()) { ctx.abortOnce(); return; }
      const store = synchronousStorageValue(obtainStore.call(tx, STORE));
      if (!ctx.alive()) { ctx.abortOnce(); return; }
      const get = store.get;
      if (!ctx.alive()) { ctx.abortOnce(); return; }
      const request = synchronousStorageValue(get.call(store, KEY));
      request.onerror = () => {
        let error;
        try { error = request.error; } catch {}
        ctx.stop(error ?? new CheckpointError("CHECKPOINT_STORAGE"));
      };
      request.onsuccess = () => {
        if (!ctx.active || !ctx.nativePending || ctx.readSeen) return;
        try {
          if (!ctx.alive()) return;
          ctx.readSeen = true;
          const input = request.result;
          const current = synchronousStorageValue(input === undefined ? policy.empty() : policy.validate(input));
          if (!ctx.alive()) return;
          const candidate = ctx.write
            ? synchronousStorageValue(policy.mutate(current, ctx.expected, ctx.operation)) : current;
          if (!ctx.alive()) return;
          const result = captureStorageInput(candidate, snapshotLimits);
          const revision = ownStorageData(result, "revision");
          const beforeRevision = ownStorageData(current, "revision");
          if (!Number.isSafeInteger(revision) || revision < 0 ||
              !Number.isSafeInteger(beforeRevision) || beforeRevision < 0) checkpointFail("CHECKPOINT_SCHEMA");
          if (ctx.write) {
            if (typeof ctx.canCommit !== "function" || synchronousStorageValue(ctx.canCommit()) !== true) {
              checkpointFail("CHECKPOINT_CANCELLED");
            }
            // Cancellation/close/expiry inside validation or canCommit invalidates this write.
            if (!ctx.alive()) return;
            if (revision !== beforeRevision) {
              const put = store.put;
              if (!ctx.alive()) return;
              const write = put.call(store, result, KEY);
              ctx.putQueued = true;
              synchronousStorageValue(write);
              write.onerror = () => {
                let error;
                try { error = write.error; } catch {}
                ctx.stop(error ?? new CheckpointError("CHECKPOINT_STORAGE"));
              };
            }
          }
          if (!ctx.alive()) return;
          ctx.result = result;
        } catch (error) { ctx.stop(error); }
      };
    } catch (error) {
      ctx.stop(error);
      if (!ctx.nativePending) ctx.release();
    }
  }
  function transact(expected, operation, canCommit, signal, write) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    let lease;
    let entered = false;
    const ctx = { active: true, released: false, openPending: false, nativePending: false,
      readSeen: false, putQueued: false, transaction: null, db: null, result: undefined,
      deadline: null, signal, write, expected, operation, canCommit,
      abortNative: null, abortAttempted: false, removeSignal: null, readAborted: null,
      arm(duration) {
        if (!ctx.active) return;
        ctx.deadline = createSecureDeadline({ ...time, timeoutMs: duration, timeoutCode: "SECURE_TIMEOUT",
          onExpire(code) {
            const translated = code === "SECURE_CLOCK" ? "CHECKPOINT_CLOCK"
              : code === "SECURE_TIMER" ? "CHECKPOINT_TIMER" : "CHECKPOINT_TIMEOUT";
            ctx.stop(new CheckpointError(translated));
            if (translated === "CHECKPOINT_CLOCK") guard.tripClock();
          } });
        if (!ctx.deadline.arm()) ctx.stop(new CheckpointError("CHECKPOINT_TIMER"));
        // Injected clock/scheduler callbacks can synchronously close the caller.
        if (!ctx.active) ctx.deadline.dispose();
      },
      alive() {
        if (!ctx.active) return false;
        if (disposed) { ctx.stop(new CheckpointError("CHECKPOINT_CLOSED")); return false; }
        try {
          if (ctx.signal && ctx.readAborted.call(ctx.signal)) { ctx.stop(new CheckpointError("CHECKPOINT_CANCELLED")); return false; }
        } catch { ctx.stop(new CheckpointError("CHECKPOINT_ADAPTER")); return false; }
        return !!ctx.deadline?.check();
      },
      clearCaller() {
        ctx.deadline?.dispose();
        if (ctx.removeSignal) observeStorageCleanup(ctx.removeSignal);
        ctx.removeSignal = null;
        ctx.signal = ctx.operation = ctx.expected = ctx.canCommit = ctx.result = ctx.readAborted = null;
      },
      abortOnce() {
        if (!ctx.abortNative || ctx.abortAttempted || !ctx.nativePending) return;
        ctx.abortAttempted = true;
        // An abort exception is not evidence of native completion. Keep its slot.
        observeStorageCleanup(ctx.abortNative);
      },
      stop(error) {
        if (!ctx.active) return false;
        ctx.active = false;
        const mappedError = mapped(error);
        const code = ownStorageData(error, "code");
        const reason = ["CHECKPOINT_CANCELLED", "CHECKPOINT_TIMEOUT", "CHECKPOINT_CLOSED",
          "CHECKPOINT_ABORTED", "CHECKPOINT_CLOCK", "CHECKPOINT_TIMER"].includes(code) ? code : "CHECKPOINT_STORAGE";
        lease?.stop(reason);
        ctx.clearCaller();
        reject(mappedError);
        ctx.abortOnce();
        if (!ctx.nativePending && !ctx.openPending) ctx.release();
        return true;
      },
      resolveResult() {
        if (!ctx.active) return;
        const result = ctx.result;
        ctx.active = false;
        ctx.clearCaller();
        resolve(result);
      },
      release(options = {}) {
        if (ctx.released) return;
        ctx.released = true;
        ctx.nativePending = ctx.openPending = false;
        ctx.transaction = ctx.db = ctx.abortNative = null;
        contexts.delete(ctx);
        lease?.finish(options);
      },
    };
    try {
      if (disposed) checkpointFail("CHECKPOINT_CLOSED");
      if (admitting) checkpointFail("CHECKPOINT_BUSY");
      admitting = true;
      entered = true;
      lease = guard.acquire(code => ctx.stop(new CheckpointError(code)));
      ctx.lease = lease;
      contexts.add(ctx);
      if (signal !== undefined) {
        if (!(signal instanceof AbortSignal)) checkpointFail("CHECKPOINT_ADAPTER");
        const readAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted").get;
        ctx.readAborted = readAborted;
        if (readAborted.call(signal)) checkpointFail("CHECKPOINT_CANCELLED");
        const add = signal.addEventListener, remove = signal.removeEventListener;
        if (typeof add !== "function" || typeof remove !== "function") checkpointFail("CHECKPOINT_ADAPTER");
        const onAbort = () => ctx.stop(new CheckpointError("CHECKPOINT_CANCELLED"));
        const detach = () => remove.call(signal, "abort", onAbort);
        ctx.removeSignal = detach;
        const registered = add.call(signal, "abort", onAbort, { once: true });
        // A refused adapter can attach later. Its completion only removes the
        // captured listener; it never grants authority to open or write.
        const kind = observeCallbackResult(registered, () => observeStorageCleanup(detach));
        if (kind !== "synchronous" || registered === false) checkpointFail("CHECKPOINT_ADAPTER");
      }
      ctx.arm(openTimeoutMs);
      if (write && ctx.alive()) {
        const snapshot = captureStorageInput({ expected, operation }, snapshotLimits);
        ctx.expected = snapshot.expected;
        ctx.operation = snapshot.operation;
      }
      if (ctx.alive()) joinOpen(ctx);
    } catch (error) { ctx.stop(error); }
    finally { if (entered) admitting = false; }
    return promise;
  }
  return Object.freeze({
    read({ signal } = {}) { return transact(undefined, undefined, undefined, signal, false); },
    change(expected, operation, { canCommit = () => true, signal } = {}) {
      return transact(expected, operation, canCommit, signal, true);
    },
    close() {
      if (disposed) return;
      disposed = true;
      for (const ctx of [...contexts]) ctx.stop(new CheckpointError(ctx.nativePending ? "CHECKPOINT_ABORTED" : "CHECKPOINT_CLOSED"));
      const prior = connection;
      connection = null;
      if (prior) closeHandle(prior.db);
    },
  });
}
