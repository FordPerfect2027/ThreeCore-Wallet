import { backupHeader, prepareEncryptedEnvelope } from "../../src/secure-backup-format.js";
import { emptyEncryptedLibrary, mutateEncryptedLibrary, prepareLibraryEntry } from "../../src/encrypted-library-model.js";

export const clone = value => JSON.parse(JSON.stringify(value));
export const code = expected => error => error.code === expected;
export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
export function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function envelope(seed = 1, size = 32) {
  return prepareEncryptedEnvelope(backupHeader(new Uint8Array(16).fill(seed),
    new Uint8Array(12).fill(seed)), new Uint8Array(size).fill(seed)).text;
}
export async function entry(seed = 1, options) {
  return prepareLibraryEntry(envelope(seed), { now: () => 1792820000000 + seed, ...options });
}
export async function library(seeds = [1]) {
  let value = emptyEncryptedLibrary();
  for (const seed of seeds) value = mutateEncryptedLibrary(value, value,
    { kind: "add", entry: await entry(seed) });
  return value;
}
/** Deliberately models only application-visible transactions; native IDB is tested separately. */
export function memoryStorage(initial = emptyEncryptedLibrary()) {
  let value = clone(initial), closed = false;
  const calls = { reads: 0, writes: 0, closes: 0, operations: [] };
  return {
    calls,
    snapshot: () => clone(value),
    replace(next) { value = clone(next); },
    async read() {
      calls.reads++;
      if (closed) throw Error("closed");
      return clone(value);
    },
    async change(expected, operation, { canCommit, signal } = {}) {
      if (closed || signal?.aborted || canCommit?.() !== true) throw Error("cancelled");
      const next = mutateEncryptedLibrary(value, expected, operation);
      calls.writes++;
      calls.operations.push(clone(operation));
      value = clone(next);
      return clone(next);
    },
    close() { closed = true; calls.closes++; },
  };
}

export function controlledDatabase() {
  const requests = [];
  const factory = { open(name, version) {
    const request = { name, version, result: null, error: null,
      transaction: { aborts: 0, abort() { this.aborts++; } } };
    requests.push(request);
    return request;
  } };
  const db = {
    closes: 0, created: [], transactions: [],
    objectStoreNames: { contains: () => true },
    close() { this.closes++; },
    createObjectStore(name) { this.created.push(name); },
    transaction(name, mode) {
      const get = {}, put = {};
      const store = { get(key) { get.key = key; return get; },
        put(value, key) { put.value = value; put.key = key; return put; } };
      const transaction = { name, mode, get, put, error: null, aborts: 0,
        objectStore: () => store,
        abort() { this.aborts++; queueMicrotask(() => this.onabort?.()); } };
      this.transactions.push(transaction);
      return transaction;
    },
  };
  return { factory, requests, db,
    success() { const request = requests.at(-1); request.result = db; request.onsuccess(); },
    value(value) { const tx = db.transactions.at(-1); tx.get.result = value; tx.get.onsuccess(); return tx; },
  };
}
