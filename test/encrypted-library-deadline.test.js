import test from "node:test";
import assert from "node:assert/strict";
import { createEncryptedLibraryStorage } from "../src/encrypted-library-storage.js";
import { createEncryptedLibraryController } from "../src/encrypted-library-controller.js";
import { emptyEncryptedLibrary } from "../src/encrypted-library-model.js";
import { controlledDatabase, library, entry, memoryStorage, code, tick, gate } from "./helpers/encrypted-library-fixtures.js";

function fixture(t, options = {}) {
  const f = controlledDatabase();
  const storage = createEncryptedLibraryStorage({ indexedDB: f.factory, ...options });
  t.after(() => storage.close());
  return { ...f, storage };
}

test("a queued readonly transaction has an independent deadline", async t => {
  const f = fixture(t, { transactionTimeoutMs: 15 });
  const reading = f.storage.read();
  const rejection = assert.rejects(reading, code("LIBRARY_TIMEOUT"));
  f.success();
  await tick();
  const tx = f.db.transactions[0];
  assert.equal(tx.mode, "readonly");
  await rejection;
  assert.equal(tx.aborts, 1);
});

test("a read/write transaction that never commits does not remain pending forever", async t => {
  const f = fixture(t, { transactionTimeoutMs: 15 });
  const saving = f.storage.change(emptyEncryptedLibrary(), { kind: "add", entry: await entry() });
  const rejection = assert.rejects(saving, code("LIBRARY_TIMEOUT"));
  f.success();
  await tick();
  const tx = f.value(undefined);
  assert(tx.put.value);
  await rejection;
  assert.equal(tx.aborts, 1);
});

test("completed transactions cancel their timers instead of aborting later", async t => {
  const f = fixture(t, { transactionTimeoutMs: 15 });
  const reading = f.storage.read();
  f.success();
  await tick();
  const tx = f.value(undefined);
  tx.oncomplete();
  await reading;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(tx.aborts, 0);
});

test("pre-aborted read never opens a database", async t => {
  const f = fixture(t), abort = new AbortController();
  abort.abort();
  await assert.rejects(f.storage.read({ signal: abort.signal }), code("LIBRARY_CANCELLED"));
  assert.equal(f.requests.length, 0);
});

test("read cancellation while opening does not create a later transaction", async t => {
  const f = fixture(t), abort = new AbortController();
  const reading = f.storage.read({ signal: abort.signal });
  abort.abort();
  f.success();
  await assert.rejects(reading, code("LIBRARY_CANCELLED"));
  assert.equal(f.db.transactions.length, 0);
});

test("read cancellation after transaction creation aborts it promptly", async t => {
  const f = fixture(t), abort = new AbortController();
  const reading = f.storage.read({ signal: abort.signal });
  f.success();
  await tick();
  abort.abort();
  await assert.rejects(reading, code("LIBRARY_CANCELLED"));
  assert.equal(f.db.transactions[0].aborts, 1);
});

test("abort after completion does not affect a future transaction", async t => {
  const f = fixture(t), abort = new AbortController();
  const reading = f.storage.read({ signal: abort.signal });
  f.success();
  await tick();
  const first = f.value(undefined);
  first.oncomplete();
  await reading;
  const secondReading = f.storage.read();
  await tick();
  const second = f.value(undefined);
  abort.abort();
  assert.equal(first.aborts, 0);
  assert.equal(second.aborts, 0);
  second.oncomplete();
  await secondReading;
});

test("late get success after timeout cannot queue a write", async t => {
  const f = fixture(t, { transactionTimeoutMs: 10 });
  const saving = f.storage.change(emptyEncryptedLibrary(), { kind: "add", entry: await entry() });
  const rejection = assert.rejects(saving, code("LIBRARY_TIMEOUT"));
  f.success();
  await rejection;
  const tx = f.value(undefined);
  assert.equal(tx.put.value, undefined);
});

test("late transaction completion cannot turn a timeout into success", async t => {
  const f = fixture(t, { transactionTimeoutMs: 10 });
  const reading = f.storage.read();
  const rejection = assert.rejects(reading, code("LIBRARY_TIMEOUT"));
  f.success();
  await rejection;
  const tx = f.value(undefined);
  tx.oncomplete();
  await tick();
  await assert.rejects(reading, code("LIBRARY_TIMEOUT"));
});

test("the controller forwards its cancellation signal to a read adapter", async t => {
  let options;
  const pending = gate(), base = memoryStorage();
  const controller = createEncryptedLibraryController({ storage: { ...base,
    read(value) { options = value; return pending.promise; } } });
  t.after(() => controller.dispose());
  const loading = controller.load();
  assert(options.signal instanceof AbortSignal);
  controller.cancel();
  assert(options.signal.aborted);
  pending.resolve(emptyEncryptedLibrary());
  assert.equal(await loading, false);
});

test("controller deadline cancels native queued reads as well as local state", async t => {
  const f = fixture(t, { transactionTimeoutMs: 1000 });
  const controller = createEncryptedLibraryController({ storage: f.storage, deadlineMs: 15 });
  t.after(() => controller.dispose());
  const loading = controller.load();
  f.success();
  await tick();
  assert.equal(await loading, false);
  assert.equal(controller.state().errorCode, "LIBRARY_TIMEOUT");
  assert.equal(f.db.transactions[0].aborts, 1);
  assert.equal(controller.state().summary, null);
});

test("a subsequent read can recover after a timed-out transaction", async t => {
  const f = fixture(t, { transactionTimeoutMs: 10 });
  const reading = f.storage.read();
  const rejection = assert.rejects(reading, code("LIBRARY_TIMEOUT"));
  f.success();
  await rejection;
  const retry = f.storage.read();
  await tick();
  f.value(undefined).oncomplete();
  assert.deepEqual(await retry, emptyEncryptedLibrary());
});

test("disposal observers cannot restart work before the controller becomes closed", async () => {
  const storage = memoryStorage();
  const attempts = [];
  let controller;
  controller = createEncryptedLibraryController({ storage, onChange(state) {
    if (state.phase === "disposed" || state.phase === "cancelled") attempts.push(controller.load());
  } });
  controller.dispose();
  assert.deepEqual(await Promise.all(attempts), [false]);
  assert.equal(storage.calls.reads, 0);
});

for (const transactionTimeoutMs of [0, -1, 0.5, 60001, Infinity, "100", null]) {
  test("transaction deadline configuration is bounded: " + transactionTimeoutMs, () => {
    assert.throws(() => createEncryptedLibraryStorage({ transactionTimeoutMs }));
  });
}
