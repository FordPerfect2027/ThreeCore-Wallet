import { createStorageGuard } from "../src/storage-guard.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createReportHistoryStorage, REPORT_HISTORY_DATABASE } from "../src/report-history-storage.js";
import { PERIOD_LIBRARY_DATABASE } from "../src/period-library-storage.js";
import { emptyReportHistory } from "../src/report-history-model.js";
import { historyDocument, historyRecord, saveHistory, code, tick } from "./helpers/report-history-fixtures.js";

function controlled(options = {}) {
  const opens = [];
  const factory = { open(name, version) { const request = { name, version }; opens.push(request); return request; } };
  const storage = createReportHistoryStorage({ indexedDB: factory, guard: createStorageGuard(), ...options });
  const db = { closed: 0, transactions: [], objectStoreNames: { contains: () => true },
    close() { this.closed++; },
    transaction(name, mode) {
      const get = {}, put = {};
      const transaction = { name, mode, get, put, aborts: 0,
        abort() { this.aborts++; queueMicrotask(() => this.onabort?.()); },
        objectStore() { return { get() { return get; }, put(value) { put.value = value; return put; } }; },
      };
      this.transactions.push(transaction); return transaction;
    },
  };
  async function open() { opens.at(-1).result = db; opens.at(-1).onsuccess(); await tick(); }
  async function get(value) {
    const tx = db.transactions.at(-1); tx.get.result = value; tx.get.onsuccess(); await tick(); return tx;
  }
  return { storage, opens, db, open, get };
}

test("report history storage is lazy and separated from acquired period records", async () => {
  const f = controlled();
  assert.equal(f.opens.length, 0); assert.notEqual(REPORT_HISTORY_DATABASE, PERIOD_LIBRARY_DATABASE);
  const reading = f.storage.read(); assert.equal(f.opens[0].name, REPORT_HISTORY_DATABASE);
  await f.open(); const tx = await f.get(undefined); assert.equal(tx.mode, "readonly");
  tx.oncomplete(); assert.deepEqual(await reading, emptyReportHistory()); f.storage.close();
});
test("write success waits for the transaction commit, not a successful put request", async () => {
  const f = controlled(); let completed = false;
  const writing = f.storage.change(0, saveHistory()).then(value => { completed = true; return value; });
  await f.open(); const tx = await f.get(undefined);
  assert.equal(tx.mode, "readwrite"); assert.equal(tx.put.value.entries.length, 1);
  tx.put.onsuccess?.(); await tick(); assert.equal(completed, false);
  tx.oncomplete(); assert.equal((await writing).revision, 1); f.storage.close();
});
test("native storage preserves historical evidence and metadata on read", async () => {
  const f = controlled(), saved = historyDocument([historyRecord(1, { archived: true })], 9);
  const reading = f.storage.read(); await f.open(); const tx = await f.get(saved); tx.oncomplete();
  assert.deepEqual(await reading, saved); assert.equal(tx.put.value, undefined); f.storage.close();
});
test("damaged database is never silently replaced by an empty one", async () => {
  const f = controlled(), reading = f.storage.read(), rejected = assert.rejects(reading, code("PERIOD_SHAPE"));
  await f.open(); const tx = await f.get({ unknown: true }); await rejected;
  assert.equal(tx.aborts, 1); assert.equal(tx.put.value, undefined); f.storage.close();
});
test("stale native transaction cannot overwrite another writer", async () => {
  const f = controlled(), writing = f.storage.change(0, saveHistory(2));
  const rejected = assert.rejects(writing, code("PERIOD_HISTORY_STALE"));
  await f.open(); const tx = await f.get(historyDocument([historyRecord()], 1)); await rejected;
  assert.equal(tx.put.value, undefined); f.storage.close();
});
test("quota abort is exposed as failure, never as a completed report save", async () => {
  const f = controlled(), writing = f.storage.change(0, saveHistory());
  const rejected = assert.rejects(writing, code("CHECKPOINT_QUOTA"));
  await f.open(); const tx = await f.get(undefined);
  tx.put.error = Object.assign(Error("private device detail"), { name: "QuotaExceededError" }); tx.put.onerror();
  // The native database aborts automatically after this failed request.
  tx.onabort(); await rejected; f.storage.close();
});
test("cancel signal aborts a pending transaction", async () => {
  const aborter = new AbortController(), f = controlled();
  const writing = f.storage.change(0, saveHistory(), { signal: aborter.signal });
  const rejected = assert.rejects(writing, code("CHECKPOINT_CANCELLED"));
  await f.open(); const tx = await f.get(undefined); aborter.abort(); await rejected;
  assert.equal(tx.aborts, 1); f.storage.close();
});
test("changed source canCommit predicate prevents putting a stale report", async () => {
  const f = controlled(); let current = true;
  const writing = f.storage.change(0, saveHistory(), { canCommit: () => current });
  const rejected = assert.rejects(writing, code("CHECKPOINT_CANCELLED"));
  await f.open(); current = false; const tx = await f.get(undefined); await rejected;
  assert.equal(tx.put.value, undefined); f.storage.close();
});
test("closed adapter cannot reopen or accept late native reads", async () => {
  const f = controlled(), reading = f.storage.read();
  const rejected = assert.rejects(reading, code("CHECKPOINT_CLOSED")); f.storage.close(); await rejected;
  await f.open(); assert.equal(f.db.closed, 1);
  await assert.rejects(f.storage.read(), code("CHECKPOINT_CLOSED"));
});
test("blocked database gives a retryable error without writes", async () => {
  const f = controlled(), reading = f.storage.read();
  const rejected = assert.rejects(reading, code("CHECKPOINT_BLOCKED")); f.opens[0].onblocked(); await rejected;
  assert.equal(f.db.transactions.length, 0); f.storage.close();
});
test("database opening times out without returning fabricated empty data", async () => {
  const f = controlled({ openTimeoutMs: 5 });
  await assert.rejects(f.storage.read(), code("CHECKPOINT_TIMEOUT")); f.storage.close();
});
