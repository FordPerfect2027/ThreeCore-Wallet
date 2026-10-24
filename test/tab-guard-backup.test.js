import test from "node:test";
import assert from "node:assert/strict";
import { createTabGuard } from "../src/tab-guard-controller.js";
import { runProtectionBatch } from "../src/protection-batch.js";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { createEncryptedLibraryController } from "../src/encrypted-library-controller.js";
import { encryptWorkspaceBackup, decryptWorkspaceBackup } from "../src/secure-backup-crypto.js";
import { workspaceFromDraft } from "../src/workspace-format.js";
import { controllerFixture, PASSWORD, fakePrepared, fakeDecoded, encryptedText,
  draft, gate, tick, traceCrypto } from "./helpers/secure-backup-fixtures.js";
import { memoryStorage, library, envelope } from "./helpers/encrypted-library-fixtures.js";
import { clockFixture, transportFixture, deterministicCrypto, signal } from "./helpers/tab-guard-fixtures.js";

function protection(cleanup) {
  const clock = clockFixture(), wire = transportFixture(), reasons = [];
  const guard = createTabGuard({ ...clock.options, crypto: deterministicCrypto(), transport: wire.transport,
    onStop(reason) { reasons.push(reason); return runProtectionBatch([{ name: "backup", run: cleanup }]).completed; } });
  assert(guard.start());
  return { guard, wire, reasons, clock, stop: () => wire.deliver(signal()), close: () => guard.dispose() };
}

for (const phase of ["encrypting", "decrypting", "reading"]) {
  for (const rejects of [false, true]) {
    test("peer stop invalidates pending " + phase + " with late rejection=" + rejects, async () => {
      const pending = gate(), entered = gate();
      const f = controllerFixture({
        encrypt() { entered.resolve(); return pending.promise; },
        decrypt() { entered.resolve(); return pending.promise; },
        readText() { entered.resolve(); return pending.promise; },
      });
      const p = protection(() => f.controller.invalidate());
      try {
        let operation;
        if (phase === "encrypting") operation = f.seal();
        if (phase === "decrypting") {
          assert(f.controller.selectText(encryptedText()));
          operation = f.unlock();
        }
        if (phase === "reading") operation = f.select();
        await entered.promise;
        assert.equal(f.controller.state().phase, phase);
        p.stop();
        assert.equal(p.wire.posts[0].kind, "receipt");
        if (rejects) pending.reject(Error("synthetic secret result"));
        else pending.resolve(phase === "encrypting" ? fakePrepared() :
          phase === "decrypting" ? fakeDecoded() : encryptedText());
        assert.equal(await operation, false);
        assert.equal(f.controller.state().phase, "idle");
        assert.equal(f.controller.state().canStage, false);
        assert.equal(f.controller.state().canDownload, false);
        assert.equal(f.controller.state().canDecrypt, false);
        assert.equal(f.controller.state().summary, null);
        assert.equal(f.staged.length, 0);
        assert(!JSON.stringify(f.notifications).includes("synthetic secret result"));
      } finally { pending.resolve(fakePrepared()); p.close(); f.controller.dispose(); }
    });
  }
}

test("an already prepared encrypted download is invalidated by peer stop", async () => {
  const f = controllerFixture(), downloads = [];
  const p = protection(() => f.controller.invalidate());
  try {
    assert(await f.seal()); assert(f.controller.state().canDownload);
    p.stop();
    assert.equal(f.controller.offer(value => downloads.push(value)), false);
    assert.equal(downloads.length, 0);
    assert.throws(() => f.controller.encryptedText(), { code: "SECURE_NOT_READY" });
  } finally { p.close(); f.controller.dispose(); }
});

test("already decrypted plaintext cannot be staged after peer stop", async () => {
  const f = controllerFixture();
  const p = protection(() => f.controller.invalidate());
  try {
    await f.select(); await f.unlock();
    assert.equal(f.controller.state().canStage, true);
    p.stop();
    assert.equal(f.controller.stage(), false);
    assert.equal(f.staged.length, 0);
    assert.equal(f.controller.state().summary, null);
    assert.equal(p.guard.state().received, 1);
  } finally { p.close(); f.controller.dispose(); }
});

test("a valid explicit new backup operation remains available after protection cleanup", async () => {
  const f = controllerFixture();
  const p = protection(() => f.controller.invalidate());
  try {
    await f.select(); await f.unlock(); p.stop();
    assert.equal(f.controller.state().canStage, false);
    assert.equal(await f.seal(), true);
    assert.equal(f.controller.state().canDownload, true);
    assert.equal(f.staged.length, 0);
    assert.equal(p.wire.posts.length, 1);
  } finally { p.close(); f.controller.dispose(); }
});

test("peer stop discards an in-flight real AES-GCM result after native work completes", async () => {
  const nativeFinished = gate(), release = gate();
  const traced = traceCrypto({ async encrypt(...args) {
    const { webcrypto } = await import("node:crypto");
    const ciphertext = await webcrypto.subtle.encrypt(...args);
    nativeFinished.resolve();
    await release.promise;
    return ciphertext;
  } });
  const f = controllerFixture({ encrypt: encryptWorkspaceBackup, crypto: traced.crypto });
  const p = protection(() => f.controller.invalidate());
  try {
    const operation = f.seal();
    await nativeFinished.promise;
    p.stop(); release.resolve();
    assert.equal(await operation, false);
    await tick();
    assert.equal(f.controller.state().canDownload, false);
    assert.equal(f.controller.state().phase, "idle");
    assert.equal(f.staged.length, 0);
    assert(traced.calls.some(value => value.name === "encrypt"));
    assert.equal(p.wire.posts[0].kind, "receipt");
  } finally { release.resolve(); p.close(); f.controller.dispose(); }
});

test("peer stop discards plaintext from a completed native decryption before staging", async () => {
  const sealed = await encryptWorkspaceBackup(workspaceFromDraft(draft()), PASSWORD);
  const nativeFinished = gate(), release = gate();
  const traced = traceCrypto({ async decrypt(...args) {
    const { webcrypto } = await import("node:crypto");
    const plaintext = await webcrypto.subtle.decrypt(...args);
    nativeFinished.resolve(); await release.promise;
    return plaintext;
  } });
  const f = controllerFixture({ decrypt: decryptWorkspaceBackup, crypto: traced.crypto });
  const p = protection(() => f.controller.invalidate());
  try {
    assert(f.controller.selectText(sealed.text));
    const operation = f.unlock();
    await nativeFinished.promise; p.stop(); release.resolve();
    assert.equal(await operation, false);
    await tick();
    assert.equal(f.controller.state().phase, "idle");
    assert.equal(f.controller.state().canStage, false);
    assert.equal(f.staged.length, 0);
    assert.equal(f.controller.state().summary, null);
    assert(!JSON.stringify(p.wire.posts).includes(PASSWORD));
    assert(!JSON.stringify(p.wire.posts).includes("ciphertext"));
  } finally { release.resolve(); p.close(); f.controller.dispose(); }
});

test("two active backup controllers are both invalidated by the same cleanup batch", async () => {
  const first = controllerFixture(), second = controllerFixture();
  const p = protection(() => { first.controller.invalidate(); second.controller.invalidate(); });
  try {
    await first.seal(); await second.select(); await second.unlock();
    p.stop();
    assert.equal(first.controller.state().canDownload, false);
    assert.equal(second.controller.state().canStage, false);
    assert.equal(second.staged.length, 0);
  } finally { p.close(); first.controller.dispose(); second.controller.dispose(); }
});

test("an aborted KDF retains runner capacity until native work actually settles", async () => {
  const pending = gate(), entered = gate();
  const runner = createSecureBackupRunner();
  let calls = 0;
  const f = controllerFixture({ runner, encrypt() { calls++; entered.resolve(); return pending.promise; } });
  const p = protection(() => f.controller.invalidate());
  try {
    const old = f.seal(); await entered.promise; p.stop();
    assert.equal(await old, false);
    assert.equal(await f.seal(), false);
    assert.equal(calls, 1);
    pending.resolve(fakePrepared()); await tick();
    assert.equal(await f.seal(), true);
    assert.equal(calls, 2);
  } finally { pending.resolve(fakePrepared()); p.close(); f.controller.dispose(); }
});

for (const action of ["save", "remove", "export"]) {
  test("peer stop clears library " + action + " review while preserving ciphertext on disk", async () => {
    const initial = await library([1, 2]);
    const storage = memoryStorage(initial);
    const opened = [];
    const controller = createEncryptedLibraryController({ storage, onOpen: text => { opened.push(text); return true; } });
    const p = protection(() => controller.cancel());
    try {
      await controller.load();
      const id = initial.entries[0].id;
      assert(controller.select(id));
      if (action === "save") await controller.prepareSave(envelope(3));
      if (action === "remove") await controller.prepareRemove();
      if (action === "export") await controller.prepareExport();
      const previous = controller.state();
      p.stop();
      assert.equal(controller.state().loaded, false);
      assert.equal(controller.state().review, null);
      assert.equal(controller.state().selected, null);
      assert.equal(controller.state().canExport, false);
      if (previous.review) assert.equal(await controller.confirm(previous.review.ticket, true), false);
      assert.equal(controller.offer(() => { throw Error("must not offer"); }), false);
      assert.deepEqual(storage.snapshot(), initial);
      assert.equal(storage.calls.writes, 0);
      assert.equal(opened.length, 0);
    } finally { p.close(); controller.dispose(); }
  });
}

test("peer stop during a library read suppresses its late summary", async () => {
  const initial = await library([1]), pending = gate(), entered = gate();
  const storage = memoryStorage(initial);
  const controller = createEncryptedLibraryController({ storage: { ...storage,
    read() { entered.resolve(); return pending.promise; } } });
  const p = protection(() => controller.cancel());
  try {
    const operation = controller.load(); await entered.promise;
    p.stop(); pending.resolve(initial);
    assert.equal(await operation, false); await tick();
    assert.equal(controller.state().phase, "cancelled");
    assert.equal(controller.state().summary, null);
    assert.equal(controller.state().loaded, false);
    assert.deepEqual(storage.snapshot(), initial);
    assert.equal(storage.calls.writes, 0);
  } finally { pending.resolve(initial); p.close(); controller.dispose(); }
});

test("peer stop before library commit is checked inside the storage transaction", async () => {
  const initial = await library([1]), pending = gate(), entered = gate();
  const storage = memoryStorage(initial);
  const controller = createEncryptedLibraryController({ storage: { ...storage,
    async change(expected, operation, options) {
      entered.resolve(); await pending.promise;
      return storage.change(expected, operation, options);
    } } });
  const p = protection(() => controller.cancel());
  try {
    await controller.load(); await controller.prepareSave(envelope(2));
    const ticket = controller.state().review.ticket;
    const operation = controller.confirm(ticket, true); await entered.promise;
    p.stop(); pending.resolve();
    assert.equal(await operation, false); await tick();
    assert.deepEqual(storage.snapshot(), initial);
    assert.equal(storage.calls.writes, 0);
    assert.equal(controller.state().review, null);
    assert.equal(controller.state().loaded, false);
  } finally { pending.resolve(); p.close(); controller.dispose(); }
});

test("a commit finished before notification is preserved and is not represented as undone", async () => {
  const storage = memoryStorage(await library([1]));
  const controller = createEncryptedLibraryController({ storage });
  const p = protection(() => controller.cancel());
  try {
    await controller.load(); await controller.prepareSave(envelope(2));
    assert(await controller.confirm(controller.state().review.ticket, true));
    const committed = storage.snapshot();
    p.stop();
    assert.deepEqual(storage.snapshot(), committed);
    assert.equal(storage.calls.writes, 1);
    assert.equal(controller.state().loaded, false);
    assert.equal(controller.state().result, null);
  } finally { p.close(); controller.dispose(); }
});
