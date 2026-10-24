import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateEncryptedLibrary, ENCRYPTED_LIBRARY_SCHEMA, ENCRYPTED_LIBRARY_BYTES,
  emptyEncryptedLibrary, prepareLibraryEntry, mutateEncryptedLibrary } from "../src/encrypted-library-model.js";
import { createSecureBackupController } from "../src/secure-backup-controller.js";
import { encryptedLibraryStorageError } from "../src/encrypted-library-storage.js";
import { controllerFixture, encryptedText, PASSWORD } from "./helpers/secure-backup-fixtures.js";
import { envelope, code, clone, library } from "./helpers/encrypted-library-fixtures.js";

test("aggregate ciphertext capacity is enforced independently of the ten-record limit", () => {
  // Real bounded data, not a forged byte count. Three entries exceed 24 MiB.
  const text = envelope(1, 7 * 1024 * 1024);
  const parsed = JSON.parse(text);
  const entries = [];
  for (let i = 0; i < 3; i++) {
    const candidate = JSON.stringify({ ...parsed, cipher: { ...parsed.cipher,
      iv: btoa(String.fromCharCode(...new Uint8Array(12).fill(i + 1))) } });
    entries.push({ id: createHash("sha256").update(candidate).digest("hex"),
      savedAt: 1792820000000 + i, bytes: candidate.length, text: candidate });
  }
  assert(entries.slice(0, 2).reduce((sum, entry) => sum + entry.bytes, 0) < ENCRYPTED_LIBRARY_BYTES);
  const before = validateEncryptedLibrary({ schema: ENCRYPTED_LIBRARY_SCHEMA, revision: 1,
    entries: entries.slice(0, 2) });
  assert.throws(() => mutateEncryptedLibrary(before, before, { kind: "add", entry: entries[2] }), code("LIBRARY_CAPACITY"));
  assert.equal(before.entries.length, 2);
});

test("nested prototype fields in metadata are refused without mutating Object.prototype", async () => {
  const original = await library();
  const value = clone(original);
  Object.defineProperty(value.entries[0], "__proto__", { value: { polluted: true }, enumerable: true });
  assert.throws(() => validateEncryptedLibrary(value), code("LIBRARY_FORMAT"));
  assert.equal({}.polluted, undefined);
});

test("symbol and inherited record extras cannot enter the serialized store", async () => {
  const value = clone(await library());
  value.entries[0][Symbol("private")] = "hidden password";
  assert.throws(() => validateEncryptedLibrary(value), code("LIBRARY_FORMAT"));
  const inherited = clone(await library());
  Object.setPrototypeOf(inherited.entries[0], { hidden: "private" });
  assert.throws(() => validateEncryptedLibrary(inherited), code("LIBRARY_FORMAT"));
});

test("error code objects are not coerced or executed for a user-facing message", () => {
  let calls = 0;
  const trap = { toString() { calls++; throw Error("secret"); } };
  assert.equal(encryptedLibraryStorageError({ code: trap, name: trap }).code, "LIBRARY_STORAGE");
  assert.equal(calls, 0);
});

test("secure controller does not expose ciphertext until explicit encryption completes", async t => {
  const f = controllerFixture();
  t.after(() => f.controller.dispose());
  assert.throws(() => f.controller.encryptedText(), code("SECURE_NOT_READY"));
  await f.seal();
  assert.equal(f.controller.encryptedText(), encryptedText());
  assert.equal(f.controller.state().downloadOffered, false);
  f.change();
  assert.throws(() => f.controller.encryptedText(), code("SECURE_STALE"));
});

test("direct ciphertext handoff cannot bypass password or stage the workspace", async t => {
  const f = controllerFixture();
  t.after(() => f.controller.dispose());
  assert.equal(f.controller.selectText(encryptedText()), true);
  assert.equal(f.controller.state().canDecrypt, true);
  assert.equal(f.controller.state().canStage, false);
  assert.equal(f.controller.stage(), false);
  assert.equal(f.staged.length, 0);
  assert.equal(f.calls.length, 0);
});

test("invalid direct ciphertext clears an older decrypted candidate", async t => {
  const f = controllerFixture();
  t.after(() => f.controller.dispose());
  f.controller.selectText(encryptedText());
  await f.unlock();
  assert.equal(f.controller.state().canStage, true);
  assert.equal(f.controller.selectText('{"address":"private"}'), false);
  assert.equal(f.controller.state().canStage, false);
  assert.equal(f.staged.length, 0);
});

test("direct handoff cannot revive state after a reentrant cancel observer", () => {
  let controller;
  controller = createSecureBackupController({ readDraft: () => [], onStage: () => true,
    onChange(state) { if (state.phase === "reading") controller.cancel(); } });
  assert.equal(controller.selectText(encryptedText()), false);
  assert.equal(controller.state().phase, "cancelled");
  assert.equal(controller.state().canDecrypt, false);
  controller.dispose();
});

test("closed secure controller rejects direct handoff and encrypted text reads", async t => {
  const f = controllerFixture();
  t.after(() => f.controller.dispose());
  await f.seal();
  f.controller.dispose();
  assert.equal(f.controller.selectText(encryptedText()), false);
  assert.throws(() => f.controller.encryptedText(), code("SECURE_NOT_READY"));
});
