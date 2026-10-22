import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointStorage, checkpointStorageError, CHECKPOINT_DATABASE } from "../src/checkpoint-storage.js";
import { CheckpointError } from "../src/checkpoint-model.js";
import { stored, saveOperation } from "./helpers/checkpoint-fixtures.js";
import { tick } from "./helpers/workspace-fixtures.js";

// These controlled requests exercise error and cancellation paths. The browser suite
// separately tests actual IndexedDB commit, concurrency, persistence, and rollback.
function controlledOpen(options = {}) {
  const requests = [];
  const factory = {
    open(name, version) {
      const request = { name, version, result: null, error: null,
        transaction: { aborts: 0, abort() { this.aborts++; } } };
      requests.push(request);
      return request;
    },
  };
  const storage = createCheckpointStorage({ indexedDB: factory, ...options });
  const db = {
    closes: 0, created: [], transactions: [],
    objectStoreNames: { contains: () => true },
    close() { this.closes++; },
    createObjectStore(name) { this.created.push(name); },
    transaction(name, mode) {
      const get = {}, put = {};
      const store = { get: key => { get.key = key; return get; },
        put: (value, key) => { put.value = value; put.key = key; return put; } };
      const transaction = { name, mode, get, put, error: null,
        objectStore: () => store,
        aborts: 0,
        abort() { this.aborts++; queueMicrotask(() => this.onabort?.()); },
      };
      this.transactions.push(transaction);
      return transaction;
    },
  };
  function success() {
    const request = requests.at(-1);
    request.result = db;
    request.onsuccess();
  }
  return { factory, requests, storage, db, success };
}
const code = expected => error => error.code === expected;

test("storage factory opens nothing until a user action requests read", () => {
  const f = controlledOpen();
  assert.equal(f.requests.length, 0);
  f.storage.close();
  assert.equal(f.requests.length, 0);
});

test("the default database name is versioned and an explicit integer version is used", async () => {
  const f = controlledOpen();
  const reading = f.storage.read();
  assert.equal(f.requests[0].name, CHECKPOINT_DATABASE);
  assert.equal(f.requests[0].version, 1);
  f.storage.close();
  await assert.rejects(reading, code("CHECKPOINT_CLOSED"));
});

for (const options of [
  { name: "" }, { name: null }, { name: "x".repeat(161) },
  { openTimeoutMs: 0 }, { openTimeoutMs: 1.5 }, { openTimeoutMs: 60001 },
]) {
  test("invalid storage configuration is rejected " + JSON.stringify(options), () => {
    assert.throws(() => createCheckpointStorage(options), code("CHECKPOINT_ADAPTER"));
  });
}

test("unavailable IndexedDB rejects read without throwing at panel mount", async () => {
  const storage = createCheckpointStorage({ indexedDB: null });
  await assert.rejects(storage.read(), code("CHECKPOINT_UNAVAILABLE"));
  storage.close();
});

test("security errors opening a database remain recoverable UI errors", async () => {
  const storage = createCheckpointStorage({ indexedDB: {
    open() { throw Object.assign(Error("Sensitive browser error"), { name: "SecurityError" }); },
  } });
  await assert.rejects(storage.read(), code("CHECKPOINT_UNAVAILABLE"));
  storage.close();
});

test("two concurrent reads share one pending open request", async () => {
  const f = controlledOpen();
  const first = f.storage.read(), second = f.storage.read();
  assert.equal(f.requests.length, 1);
  f.storage.close();
  await assert.rejects(first, code("CHECKPOINT_CLOSED"));
  await assert.rejects(second, code("CHECKPOINT_CLOSED"));
});

test("a blocked upgrade fails promptly and closes a later successful handle", async () => {
  const f = controlledOpen();
  const reading = f.storage.read();
  f.requests[0].onblocked();
  await assert.rejects(reading, code("CHECKPOINT_BLOCKED"));
  f.success();
  assert.equal(f.db.closes, 1);
  assert.equal(f.db.transactions.length, 0);
  f.storage.close();
});

test("an upgrade arriving after cancellation is aborted", async () => {
  const f = controlledOpen();
  const reading = f.storage.read();
  f.storage.close();
  await assert.rejects(reading, code("CHECKPOINT_CLOSED"));
  f.requests[0].onupgradeneeded();
  assert.equal(f.requests[0].transaction.aborts, 1);
});

test("opening timeout cannot later attach a successful connection", async () => {
  const f = controlledOpen({ openTimeoutMs: 5 });
  await assert.rejects(f.storage.read(), code("CHECKPOINT_TIMEOUT"));
  f.success();
  assert.equal(f.db.closes, 1);
  f.storage.close();
});

test("a failed open can be retried explicitly", async () => {
  const f = controlledOpen();
  const first = f.storage.read();
  f.requests[0].error = Object.assign(Error(), { name: "VersionError" });
  f.requests[0].onerror();
  await assert.rejects(first, code("CHECKPOINT_VERSION"));
  const second = f.storage.read();
  assert.equal(f.requests.length, 2);
  f.storage.close();
  await assert.rejects(second, code("CHECKPOINT_CLOSED"));
});

test("an existing database without the expected store is not repaired or overwritten", async () => {
  const f = controlledOpen();
  f.db.objectStoreNames.contains = () => false;
  const reading = f.storage.read();
  f.success();
  await assert.rejects(reading, code("CHECKPOINT_SCHEMA"));
  assert.equal(f.db.closes, 1);
  assert.deepEqual(f.db.created, []);
  f.storage.close();
});

test("initial upgrade creates exactly the checkpoint object store", async () => {
  const f = controlledOpen();
  f.db.objectStoreNames.contains = () => false;
  const reading = f.storage.read();
  f.requests[0].result = f.db;
  f.requests[0].onupgradeneeded();
  assert.deepEqual(f.db.created, ["checkpoints"]);
  f.storage.close();
  await assert.rejects(reading, code("CHECKPOINT_CLOSED"));
});

test("read uses a readonly transaction and resolves only after completion", async () => {
  const f = controlledOpen();
  let resolved = false;
  const reading = f.storage.read().then(value => { resolved = true; return value; });
  f.success();
  await tick();
  const transaction = f.db.transactions[0];
  assert.equal(transaction.mode, "readonly");
  assert.equal(transaction.get.key, "current");
  transaction.get.result = undefined;
  transaction.get.onsuccess();
  await tick();
  assert.equal(resolved, false);
  transaction.oncomplete();
  assert.equal((await reading).entries.length, 0);
  assert.equal(transaction.put.value, undefined);
  f.storage.close();
});

test("write acknowledgment waits for commit, not just put success", async () => {
  const f = controlledOpen();
  let resolved = false;
  const writing = f.storage.change(0, saveOperation()).then(value => { resolved = true; return value; });
  f.success();
  await tick();
  const transaction = f.db.transactions[0];
  assert.equal(transaction.mode, "readwrite");
  transaction.get.onsuccess();
  assert.equal(transaction.put.value.entries.length, 1);
  assert.equal(transaction.put.key, "current");
  await tick();
  assert.equal(resolved, false);
  transaction.oncomplete();
  assert.equal((await writing).revision, 1);
  f.storage.close();
});

test("a failed put reports quota instead of claiming a save", async () => {
  const f = controlledOpen();
  const writing = f.storage.change(0, saveOperation());
  f.success();
  await tick();
  const transaction = f.db.transactions[0];
  transaction.get.onsuccess();
  transaction.put.error = Object.assign(Error("private disk path"), { name: "QuotaExceededError" });
  transaction.put.onerror();
  transaction.onabort();
  await assert.rejects(writing, code("CHECKPOINT_QUOTA"));
  f.storage.close();
});

test("read request failure is surfaced from transaction abort", async () => {
  const f = controlledOpen();
  const reading = f.storage.read();
  f.success();
  await tick();
  const transaction = f.db.transactions[0];
  transaction.get.error = Object.assign(Error(), { name: "SecurityError" });
  transaction.get.onerror();
  transaction.onabort();
  await assert.rejects(reading, code("CHECKPOINT_UNAVAILABLE"));
  f.storage.close();
});

test("malformed stored data aborts before any replacement write", async () => {
  const f = controlledOpen();
  const writing = f.storage.change(0, saveOperation());
  f.success();
  await tick();
  const transaction = f.db.transactions[0];
  transaction.get.result = { broken: "preserve" };
  transaction.get.onsuccess();
  await assert.rejects(writing, code("CHECKPOINT_SHAPE"));
  assert.equal(transaction.put.value, undefined);
  assert.equal(transaction.aborts, 1);
  f.storage.close();
});

test("a stale revision aborts before any replacement write", async () => {
  const f = controlledOpen();
  const writing = f.storage.change(0, saveOperation(2));
  f.success();
  await tick();
  const transaction = f.db.transactions[0];
  transaction.get.result = stored(1);
  transaction.get.onsuccess();
  await assert.rejects(writing, code("CHECKPOINT_STALE"));
  assert.equal(transaction.put.value, undefined);
  f.storage.close();
});

for (const canCommit of [() => false, () => undefined, () => "yes", null]) {
  test("write guard requires literal true " + String(canCommit), async () => {
    const f = controlledOpen();
    const writing = f.storage.change(0, saveOperation(), { canCommit });
    f.success();
    await tick();
    const transaction = f.db.transactions[0];
    transaction.get.onsuccess();
    await assert.rejects(writing, code("CHECKPOINT_CANCELLED"));
    assert.equal(transaction.put.value, undefined);
    f.storage.close();
  });
}

test("write guard failures retain their meaningful application error", async () => {
  const f = controlledOpen();
  const writing = f.storage.change(0, saveOperation(), {
    canCommit() { throw new CheckpointError("CHECKPOINT_DRAFT_CHANGED"); },
  });
  f.success();
  await tick();
  f.db.transactions[0].get.onsuccess();
  await assert.rejects(writing, code("CHECKPOINT_DRAFT_CHANGED"));
  f.storage.close();
});

test("closing during an active transaction aborts instead of reporting success", async () => {
  const f = controlledOpen();
  const writing = f.storage.change(0, saveOperation());
  f.success();
  await tick();
  f.storage.close();
  await assert.rejects(writing, code("CHECKPOINT_ABORTED"));
  assert.equal(f.db.transactions[0].aborts, 1);
  assert.equal(f.db.closes, 1);
});

test("completed transactions are not aborted by later disposal", async () => {
  const f = controlledOpen();
  const reading = f.storage.read();
  f.success();
  await tick();
  const transaction = f.db.transactions[0];
  transaction.get.onsuccess();
  transaction.oncomplete();
  await reading;
  f.storage.close();
  assert.equal(transaction.aborts, 0);
});

test("version change closes the handle and the next action performs a fresh open", async () => {
  const f = controlledOpen();
  const reading = f.storage.read();
  f.success();
  await tick();
  const transaction = f.db.transactions[0];
  transaction.get.onsuccess();
  transaction.oncomplete();
  await reading;
  f.db.onversionchange();
  assert.equal(f.db.closes, 1);
  const next = f.storage.read();
  assert.equal(f.requests.length, 2);
  f.storage.close();
  await assert.rejects(next, code("CHECKPOINT_CLOSED"));
});

test("disposed storage rejects future reads and changes without opening", async () => {
  const f = controlledOpen();
  f.storage.close();
  f.storage.close();
  await assert.rejects(f.storage.read(), code("CHECKPOINT_CLOSED"));
  await assert.rejects(f.storage.change(0, saveOperation()), code("CHECKPOINT_CLOSED"));
  assert.equal(f.requests.length, 0);
});

for (const [name, expected] of [
  ["QuotaExceededError", "CHECKPOINT_QUOTA"], ["SecurityError", "CHECKPOINT_UNAVAILABLE"],
  ["NotAllowedError", "CHECKPOINT_UNAVAILABLE"], ["VersionError", "CHECKPOINT_VERSION"],
  ["AbortError", "CHECKPOINT_ABORTED"], ["InvalidStateError", "CHECKPOINT_CLOSED"],
  ["Other", "CHECKPOINT_STORAGE"],
]) {
  test("storage error translation hides raw details for " + name, () => {
    const result = checkpointStorageError({ name, message: "secret-bearing error text" });
    assert.equal(result.code, expected);
    assert.equal(result.message, expected);
  });
}

