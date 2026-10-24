import test from "node:test";
import assert from "node:assert/strict";
import { inspectEncryptedBackup, encodeBackupBase64, decodeBackupBase64,
  backupHeader, prepareEncryptedEnvelope, SECURE_BACKUP_LIMIT } from "../src/secure-backup-format.js";
import { WORKSPACE_FILE_LIMIT } from "../src/workspace-file.js";
import { createSecureBackupController } from "../src/secure-backup-controller.js";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { controllerFixture, PASSWORD, envelope, encryptedText, fakePrepared,
  fakeDecoded, draft, fileObject, gate, tick } from "./helpers/secure-backup-fixtures.js";

test("maximum supported ciphertext round trips without argument-stack overflow", () => {
  const bytes = new Uint8Array(WORKSPACE_FILE_LIMIT + 16);
  bytes[0] = 255;
  bytes[bytes.length - 1] = 123;
  const encoded = encodeBackupBase64(bytes);
  const decoded = decodeBackupBase64(encoded, 17, WORKSPACE_FILE_LIMIT + 16);
  assert.equal(decoded.length, bytes.length);
  assert.equal(decoded[0], 255);
  assert.equal(decoded.at(-1), 123);
  const prepared = prepareEncryptedEnvelope(backupHeader(new Uint8Array(16), new Uint8Array(12)), bytes);
  assert(prepared.byteLength < SECURE_BACKUP_LIMIT);
  assert.equal(inspectEncryptedBackup(prepared.text).ciphertext.length, bytes.length);
});

test("one byte beyond ciphertext limit is rejected before base64 encoding", () => {
  assert.throws(() => encodeBackupBase64(new Uint8Array(WORKSPACE_FILE_LIMIT + 17)),
    error => error.code === "SECURE_SIZE");
});

test("oversized selected file is rejected without invoking arrayBuffer", async () => {
  let reads = 0;
  const f = controllerFixture();
  assert.equal(await f.controller.select({ size: SECURE_BACKUP_LIMIT + 1,
    async arrayBuffer() { reads++; return new ArrayBuffer(0); } }), false);
  assert.equal(reads, 0);
  assert.equal(f.calls.length, 0);
});

test("declared file size cannot hide larger actual bytes", async () => {
  const f = controllerFixture();
  assert.equal(await f.controller.select(fileObject(encryptedText(), { size: 1 })), false);
  assert.equal(f.controller.state().errorCode, "SECURE_READ");
  assert.equal(f.calls.length, 0);
});

test("truncated stream is rejected even when JSON bytes look complete", async () => {
  const bytes = new TextEncoder().encode(encryptedText());
  const f = controllerFixture();
  assert.equal(await f.controller.select({ size: bytes.length + 1,
    stream() { return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }); } }), false);
  assert.equal(f.controller.state().canDecrypt, false);
});

test("multiple UTF8 stream chunks produce exactly one validated selection", async () => {
  const bytes = new TextEncoder().encode(encryptedText());
  const f = controllerFixture();
  const file = { size: bytes.length,
    stream() {
      let offset = 0;
      return new ReadableStream({ pull(controller) {
        if (offset >= bytes.length) controller.close();
        else { controller.enqueue(bytes.slice(offset, offset + 7)); offset += 7; }
      } });
    } };
  assert.equal(await f.controller.select(file), true);
  assert.equal(f.controller.state().phase, "selected");
  assert.equal(f.calls.length, 0);
  assert.equal(f.notifications.filter(state => state.phase === "selected").length, 1);
});

test("file cancellation cancels native stream without exposing partial JSON", async () => {
  let cancelled = false;
  const waiting = gate();
  const f = controllerFixture();
  const file = { size: 100, stream() { return new ReadableStream({
    pull() { return waiting.promise; }, cancel() { cancelled = true; },
  }); } };
  const work = f.controller.select(file);
  await tick();
  f.controller.cancel();
  assert.equal(await work, false);
  assert.equal(cancelled, true);
  assert.equal(f.controller.state().phase, "cancelled");
  assert.equal(f.controller.state().canDecrypt, false);
  waiting.resolve();
});

test("file object metadata access errors become generic read errors", async () => {
  const f = controllerFixture();
  const file = { get size() { throw Error(PASSWORD); } };
  assert.equal(await f.controller.select(file), false);
  assert.equal(f.controller.state().errorCode, "SECURE_READ");
  assert(!JSON.stringify(f.notifications).includes(PASSWORD));
});

test("filename is never rendered, serialized or passed into cryptography", async () => {
  const f = controllerFixture();
  const name = '<img src=x onerror="throw 1">' + PASSWORD;
  await f.controller.select(fileObject(encryptedText(), { name }));
  await f.unlock();
  assert(!JSON.stringify(f.notifications).includes(name));
  assert(!f.calls[0].text.includes(name));
  assert.equal(f.calls[0].kind, "decrypt");
});

test("native File with no extension can be selected by validated content", async () => {
  const f = controllerFixture();
  assert.equal(await f.controller.select(new File([encryptedText()], "backup")), true);
  assert.equal(f.controller.state().canDecrypt, true);
});

test("MIME declaration is never trusted over file contents", async () => {
  const f = controllerFixture();
  assert.equal(await f.controller.select(new File(["not JSON"], "valid.json", { type: "application/json" })), false);
  assert.equal(f.controller.state().canDecrypt, false);
});

test("binary data with a JSON extension cannot reach KDF", async () => {
  const f = controllerFixture();
  assert.equal(await f.controller.select(new File([new Uint8Array([255, 254, 252])], "valid.json")), false);
  assert.equal(f.calls.length, 0);
});

test("unknown KDF extension cannot force an alternate native operation", async () => {
  const value = envelope();
  value.kdf.memory = 999999999;
  const f = controllerFixture();
  assert.equal(await f.controller.select(fileObject(JSON.stringify(value))), false);
  assert.equal(f.calls.length, 0);
});

test("download callback that cancels does not resurrect ready or saved state", async () => {
  const f = controllerFixture();
  await f.seal();
  assert.equal(f.controller.offer(() => f.controller.cancel()), false);
  assert.equal(f.controller.state().phase, "cancelled");
  assert.equal(f.controller.state().downloadOffered, false);
});

test("stage callback that cancels cannot resurrect staged state", async () => {
  let controller;
  const f = controllerFixture({ onStage() { controller.cancel(); return true; } });
  controller = f.controller;
  await f.select();
  await f.unlock();
  assert.equal(controller.stage(), false);
  assert.equal(controller.state().phase, "cancelled");
  assert.equal(controller.state().canStage, false);
});

test("reentrant staging cannot hand plaintext off twice", async () => {
  let controller;
  let deliveries = 0;
  const f = controllerFixture({ onStage() {
    deliveries++;
    assert.equal(controller.stage(), false);
    return true;
  } });
  controller = f.controller;
  await f.select();
  await f.unlock();
  controller.stage();
  assert.equal(deliveries, 1);
});

test("public API exposes no provider, signing, sending, storage or password accessor", () => {
  const f = controllerFixture();
  assert.deepEqual(Object.keys(f.controller).sort(), ["cancel", "dispose", "invalidate", "offer", "seal", "select", "stage", "state", "unlock"]);
});

test("bad configuration is rejected before any data access", () => {
  assert.throws(() => createSecureBackupController(), error => error.code === "SECURE_INTERNAL");
  assert.throws(() => createSecureBackupController({ readDraft: draft }), error => error.code === "SECURE_INTERNAL");
});

test("completed file selection after dispose cannot overwrite a successor panel", async () => {
  const pending = gate();
  const old = controllerFixture({ readText: () => pending.promise });
  const oldRead = old.select();
  old.controller.dispose();
  const successor = controllerFixture();
  await successor.select();
  await successor.unlock();
  const expected = successor.controller.state();
  pending.resolve(encryptedText());
  assert.equal(await oldRead, false);
  assert.deepEqual(successor.controller.state(), expected);
  assert.equal(old.controller.state().phase, "disposed");
});

test("disposal and remount share the CPU guard until old native work finishes", async () => {
  const runner = createSecureBackupRunner();
  const pending = gate();
  const old = controllerFixture({ runner, decrypt: () => pending.promise });
  await old.select();
  const oldDecrypt = old.unlock();
  await tick();
  old.controller.dispose();
  assert.equal(await oldDecrypt, false);
  const successor = controllerFixture({ runner });
  await successor.select();
  assert.equal(await successor.unlock(), false);
  assert.equal(successor.controller.state().errorCode, "SECURE_BUSY");
  pending.resolve(fakeDecoded());
  await tick();
  await successor.select();
  assert.equal(await successor.unlock(), true);
});

test("starting a new seal clears an older unlocked restore candidate", async () => {
  const f = controllerFixture();
  await f.select();
  await f.unlock();
  await f.seal();
  assert.equal(f.controller.state().canStage, false);
  assert.equal(f.controller.state().summary, null);
  assert.equal(f.controller.state().canDownload, true);
});

test("starting a new file selection clears an older encrypted download", async () => {
  const f = controllerFixture();
  await f.seal();
  await f.select();
  assert.equal(f.controller.state().canDownload, false);
  assert.equal(f.controller.state().canDecrypt, true);
});
