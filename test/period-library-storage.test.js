import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodLibraryStorage, PERIOD_LIBRARY_DATABASE } from "../src/period-library-storage.js";
import { createCheckpointStorage, CHECKPOINT_DATABASE } from "../src/checkpoint-storage.js";
import { emptyPeriodLibrary, mutatePeriodLibrary } from "../src/period-library-model.js";
import { saveOperation, checkpoint } from "./helpers/period-library-fixtures.js";
import { tick, code } from "./helpers/transfer-fixtures.js";

function controlled(options = {}) {
  const opens = [];
  const factory = { open(name, version) { const request = { name, version }; opens.push(request); return request; } };
  const storage = createPeriodLibraryStorage({ indexedDB: factory, ...options });
  const db = {
    closed: 0, transactions: [], created: [], objectStoreNames: { contains: () => true },
    close() { this.closed++; },
    createObjectStore(name) { this.created.push(name); },
    transaction(name, mode) {
      const get = {}, put = {};
      const transaction = { name, mode, get, put, aborts: 0, error: null,
        abort() { this.aborts++; queueMicrotask(() => this.onabort?.()); },
        objectStore() { return { get(key) { get.key = key; return get; }, put(value, key) { put.value = value; put.key = key; return put; } }; } };
      this.transactions.push(transaction);
      return transaction;
    },
  };
  async function open() { opens.at(-1).result = db; opens.at(-1).onsuccess(); await tick(); }
  async function get(value) { const tx = db.transactions.at(-1); tx.get.result = value; tx.get.onsuccess(); await tick(); return tx; }
  return { storage, opens, db, open, get };
}

test("period library storage is lazy and isolated from workspace checkpoints", async () => {
  const f = controlled();
  assert.notEqual(PERIOD_LIBRARY_DATABASE, CHECKPOINT_DATABASE);
  assert.equal(f.opens.length, 0);
  const reading = f.storage.read();
  assert.equal(f.opens[0].name, PERIOD_LIBRARY_DATABASE);
  assert.equal(f.opens[0].version, 1);
  await f.open();
  const tx = await f.get(undefined);
  tx.oncomplete();
  assert.deepEqual(await reading, emptyPeriodLibrary());
  assert.equal(tx.mode, "readonly");
  f.storage.close();
});

test("period library mutation waits for native transaction completion, not request success", async () => {
  const f = controlled();
  let resolved = false;
  const changing = f.storage.change(0, saveOperation()).then(value => { resolved = true; return value; });
  await f.open();
  const tx = await f.get(undefined);
  assert.equal(tx.mode, "readwrite");
  assert.equal(tx.put.value.schema, emptyPeriodLibrary().schema);
  tx.put.onsuccess?.();
  await tick();
  assert.equal(resolved, false);
  tx.oncomplete();
  const saved = await changing;
  assert.equal(saved.entries.length, 1);
  assert.equal(saved.revision, 1);
});

test("malformed stored data aborts and is never replaced by an empty document", async () => {
  const f = controlled();
  const reading = f.storage.read();
  const rejection = assert.rejects(reading, code("PERIOD_SHAPE"));
  await f.open();
  const tx = await f.get({ secret: "invalid" });
  await rejection;
  assert.equal(tx.aborts, 1);
  assert.equal(tx.put.value, undefined);
});

test("period library CAS errors preserve their specific recovery code", async () => {
  const f = controlled();
  const changing = f.storage.change(0, saveOperation(2, checkpoint(5)));
  const rejected = assert.rejects(changing, code("PERIOD_LIBRARY_STALE"));
  await f.open();
  const tx = await f.get(mutatePeriodLibrary(emptyPeriodLibrary(), 0, saveOperation()));
  await rejected;
  assert.equal(tx.put.value, undefined);
});

test("quota failure cannot be reported as a completed save", async () => {
  const f = controlled();
  const saving = f.storage.change(0, saveOperation());
  const rejected = assert.rejects(saving, code("CHECKPOINT_QUOTA"));
  await f.open();
  const tx = await f.get(undefined);
  tx.put.error = Object.assign(Error("device details"), { name: "QuotaExceededError" });
  tx.put.onerror();
  tx.onabort();
  await rejected;
});

test("a cancelled write aborts even after a put request has been queued", async () => {
  const f = controlled(), aborter = new AbortController();
  const saving = f.storage.change(0, saveOperation(), { signal: aborter.signal });
  const rejected = assert.rejects(saving, code("CHECKPOINT_CANCELLED"));
  await f.open();
  const tx = await f.get(undefined);
  assert.ok(tx.put.value);
  aborter.abort();
  // Native IndexedDB also emits AbortError on outstanding requests; it must not
  // overwrite the original cancellation reason used by the recovery UI.
  tx.put.error = Object.assign(Error(), { name: "AbortError" });
  tx.put.onerror();
  await rejected;
  assert.equal(tx.aborts, 1);
});

test("abort before opening creates no IndexedDB request", async () => {
  const f = controlled(), aborter = new AbortController();
  aborter.abort();
  await assert.rejects(f.storage.change(0, saveOperation(), { signal: aborter.signal }), code("CHECKPOINT_CANCELLED"));
  assert.equal(f.opens.length, 0);
});

test("abort while opening is checked before creating a transaction", async () => {
  const f = controlled(), aborter = new AbortController();
  const saving = f.storage.change(0, saveOperation(), { signal: aborter.signal });
  const rejected = assert.rejects(saving, code("CHECKPOINT_CANCELLED"));
  aborter.abort();
  await f.open();
  await rejected;
  assert.equal(f.db.transactions.length, 0);
});

test("commit guard is synchronous and rejects a revoked operation", async () => {
  const f = controlled();
  const saving = f.storage.change(0, saveOperation(), { canCommit: () => false });
  const rejected = assert.rejects(saving, code("CHECKPOINT_CANCELLED"));
  await f.open();
  const tx = await f.get(undefined);
  await rejected;
  assert.equal(tx.put.value, undefined);
});

test("successful commit removes abort listener so a later abort cannot undo it", async () => {
  const f = controlled(), aborter = new AbortController();
  const saving = f.storage.change(0, saveOperation(), { signal: aborter.signal });
  await f.open();
  const tx = await f.get(undefined);
  tx.oncomplete();
  assert.equal((await saving).revision, 1);
  aborter.abort();
  assert.equal(tx.aborts, 0);
});

test("closing the adapter aborts pending transactions", async () => {
  const f = controlled();
  const saving = f.storage.change(0, saveOperation());
  const rejected = assert.rejects(saving, code("CHECKPOINT_ABORTED"));
  await f.open();
  const tx = await f.get(undefined);
  f.storage.close();
  await rejected;
  assert.equal(tx.aborts, 1);
  assert.equal(f.db.closed, 1);
});

test("default checkpoint schema behavior remains untouched by the policy extension", async () => {
  const storage = createCheckpointStorage({ indexedDB: null });
  await assert.rejects(storage.read(), code("CHECKPOINT_UNAVAILABLE"));
  assert.throws(() => createCheckpointStorage({ documentPolicy: {} }), code("CHECKPOINT_ADAPTER"));
  storage.close();
});

test("invalid cancellation token fails before database opening", async () => {
  const f = controlled();
  await assert.rejects(f.storage.change(0, saveOperation(), { signal: {} }), code("CHECKPOINT_ADAPTER"));
  assert.equal(f.opens.length, 0);
});

test("period library version changes close old connections and allow a fresh explicit read", async () => {
  const f = controlled();
  const first = f.storage.read();
  await f.open();
  let tx = await f.get(undefined);
  tx.oncomplete();
  await first;
  f.db.onversionchange();
  assert.equal(f.db.closed, 1);
  const next = f.storage.read();
  assert.equal(f.opens.length, 2);
  await f.open();
  tx = await f.get(undefined);
  tx.oncomplete();
  await next;
  f.storage.close();
});
