import { CheckpointError, checkpointFail, emptyCheckpointDocument,
  validateCheckpointDocument, mutateCheckpoints } from "./checkpoint-model.js";

export const CHECKPOINT_DATABASE = "threecore-workspace-checkpoints-v1";
const STORE = "checkpoints";
const KEY = "current";

export function checkpointStorageError(error) {
  if (error instanceof CheckpointError) return error;
  const codes = {
    QuotaExceededError: "CHECKPOINT_QUOTA", SecurityError: "CHECKPOINT_UNAVAILABLE",
    NotAllowedError: "CHECKPOINT_UNAVAILABLE", VersionError: "CHECKPOINT_VERSION",
    AbortError: "CHECKPOINT_ABORTED", InvalidStateError: "CHECKPOINT_CLOSED",
  };
  return new CheckpointError(codes[error?.name] ?? "CHECKPOINT_STORAGE");
}

/** Lazy, origin-scoped IndexedDB. No automatic read, save, migration or eviction. */
export function createCheckpointStorage({ indexedDB,
  name = CHECKPOINT_DATABASE, openTimeoutMs = 8000, transactionTimeoutMs = 30000, documentPolicy } = {}) {
  const policy = documentPolicy ?? { empty: emptyCheckpointDocument, validate: validateCheckpointDocument,
    mutate: mutateCheckpoints, mapError: checkpointStorageError };
  if (!policy || !["empty", "validate", "mutate", "mapError"].every(key => typeof policy[key] === "function")) {
    checkpointFail("CHECKPOINT_ADAPTER");
  }
  if (typeof name !== "string" || !name.length || name.length > 160 ||
      !Number.isSafeInteger(openTimeoutMs) || openTimeoutMs < 1 || openTimeoutMs > 60000 ||
      !Number.isSafeInteger(transactionTimeoutMs) || transactionTimeoutMs < 1 || transactionTimeoutMs > 60000) {
    checkpointFail("CHECKPOINT_ADAPTER");
  }
  let connection = null;
  let opening = null;
  let disposed = false;
  let cancelOpen = null;
  const transactions = new Set();

  function openDatabase() {
    if (disposed) return Promise.reject(new CheckpointError("CHECKPOINT_CLOSED"));
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    let databaseFactory;
    try { databaseFactory = indexedDB === undefined ? globalThis.indexedDB : indexedDB; }
    catch { return Promise.reject(new CheckpointError("CHECKPOINT_UNAVAILABLE")); }
    if (!databaseFactory || typeof databaseFactory.open !== "function") {
      return Promise.reject(new CheckpointError("CHECKPOINT_UNAVAILABLE"));
    }
    opening = new Promise((resolve, reject) => {
      let settled = false;
      let request;
      const timer = setTimeout(() => finish(new CheckpointError("CHECKPOINT_TIMEOUT")), openTimeoutMs);
      function finish(error, db) {
        if (settled) { db?.close(); return; }
        settled = true;
        clearTimeout(timer);
        cancelOpen = null;
        if (error) reject(policy.mapError(error));
        else resolve(db);
      }
      cancelOpen = () => finish(new CheckpointError("CHECKPOINT_CLOSED"));
      try {
        request = databaseFactory.open(name, 1);
        request.onupgradeneeded = () => {
          if (settled || disposed) { request.transaction.abort(); return; }
          try {
            if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
          } catch (error) {
            finish(error);
            request.transaction.abort();
          }
        };
        request.onblocked = () => finish(new CheckpointError("CHECKPOINT_BLOCKED"));
        request.onerror = () => finish(request.error);
        request.onsuccess = () => {
          const db = request.result;
          if (settled || disposed) { db.close(); return; }
          if (!db.objectStoreNames.contains(STORE)) {
            db.close();
            finish(new CheckpointError("CHECKPOINT_SCHEMA"));
            return;
          }
          connection = db;
          db.onversionchange = () => { db.close(); if (connection === db) connection = null; };
          db.onclose = () => { if (connection === db) connection = null; };
          finish(null, db);
        };
      } catch (error) { finish(error); }
    }).finally(() => { opening = null; });
    return opening;
  }

  async function transact(expectedRevision, operation, canCommit, signal) {
    if (signal !== undefined && !(signal instanceof AbortSignal)) checkpointFail("CHECKPOINT_ADAPTER");
    if (signal?.aborted) checkpointFail("CHECKPOINT_CANCELLED");
    const db = await openDatabase();
    if (disposed) checkpointFail("CHECKPOINT_CLOSED");
    if (signal?.aborted) checkpointFail("CHECKPOINT_CANCELLED");
    return new Promise((resolve, reject) => {
      let transaction;
      let result;
      let failure;
      let settled = false;
      let timer = null;
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        transactions.delete(transaction);
        signal?.removeEventListener("abort", onCancel);
        if (error) reject(policy.mapError(error));
        else resolve(result);
      }
      function abort(error) {
        failure = error;
        try { transaction.abort(); } catch { finish(error); }
      }
      const onCancel = () => abort(new CheckpointError("CHECKPOINT_CANCELLED"));
      try {
        transaction = db.transaction(STORE, operation ? "readwrite" : "readonly");
        transactions.add(transaction);
        timer = setTimeout(() => abort(new CheckpointError("CHECKPOINT_TIMEOUT")), transactionTimeoutMs);
        signal?.addEventListener("abort", onCancel, { once: true });
        transaction.onabort = () => finish(failure || transaction.error || new CheckpointError("CHECKPOINT_ABORTED"));
        transaction.onerror = () => { failure ||= transaction.error; };
        transaction.oncomplete = () => finish(failure);
        const store = transaction.objectStore(STORE);
        const request = store.get(KEY);
        request.onerror = () => { failure ||= request.error; };
        request.onsuccess = () => {
          try {
            if (settled) return;
            if (signal?.aborted) checkpointFail("CHECKPOINT_CANCELLED");
            if (disposed) checkpointFail("CHECKPOINT_CLOSED");
            const current = request.result === undefined ? policy.empty() : policy.validate(request.result);
            result = current;
            if (operation) {
              // All computation is synchronous inside this request's active transaction.
              result = policy.mutate(current, expectedRevision, operation);
              if (typeof canCommit !== "function" || canCommit() !== true) checkpointFail("CHECKPOINT_CANCELLED");
              if (result.revision !== current.revision) {
                const write = store.put(result, KEY);
                write.onerror = () => { failure ||= write.error; };
              }
            }
          } catch (error) { abort(error); }
        };
      } catch (error) {
        if (transaction) abort(error);
        else finish(error);
      }
    });
  }

  return Object.freeze({
    read({ signal } = {}) { return transact(undefined, undefined, undefined, signal); },
    change(expectedRevision, operation, { canCommit = () => true, signal } = {}) {
      return transact(expectedRevision, operation, canCommit, signal);
    },
    close() {
      if (disposed) return;
      disposed = true;
      cancelOpen?.();
      for (const transaction of transactions) {
        try { transaction.abort(); } catch { /* Already complete. */ }
      }
      connection?.close();
      connection = null;
    },
  });
}
