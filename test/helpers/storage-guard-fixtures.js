import { createCheckpointStorage } from "../../src/checkpoint-storage.js";
import { createStorageGuard } from "../../src/storage-guard.js";
import { emptyCheckpointDocument, mutateCheckpoints } from "../../src/checkpoint-model.js";
import { saveOperation } from "./checkpoint-fixtures.js";
import { manualTime, microtasks } from "./secure-lifecycle-time.js";

export { saveOperation, manualTime, microtasks };
export const clone = value => value === undefined ? undefined : structuredClone(value);
export const code = expected => error => error?.code === expected;
export function outcome(promise) {
  return promise.then(value => ({ ok: true, value }), error => ({ ok: false, code: error?.code, error }));
}

/** Controlled event delivery with a separate durable value and queued put value.
 * Native IndexedDB behavior is verified separately in the browser suite.
 */
export function database(initial, hooks = {}) {
  let durable = clone(initial);
  const requests = [];
  const transactions = [];
  const effects = { puts: 0, commits: 0, aborts: 0, closes: 0, creates: 0, gets: 0 };
  const db = {
    objectStoreNames: { contains: () => hooks.hasStore !== false },
    createObjectStore(name) { effects.creates++; hooks.onCreate?.(name); },
    close() { effects.closes++; hooks.onClose?.(); },
    transaction(name, mode) {
      const get = {}, put = {};
      let queued;
      const tx = {
        name, mode, get, put, aborted: false, terminal: false, error: null,
        abort() {
          effects.aborts++;
          hooks.onAbort?.(tx);
          if (hooks.abortThrows) throw Error("synthetic abort refused");
          tx.aborted = true;
          if (hooks.silentAbort) return;
          queueMicrotask(() => tx.abortEvent());
        },
        abortEvent(error = null) {
          tx.error = error;
          tx.aborted = true;
          tx.terminal = true;
          tx.onabort?.();
        },
        objectStore() { hooks.onStore?.(tx); return store; },
        read(value = durable) {
          get.result = clone(value);
          get.onsuccess?.();
        },
        complete({ force = false } = {}) {
          if (tx.terminal && !force) return false;
          if (tx.aborted && !force) { tx.abortEvent(); return false; }
          if (queued !== undefined) { durable = clone(queued); effects.commits++; }
          tx.terminal = true;
          tx.oncomplete?.();
          return true;
        },
      };
      const store = {
        get(key) {
          effects.gets++;
          get.key = key;
          hooks.onGet?.(tx);
          return get;
        },
        put(value, key) {
          effects.puts++;
          put.key = key;
          queued = clone(value);
          put.value = queued;
          hooks.onPut?.(tx, value);
          return put;
        },
      };
      tx.store = store;
      transactions.push(tx);
      hooks.onTransaction?.(tx);
      return tx;
    },
  };
  const factory = {
    open(name, version) {
      const request = { name, version, result: null, error: null,
        transaction: { abort() { effects.aborts++; } } };
      requests.push(request);
      hooks.onOpen?.(request);
      return request;
    },
  };
  return { db, factory, requests, transactions, effects, hooks,
    current: () => clone(durable),
    replace(value) { durable = clone(value); },
    succeed(index = requests.length - 1) {
      const request = requests[index];
      request.result = db;
      request.onsuccess?.();
    },
    fail(name = "UnknownError", index = requests.length - 1) {
      const request = requests[index];
      request.error = new DOMException("synthetic private error", name);
      request.onerror?.();
    },
    drain() {
      for (const request of requests) {
        request.error = new DOMException("test finished", "AbortError");
        request.onerror?.();
      }
      for (const tx of transactions) if (!tx.terminal) tx.abortEvent();
    },
  };
}

export function fixture(t, { initial, hooks, ...options } = {}) {
  const db = database(initial, hooks);
  const time = manualTime();
  const guard = options.guard ?? createStorageGuard();
  const storage = createCheckpointStorage({ indexedDB: db.factory, guard,
    openTimeoutMs: 100, transactionTimeoutMs: 100, deadlineOptions: time.options, ...options });
  t.after(async () => { storage.close(); db.drain(); guard.dispose(); await microtasks(); });
  return { ...db, time, guard, storage,
    async open() { db.succeed(); await microtasks(); return db.transactions.at(-1); },
    async read(value) {
      const promise = outcome(storage.read());
      if (db.requests.at(-1)?.result === null) db.succeed();
      await microtasks();
      const tx = db.transactions.at(-1);
      tx.read(value);
      tx.complete();
      return promise;
    },
  };
}

export function document(count = 1) {
  let value = emptyCheckpointDocument();
  for (let index = 1; index <= count; index++) value = mutateCheckpoints(value, value.revision, saveOperation(index));
  return clone(value);
}

export function invariant(guard, assert) {
  const value = guard.state();
  assert(value.active >= 0 && value.active <= 4);
  assert.equal(value.opening + value.reading + value.writing + value.draining, value.active);
  assert(value.late >= value.uncertain);
  for (const key of ["accepted", "completed", "cancelled", "failed", "timedOut", "rejected"]) {
    assert(Number.isSafeInteger(value[key]) && value[key] >= 0);
  }
  return value;
}
