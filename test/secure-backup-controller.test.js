import test from "node:test";
import assert from "node:assert/strict";
import { createSecureBackupController } from "../src/secure-backup-controller.js";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { SecureBackupError } from "../src/secure-backup-format.js";
import { controllerFixture, PASSWORD, OTHER_PASSWORD, fakePrepared, fakeDecoded,
  encryptedText, draft, clone, gate, tick, fileObject } from "./helpers/secure-backup-fixtures.js";

test("controller initial state contains no secrets or drafts and cannot stage or download", () => {
  const f = controllerFixture();
  assert.deepEqual(f.controller.state(), {
    phase: "idle", errorCode: null, encryptedBytes: 0,
    canDownload: false, canDecrypt: false, canStage: false,
    downloadOffered: false, diskSaved: false, summary: null,
  });
  assert.equal(f.calls.length, 0);
  assert.equal(f.staged.length, 0);
});

test("controller seals without downloading, then offers only on explicit action", async () => {
  const f = controllerFixture();
  const initial = f.draft;
  assert.equal(await f.seal(), true);
  assert.equal(f.controller.state().canDownload, true);
  assert.equal(f.controller.state().downloadOffered, false);
  assert.deepEqual(f.draft, initial);
  const downloads = [];
  assert.equal(f.controller.offer(file => downloads.push(file)), true);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].text, encryptedText());
  assert.equal(f.controller.state().downloadOffered, true);
  assert.equal(f.controller.state().diskSaved, false);
  assert.equal(f.staged.length, 0);
});

test("controller selects, decrypts, and stages only after three explicit steps", async () => {
  const f = controllerFixture();
  const initial = f.draft;
  assert.equal(await f.select(), true);
  assert.equal(f.controller.state().phase, "selected");
  assert.equal(f.calls.length, 0);
  assert.equal(await f.unlock(), true);
  assert.equal(f.controller.state().phase, "decrypted");
  assert.equal(f.staged.length, 0);
  assert.deepEqual(f.draft, initial);
  assert.equal(f.controller.stage(), true);
  assert.equal(f.staged.length, 1);
  assert.equal(f.staged[0], fakeDecoded().text);
  assert.equal(f.controller.state().phase, "staged");
  assert.equal(f.controller.state().summary, null);
  assert.equal(f.controller.stage(), false);
  assert.equal(f.staged.length, 1);
});

test("controller state and notifications omit passwords, accounts, balances and decrypted JSON", async () => {
  const f = controllerFixture();
  await f.seal();
  await f.select();
  await f.unlock();
  const text = JSON.stringify(f.notifications);
  for (const secret of [PASSWORD, "0x111111", "nativeBalanceBaseUnits", "ciphertext", "PBKDF2"]) {
    assert(!text.includes(secret), secret + " excluded");
  }
  assert.equal(f.controller.state().summary.cards, 3);
  assert(f.controller.state().summary.plaintextBytes > 0);
  assert(Object.isFrozen(f.controller.state()));
  assert(Object.isFrozen(f.controller.state().summary));
});

test("confirmation mismatch never enters crypto", async () => {
  const f = controllerFixture();
  assert.equal(await f.controller.seal(PASSWORD, OTHER_PASSWORD), false);
  assert.equal(f.controller.state().errorCode, "SECURE_MISMATCH");
  assert.equal(f.calls.length, 0);
});

test("invalid seal passphrase does not enter crypto", async () => {
  const f = controllerFixture();
  assert.equal(await f.controller.seal("short", "short"), false);
  assert.equal(f.controller.state().errorCode, "SECURE_PASSPHRASE");
  assert.equal(f.calls.length, 0);
});

test("invalid restore passphrase consumes selection without running crypto", async () => {
  const f = controllerFixture();
  await f.select();
  assert.equal(await f.controller.unlock("short"), false);
  assert.equal(f.controller.state().errorCode, "SECURE_PASSPHRASE");
  assert.equal(f.calls.length, 0);
  assert.equal(f.controller.state().canDecrypt, false);
});

test("unlock without file selection fails with no crypto or mutation", async () => {
  const f = controllerFixture();
  assert.equal(await f.unlock(), false);
  assert.equal(f.controller.state().errorCode, "SECURE_NOT_READY");
  assert.equal(f.calls.length, 0);
});

test("download is blocked if source changes after encryption", async () => {
  const f = controllerFixture();
  await f.seal();
  f.change();
  let downloads = 0;
  assert.equal(f.controller.offer(() => { downloads++; }), false);
  assert.equal(downloads, 0);
  assert.equal(f.controller.state().errorCode, "SECURE_STALE");
  assert.equal(f.controller.state().canDownload, false);
});

test("source change during encryption discards completed result", async () => {
  const pending = gate();
  const f = controllerFixture({ encrypt: () => pending.promise });
  const work = f.seal();
  await tick();
  f.change();
  pending.resolve(fakePrepared());
  assert.equal(await work, false);
  assert.equal(f.controller.state().errorCode, "SECURE_STALE");
  assert.equal(f.controller.state().canDownload, false);
});

test("target change during decryption discards unlocked content", async () => {
  const pending = gate();
  const f = controllerFixture({ decrypt: () => pending.promise });
  await f.select();
  const work = f.unlock();
  await tick();
  f.change();
  pending.resolve(fakeDecoded());
  assert.equal(await work, false);
  assert.equal(f.controller.state().errorCode, "SECURE_STALE");
  assert.equal(f.controller.state().canStage, false);
  assert.equal(f.staged.length, 0);
});

test("target change after decryption blocks staging", async () => {
  const f = controllerFixture();
  await f.select();
  await f.unlock();
  f.change();
  assert.equal(f.controller.stage(), false);
  assert.equal(f.controller.state().errorCode, "SECURE_STALE");
  assert.equal(f.staged.length, 0);
});

test("invalid target fields after decrypt block staging", async () => {
  let current = draft();
  const f = controllerFixture({ readDraft: () => current });
  await f.select();
  await f.unlock();
  current = [];
  assert.equal(f.controller.stage(), false);
  assert.equal(f.controller.state().errorCode, "SECURE_CONTENT");
  assert.equal(f.staged.length, 0);
});

for (const action of ["cancel", "invalidate", "dispose"]) {
  test(action + " clears prepared encrypted file and metadata", async () => {
    const f = controllerFixture();
    await f.seal();
    f.controller[action]();
    assert.equal(f.controller.state().canDownload, false);
    assert.equal(f.controller.state().encryptedBytes, 0);
    assert.equal(f.controller.state().downloadOffered, false);
  });
  test(action + " clears unlocked restore and prevents staging", async () => {
    const f = controllerFixture();
    await f.select();
    await f.unlock();
    f.controller[action]();
    assert.equal(f.controller.state().canStage, false);
    assert.equal(f.controller.state().summary, null);
    assert.equal(f.controller.stage(), false);
    assert.equal(f.staged.length, 0);
  });
  test(action + " discards a late encryption result", async () => {
    const pending = gate();
    const f = controllerFixture({ encrypt: () => pending.promise });
    const work = f.seal();
    await tick();
    f.controller[action]();
    const expected = f.controller.state();
    pending.resolve(fakePrepared());
    assert.equal(await work, false);
    await tick();
    assert.deepEqual(f.controller.state(), expected);
  });
  test(action + " discards a late decryption result", async () => {
    const pending = gate();
    const f = controllerFixture({ decrypt: () => pending.promise });
    await f.select();
    const work = f.unlock();
    await tick();
    f.controller[action]();
    const expected = f.controller.state();
    pending.resolve(fakeDecoded());
    assert.equal(await work, false);
    await tick();
    assert.deepEqual(f.controller.state(), expected);
  });
  test(action + " discards a late file read", async () => {
    const pending = gate();
    const f = controllerFixture({ readText: () => pending.promise });
    const work = f.select();
    f.controller[action]();
    const expected = f.controller.state();
    pending.resolve(encryptedText());
    assert.equal(await work, false);
    assert.deepEqual(f.controller.state(), expected);
  });
}

test("a second file selection owns state even if first read finishes last", async () => {
  const first = gate();
  let reads = 0;
  const f = controllerFixture({ readText: () => ++reads === 1 ? first.promise : encryptedText() });
  const pending = f.select();
  assert.equal(await f.select(), true);
  const selected = f.controller.state();
  first.resolve("bad old file");
  assert.equal(await pending, false);
  assert.deepEqual(f.controller.state(), selected);
});

test("failed second selection never retains the first selection", async () => {
  const f = controllerFixture();
  await f.select();
  assert.equal(await f.controller.select(fileObject("{}")), false);
  assert.equal(f.controller.state().canDecrypt, false);
  assert.equal(await f.unlock(), false);
  assert.equal(f.calls.length, 0);
});

test("invalid reader result fails before decrypt", async () => {
  const f = controllerFixture({ readText: async () => ({ password: PASSWORD }) });
  assert.equal(await f.select(), false);
  assert.equal(f.controller.state().canDecrypt, false);
  assert.equal(f.calls.length, 0);
});

test("file reader receives exact size limit and cancellable signal", async () => {
  let options;
  const pending = gate();
  const f = controllerFixture({ readText: (file, value) => { options = value; return pending.promise; } });
  const work = f.select();
  assert.equal(options.maxBytes, 12 * 1024 * 1024);
  assert.equal(options.signal.aborted, false);
  f.controller.cancel();
  assert.equal(options.signal.aborted, true);
  pending.resolve(encryptedText());
  assert.equal(await work, false);
});

test("malformed backend decrypted result cannot reach preview callback", async () => {
  const f = controllerFixture({ decrypt: async () => ({ text: '{"secret":"bad"}' }) });
  await f.select();
  assert.equal(await f.unlock(), false);
  assert.equal(f.controller.state().errorCode, "SECURE_CONTENT");
  assert.equal(f.controller.stage(), false);
  assert.equal(f.staged.length, 0);
});

test("malformed encryption result cannot be downloaded", async () => {
  const f = controllerFixture({ encrypt: async () => ({ text: "plaintext" }) });
  assert.equal(await f.seal(), false);
  assert.equal(f.controller.state().canDownload, false);
});

for (const [name, action, code] of [
  ["encryption", async f => f.seal(), "SECURE_CONTENT"],
  ["decryption", async f => { await f.select(); return f.unlock(); }, "SECURE_CONTENT"],
  ["file read", async f => f.select(), "SECURE_READ"],
]) {
  test("external " + name + " error never leaks its message", async () => {
    const fail = async () => { throw Error(PASSWORD); };
    const overrides = name === "encryption" ? { encrypt: fail } : name === "decryption" ? { decrypt: fail } : { readText: fail };
    const f = controllerFixture(overrides);
    assert.equal(await action(f), false);
    assert.equal(f.controller.state().errorCode, code);
    assert(!JSON.stringify(f.notifications).includes(PASSWORD));
  });
}

test("authentication failure consumes selected ciphertext and exposes only static code", async () => {
  const f = controllerFixture({ decrypt: async () => { throw new SecureBackupError("SECURE_AUTH"); } });
  await f.select();
  await f.unlock();
  assert.equal(f.controller.state().errorCode, "SECURE_AUTH");
  assert.equal(f.controller.state().canDecrypt, false);
  assert.equal(f.controller.state().encryptedBytes, 0);
});

test("download failure does not claim saved and drops prepared file", async () => {
  const f = controllerFixture();
  await f.seal();
  assert.equal(f.controller.offer(() => { throw Error(PASSWORD); }), false);
  assert.equal(f.controller.state().errorCode, "SECURE_DOWNLOAD");
  assert.equal(f.controller.state().diskSaved, false);
  assert.equal(f.controller.state().downloadOffered, false);
  assert(!JSON.stringify(f.notifications).includes(PASSWORD));
});

test("asynchronous download adapter is rejected without an unhandled rejection", async () => {
  const f = controllerFixture();
  await f.seal();
  assert.equal(f.controller.offer(async () => { throw Error("failed"); }), false);
  await tick();
  assert.equal(f.controller.state().errorCode, "SECURE_DOWNLOAD");
});

for (const callback of [() => false, () => undefined, () => { throw Error(PASSWORD); }]) {
  test("failed preview handoff consumes decrypted candidate and never reports applied", async () => {
    const f = controllerFixture({ onStage: callback });
    await f.select();
    await f.unlock();
    assert.equal(f.controller.stage(), false);
    assert.equal(f.controller.state().errorCode, "SECURE_STAGE");
    assert.equal(f.controller.state().canStage, false);
  });
}

test("shared runner prevents cancelled work from creating parallel PBKDF2 operations", async () => {
  const runner = createSecureBackupRunner();
  const pending = gate();
  const first = controllerFixture({ runner, encrypt: () => pending.promise });
  const second = controllerFixture({ runner });
  const work = first.seal();
  await tick();
  first.controller.cancel();
  assert.equal(await work, false);
  assert.equal(await second.seal(), false);
  assert.equal(second.controller.state().errorCode, "SECURE_BUSY");
  pending.resolve(fakePrepared());
  await tick();
  assert.equal(await second.seal(), true);
});

test("observer exception does not discard valid encrypted result", async () => {
  const f = controllerFixture({ onChange() { throw Error("view"); } });
  assert.equal(await f.seal(), true);
  assert.equal(f.controller.state().canDownload, true);
});

test("timeout clears candidate and leaves native slot occupied until backend finishes", async () => {
  const runner = createSecureBackupRunner({ timeoutMs: 10 });
  const pending = gate();
  const f = controllerFixture({ runner, encrypt: () => pending.promise });
  assert.equal(await f.seal(), false);
  assert.equal(f.controller.state().errorCode, "SECURE_TIMEOUT");
  assert.equal(runner.busy(), true);
  pending.resolve(fakePrepared());
  await tick();
  assert.equal(runner.busy(), false);
  assert.equal(f.controller.state().errorCode, "SECURE_TIMEOUT");
});

test("dispose is idempotent and all continuation methods remain inactive", async () => {
  const f = controllerFixture();
  f.controller.dispose();
  f.controller.dispose();
  f.controller.cancel();
  f.controller.invalidate();
  assert.equal(f.controller.state().phase, "disposed");
  assert.equal(await f.unlock(), false);
  assert.equal(f.controller.offer(() => assert.fail()), false);
  assert.equal(f.controller.stage(), false);
  await assert.rejects(f.seal(), error => error.code === "SECURE_DISPOSED");
  await assert.rejects(f.select(), error => error.code === "SECURE_DISPOSED");
});
