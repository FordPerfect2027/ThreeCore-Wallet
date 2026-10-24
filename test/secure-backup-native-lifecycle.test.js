import test from "node:test";
import assert from "node:assert/strict";
import { encryptWorkspaceBackup, decryptWorkspaceBackup } from "../src/secure-backup-crypto.js";
import { createSecureBackupController } from "../src/secure-backup-controller.js";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { manualTime, microtasks } from "./helpers/secure-lifecycle-time.js";
import { bundle, draft, PASSWORD, OTHER_PASSWORD, webcrypto, gate, tick } from "./helpers/secure-backup-fixtures.js";
import { until } from "./helpers/workspace-fixtures.js";

function intercepted(method) {
  const entered = gate();
  const release = gate();
  const calls = [];
  let intercepted = false;
  const subtle = {};
  for (const name of ["digest", "importKey", "deriveKey", "encrypt", "decrypt"]) {
    subtle[name] = async (...args) => {
      calls.push({ name, args });
      if (name === method && !intercepted) {
        intercepted = true;
        entered.resolve();
        await release.promise;
      }
      return webcrypto.subtle[name](...args);
    };
  }
  return { calls, entered: entered.promise, release: release.resolve,
    crypto: { subtle, getRandomValues: array => webcrypto.getRandomValues(array) } };
}
let encrypted;
async function sample() {
  encrypted ??= encryptWorkspaceBackup(bundle(), PASSWORD, { crypto: webcrypto });
  return encrypted;
}

for (const method of ["digest", "importKey", "deriveKey", "encrypt"]) {
  test("cancel encryption during native " + method + " never returns a file", async () => {
    const trace = intercepted(method);
    const runner = createSecureBackupRunner();
    const work = runner.run(guard => encryptWorkspaceBackup(bundle(), PASSWORD, { crypto: trace.crypto, guard }));
    await trace.entered;
    runner.cancel();
    await assert.rejects(work, { code: "SECURE_CANCELLED" });
    assert.equal(runner.busy(), true);
    await assert.rejects(runner.run(() => assert.fail()), { code: "SECURE_BUSY" });
    trace.release();
    await until(() => !runner.busy());
    assert.equal(runner.state().completed, 0);
    assert.equal(runner.state().late, 1);
    for (const call of trace.calls) {
      if (call.name === "importKey") assert(call.args[1].every(byte => byte === 0), "password byte copy cleared");
      if (call.name === "encrypt") assert(call.args[2].every(byte => byte === 0), "plaintext byte copy cleared");
    }
    runner.dispose();
  });
}

for (const method of ["importKey", "deriveKey", "decrypt", "digest"]) {
  test("cancel restoration during native " + method + " never returns plaintext", async () => {
    const input = await sample();
    const trace = intercepted(method);
    const runner = createSecureBackupRunner();
    const work = runner.run(guard => decryptWorkspaceBackup(input.text, PASSWORD, { crypto: trace.crypto, guard }));
    await trace.entered;
    runner.cancel();
    await assert.rejects(work, { code: "SECURE_CANCELLED" });
    assert.equal(runner.busy(), true);
    trace.release();
    await until(() => !runner.busy());
    assert.equal(runner.state().completed, 0);
    assert.equal(runner.state().late, 1);
    const material = trace.calls.find(call => call.name === "importKey");
    assert(material.args[1].every(byte => byte === 0));
    runner.dispose();
  });
}

test("native key derivation timeout prevents later encryption stage", async () => {
  const trace = intercepted("deriveKey");
  const time = manualTime();
  const runner = createSecureBackupRunner({ ...time.options, timeoutMs: 100 });
  const work = runner.run(guard => encryptWorkspaceBackup(bundle(), PASSWORD, { crypto: trace.crypto, guard }));
  await trace.entered;
  time.advance(100);
  // No timer delivery: the continuation's guard must reject the next stage.
  trace.release();
  await assert.rejects(work, { code: "SECURE_TIMEOUT" });
  await until(() => !runner.busy());
  assert.equal(trace.calls.some(call => call.name === "encrypt"), false);
  assert.equal(runner.state().completed, 0);
});

test("successful native roundtrip retains exact DAT EMA CAWELON workspace", async () => {
  const time = manualTime();
  const runner = createSecureBackupRunner();
  const staged = [];
  const controller = createSecureBackupController({ readDraft: () => draft(),
    onStage(text) { staged.push(text); return true; }, crypto: webcrypto, runner,
    resultLifetimeMs: 100, lifetimeOptions: time.options });
  assert.equal(await controller.seal(PASSWORD, PASSWORD), true);
  const text = controller.encryptedText();
  assert.equal(text.includes(PASSWORD), false);
  assert.equal(controller.selectText(text), true);
  assert.equal(await controller.unlock(PASSWORD), true);
  assert.equal(controller.state().canStage, true);
  assert.equal(staged.length, 0);
  assert.equal(controller.stage(), true);
  assert.equal(staged.length, 1);
  assert.deepEqual(JSON.parse(staged[0]).entries.map(row => row.agent), ["DAT", "EMA", "CAWELON"]);
  assert.equal(runner.state().completed, 2);
  controller.dispose();
  runner.dispose();
});

test("real authenticated plaintext expires before controller handoff", async () => {
  const time = manualTime();
  let handedOff = false;
  const controller = createSecureBackupController({ readDraft: () => draft(),
    onStage() { handedOff = true; return true; }, crypto: webcrypto,
    runner: createSecureBackupRunner(), resultLifetimeMs: 100, lifetimeOptions: time.options });
  controller.selectText((await sample()).text);
  assert.equal(await controller.unlock(PASSWORD), true);
  time.advance(100);
  assert.equal(controller.stage(), false);
  assert.equal(handedOff, false);
  assert.equal(controller.state().summary, null);
  assert.equal(controller.state().errorCode, "SECURE_EXPIRED");
  controller.dispose();
});

test("wrong passphrase exposes only authentication failure through hardened runner", async () => {
  const runner = createSecureBackupRunner();
  const input = await sample();
  await assert.rejects(runner.run(guard => decryptWorkspaceBackup(input.text, OTHER_PASSWORD,
    { crypto: webcrypto, guard })), { code: "SECURE_AUTH" });
  assert.equal(runner.busy(), false);
  const status = JSON.stringify(runner.state());
  assert(!status.includes(OTHER_PASSWORD));
  assert(!status.includes(input.text));
});
