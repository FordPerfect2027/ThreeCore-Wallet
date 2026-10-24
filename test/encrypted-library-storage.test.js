import { createStorageGuard } from "../src/storage-guard.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createEncryptedLibraryStorage, ENCRYPTED_LIBRARY_DATABASE,
  encryptedLibraryStorageError } from "../src/encrypted-library-storage.js";
import { EncryptedLibraryError, emptyEncryptedLibrary } from "../src/encrypted-library-model.js";
import { controlledDatabase, entry, library, clone, code, tick } from "./helpers/encrypted-library-fixtures.js";

function fixture(t, options = {}) {
  const f = controlledDatabase();
  const storage = createEncryptedLibraryStorage({ indexedDB: f.factory, guard: createStorageGuard(), ...options });
  t.after(() => storage.close());
  return { ...f, storage,
    async startRead() {
      const reading = storage.read();
      f.success();
      await tick();
      return { reading };
    } };
}

test("encrypted library uses a dedicated database and stays unopened until requested", t => {
  const f = fixture(t);
  assert.equal(ENCRYPTED_LIBRARY_DATABASE, "threecore-encrypted-backups-v1");
  assert.equal(f.requests.length, 0);
  f.storage.close();
  assert.equal(f.requests.length, 0);
});

test("read creates no plaintext store or migration", async t => {
  const f = fixture(t);
  const reading = f.storage.read();
  const request = f.requests[0];
  assert.equal(request.name, ENCRYPTED_LIBRARY_DATABASE);
  assert.equal(request.version, 1);
  request.result = f.db;
  request.onupgradeneeded();
  assert.deepEqual(f.db.created, []);
  f.success();
  await tick();
  const tx = f.value(undefined);
  assert.equal(tx.mode, "readonly");
  assert.equal(tx.put.value, undefined);
  tx.oncomplete();
  assert.deepEqual(await reading, emptyEncryptedLibrary());
});

test("empty schema is created only during version upgrade", async t => {
  const f = fixture(t);
  const reading = f.storage.read();
  const request = f.requests[0];
  request.result = f.db;
  f.db.objectStoreNames.contains = () => false;
  request.onupgradeneeded();
  assert.deepEqual(f.db.created, ["checkpoints"]);
  f.db.objectStoreNames.contains = () => true;
  f.success();
  await tick();
  f.value(undefined).oncomplete();
  await reading;
});

test("read resolves only when the IndexedDB transaction completes", async t => {
  const f = fixture(t), initial = await library([1]);
  const { reading } = await f.startRead();
  let complete = false;
  reading.then(() => { complete = true; });
  const tx = f.value(initial);
  await tick();
  assert.equal(complete, false);
  tx.oncomplete();
  assert.deepEqual(await reading, initial);
});

test("successful ciphertext write is not reported before transaction commit", async t => {
  const f = fixture(t), added = await entry();
  const saving = f.storage.change(emptyEncryptedLibrary(), { kind: "add", entry: added });
  f.success();
  await tick();
  const tx = f.value(undefined);
  let complete = false;
  saving.then(() => { complete = true; });
  assert.equal(tx.mode, "readwrite");
  assert.deepEqual(tx.put.value.entries, [added]);
  await tick();
  assert.equal(complete, false);
  tx.oncomplete();
  assert.equal((await saving).revision, 1);
});

test("storage refuses plaintext fields in an otherwise valid record", async t => {
  const f = fixture(t), value = { ...await entry(), passphrase: "must not persist" };
  const saving = f.storage.change(emptyEncryptedLibrary(), { kind: "add", entry: value });
  f.success();
  await tick();
  const tx = f.value(undefined);
  await assert.rejects(saving, code("LIBRARY_FORMAT"));
  assert.equal(tx.put.value, undefined);
  assert.equal(tx.aborts, 1);
});

test("revision conflict aborts before enqueueing a write", async t => {
  const f = fixture(t), before = await library([1]), current = await library([1, 2]);
  const deleting = f.storage.change(before, { kind: "remove", id: before.entries[0].id });
  f.success();
  await tick();
  const tx = f.value(current);
  await assert.rejects(deleting, code("LIBRARY_CONFLICT"));
  assert.equal(tx.put.value, undefined);
  assert.equal(tx.aborts, 1);
});

test("same revision with modified contents also aborts before write", async t => {
  const f = fixture(t), before = await library([1]);
  const current = clone(before);
  current.entries[0].savedAt++;
  const deleting = f.storage.change(before, { kind: "remove", id: before.entries[0].id });
  f.success();
  await tick();
  const tx = f.value(current);
  await assert.rejects(deleting, code("LIBRARY_CONFLICT"));
  assert.equal(tx.put.value, undefined);
});

test("duplicate save completes without enqueueing a redundant put", async t => {
  const f = fixture(t), value = await library([1]);
  const saving = f.storage.change(value, { kind: "add", entry: value.entries[0] });
  f.success();
  await tick();
  const tx = f.value(value);
  assert.equal(tx.put.value, undefined);
  tx.oncomplete();
  assert.deepEqual(await saving, value);
});

test("quota error after a put rejects the entire operation", async t => {
  const f = fixture(t), added = await entry();
  const saving = f.storage.change(emptyEncryptedLibrary(), { kind: "add", entry: added });
  f.success();
  await tick();
  const tx = f.value(undefined);
  tx.put.error = new DOMException("sensitive native message", "QuotaExceededError");
  tx.put.onerror();
  tx.onabort();
  await assert.rejects(saving, code("LIBRARY_QUOTA"));
});

test("pre-aborted change never opens the database", async t => {
  const f = fixture(t), abort = new AbortController();
  abort.abort();
  await assert.rejects(f.storage.change(emptyEncryptedLibrary(), { kind: "add", entry: await entry() },
    { signal: abort.signal }), code("LIBRARY_CANCELLED"));
  assert.equal(f.requests.length, 0);
});

test("cancellation while opening starts no later transaction", async t => {
  const f = fixture(t), abort = new AbortController();
  const saving = f.storage.change(emptyEncryptedLibrary(), { kind: "add", entry: await entry() },
    { signal: abort.signal });
  abort.abort();
  f.success();
  await assert.rejects(saving, code("LIBRARY_CANCELLED"));
  assert.equal(f.db.transactions.length, 0);
});

test("cancellation after the read aborts an already queued write", async t => {
  const f = fixture(t), abort = new AbortController();
  const saving = f.storage.change(emptyEncryptedLibrary(), { kind: "add", entry: await entry() },
    { signal: abort.signal });
  f.success();
  await tick();
  const tx = f.value(undefined);
  assert(tx.put.value);
  abort.abort();
  await assert.rejects(saving, code("LIBRARY_CANCELLED"));
  assert.equal(tx.aborts, 1);
});

test("commit guard can veto after database read without issuing a put", async t => {
  const f = fixture(t);
  const saving = f.storage.change(emptyEncryptedLibrary(), { kind: "add", entry: await entry() },
    { canCommit: () => false });
  f.success();
  await tick();
  const tx = f.value(undefined);
  await assert.rejects(saving, code("LIBRARY_CANCELLED"));
  assert.equal(tx.put.value, undefined);
});

test("blocked upgrade closes a late successful connection", async t => {
  const f = fixture(t);
  const reading = f.storage.read();
  f.requests[0].onblocked();
  await assert.rejects(reading, code("LIBRARY_BLOCKED"));
  f.success();
  assert.equal(f.db.closes, 1);
  assert.equal(f.db.transactions.length, 0);
});

test("open timeout cannot revive a late connection", async t => {
  const f = fixture(t, { openTimeoutMs: 5 });
  const reading = f.storage.read();
  await assert.rejects(reading, code("LIBRARY_TIMEOUT"));
  f.success();
  assert.equal(f.db.closes, 1);
});

test("version change closes the old connection and the next read reopens", async t => {
  const f = fixture(t);
  const { reading } = await f.startRead();
  f.value(undefined).oncomplete();
  await reading;
  f.db.onversionchange();
  assert.equal(f.db.closes, 1);
  const second = f.storage.read();
  assert.equal(f.requests.length, 2);
  f.success();
  await tick();
  f.value(undefined).oncomplete();
  await second;
});

test("closing aborts an in-progress write and refuses later operations", async t => {
  const f = fixture(t);
  const saving = f.storage.change(emptyEncryptedLibrary(), { kind: "add", entry: await entry() });
  f.success();
  await tick();
  const tx = f.value(undefined);
  f.storage.close();
  await assert.rejects(saving, code("LIBRARY_CANCELLED"));
  assert.equal(tx.aborts, 1);
  await assert.rejects(f.storage.read(), code("LIBRARY_CLOSED"));
});

test("missing required object store refuses the database", async t => {
  const f = fixture(t);
  const reading = f.storage.read();
  f.db.objectStoreNames.contains = () => false;
  f.success();
  await assert.rejects(reading, code("LIBRARY_FORMAT"));
  assert.equal(f.db.closes, 1);
});

test("unavailable storage stays optional for the surrounding wallet", async () => {
  const storage = createEncryptedLibraryStorage({ indexedDB: null });
  await assert.rejects(storage.read(), code("LIBRARY_UNAVAILABLE"));
  storage.close();
});

for (const [name, expected] of [
  ["QuotaExceededError", "LIBRARY_QUOTA"], ["SecurityError", "LIBRARY_UNAVAILABLE"],
  ["NotAllowedError", "LIBRARY_UNAVAILABLE"], ["VersionError", "LIBRARY_FORMAT"],
  ["InvalidStateError", "LIBRARY_CLOSED"], ["AbortError", "LIBRARY_CANCELLED"],
  ["UnknownError", "LIBRARY_STORAGE"],
]) {
  test("native exception mapping uses a static message for " + name, () => {
    const error = encryptedLibraryStorageError(new DOMException("seed / private text", name));
    assert.equal(error.code, expected);
    assert.equal(error.message, expected);
  });
}

test("untrusted error getters are not evaluated", () => {
  let calls = 0;
  const error = { get name() { calls++; throw Error("private"); },
    get code() { calls++; throw Error("private"); } };
  assert.equal(encryptedLibraryStorageError(error).code, "LIBRARY_STORAGE");
  assert.equal(calls, 0);
});

test("known library errors retain their recognized code", () => {
  const original = new EncryptedLibraryError("LIBRARY_CONFLICT");
  original.message = "private details must not escape";
  const result = encryptedLibraryStorageError(original);
  assert.equal(result.code, "LIBRARY_CONFLICT");
  assert.equal(result.message, "LIBRARY_CONFLICT");
  assert.notEqual(result, original);
});
