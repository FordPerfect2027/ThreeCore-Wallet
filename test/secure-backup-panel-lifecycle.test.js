import test from "node:test";
import assert from "node:assert/strict";
import { lifecyclePanel } from "./helpers/secure-lifecycle-panel.js";
import { PASSWORD, fakeDecoded, gate, tick } from "./helpers/secure-backup-fixtures.js";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { manualTime } from "./helpers/secure-lifecycle-time.js";

test("expired typed passwords cannot be used even when their timer has not fired", async () => {
  const f = lifecyclePanel();
  try {
    f.input("password", PASSWORD);
    f.input("confirmation", PASSWORD);
    f.check(f.q("acknowledged"));
    f.time.advance(100);
    f.q("encrypt").click();
    await tick();
    assert.equal(f.runner.state().started, 0);
    assert.equal(f.q("password").value, "");
    assert.equal(f.q("confirmation").value, "");
    assert.equal(f.q("acknowledged").checked, false);
    assert.equal(f.downloads.length, 0);
  } finally { f.dispose(); }
});

test("expired restoration password cannot start decryption", async () => {
  const f = lifecyclePanel();
  try {
    await f.select();
    f.input("restore-password", PASSWORD);
    f.time.advance(100);
    f.q("decrypt").click();
    await tick();
    assert.equal(f.runner.state().started, 0);
    assert.equal(f.q("restore-password").value, "");
    assert.equal(f.staged.length, 0);
  } finally { f.dispose(); }
});

test("expiry of decrypted data clears summary and disables staging", async () => {
  const f = lifecyclePanel();
  try {
    await f.unlock();
    assert.equal(f.q("stage").disabled, false);
    f.time.advance(100);
    f.q("stage").click();
    assert.equal(f.staged.length, 0);
    assert.equal(f.q("stage").disabled, true);
    assert.equal(f.q("detail").textContent, "");
    assert.match(f.q("status").textContent, /一定時間/);
  } finally { f.dispose(); }
});

test("editing a new password does not extend decrypted-data lifetime", async () => {
  const f = lifecyclePanel();
  try {
    await f.unlock();
    f.time.advance(70);
    f.input("password", PASSWORD);
    f.time.advance(30);
    f.q("stage").click();
    assert.equal(f.staged.length, 0);
    assert.equal(f.panel.state().canStage, false);
  } finally { f.dispose(); }
});

test("staged plaintext expires independently of further password editing", async () => {
  const f = lifecyclePanel();
  try {
    await f.unlock();
    f.q("stage").click();
    assert.equal(f.staged.length, 1);
    const before = f.protections;
    f.time.advance(70);
    f.input("password", PASSWORD);
    f.time.advance(30);
    assert.equal(f.panel.stagedReady(), false);
    assert(f.protections > before);
    assert.equal(f.q("password").value, "");
  } finally { f.dispose(); }
});

test("workspace preview refuses expired decrypted JSON without timer delivery", async () => {
  const f = lifecyclePanel({ workspace: true });
  try {
    await f.unlock();
    f.q("stage").click();
    assert(f.w("json").value.length > 0);
    f.time.advance(100);
    f.w("preview").click();
    assert.equal(f.w("json").value, "");
    assert.equal(f.w("detail").textContent, "");
    assert.equal(f.w("apply").disabled, true);
    assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});

test("workspace apply checks expiry after the user has reviewed a preview", async () => {
  const f = lifecyclePanel({ workspace: true });
  try {
    await f.unlock();
    f.q("stage").click();
    f.w("preview").click();
    f.check(f.w("confirmed"));
    assert.equal(f.w("apply").disabled, false);
    f.time.advance(100);
    f.w("apply").click();
    assert.equal(f.writes.length, 0);
    assert.equal(f.w("json").value, "");
    assert.equal(f.w("confirmed").checked, false);
    assert.equal(f.w("apply").disabled, true);
  } finally { f.dispose(); }
});

test("changing restore options never renews the decrypted candidate", async () => {
  const f = lifecyclePanel({ workspace: true });
  try {
    await f.unlock();
    f.q("stage").click();
    f.time.advance(90);
    f.check(f.w("settings"), false);
    f.time.advance(10);
    f.w("preview").click();
    assert.equal(f.w("json").value, "");
    assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});

test("editing staged JSON retains its original security expiry", async () => {
  const f = lifecyclePanel({ workspace: true });
  try {
    await f.unlock();
    f.q("stage").click();
    f.time.advance(90);
    f.w("json").value += " ";
    f.w("json").dispatchEvent(new Event("input"));
    f.time.advance(10);
    f.w("preview").click();
    assert.equal(f.w("json").value, "");
    assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});

test("explicit workspace cancel clears plaintext from an encrypted handoff", async () => {
  const f = lifecyclePanel({ workspace: true });
  try {
    await f.unlock();
    f.q("stage").click();
    f.w("preview").click();
    f.w("cancel").click();
    assert.equal(f.w("json").value, "");
    assert.equal(f.w("detail").textContent, "");
    assert.equal(f.writes.length, 0);
  } finally { f.dispose(); }
});

test("new plaintext handoff is not deleted by an older encrypted timer", async () => {
  const f = lifecyclePanel({ workspace: true });
  try {
    await f.unlock();
    f.q("stage").click();
    const text = fakeDecoded().text;
    f.panel.stageText(text);
    f.time.advance(100);
    f.time.flush();
    assert.equal(f.w("json").value, text);
    f.w("preview").click();
    assert(f.w("detail").textContent.length > 0);
  } finally { f.dispose(); }
});

for (const event of ["pagehide", "pageshow", "visibilitychange"]) {
  test(event + " clears credentials and staged workspace data", async () => {
    const f = lifecyclePanel({ workspace: true });
    try {
      await f.unlock();
      f.q("stage").click();
      f.input("password", PASSWORD);
      if (event === "visibilitychange") {
        f.document.hidden = true;
        f.document.dispatchEvent(new Event(event));
      } else f.eventTarget.dispatchEvent(new Event(event));
      assert.equal(f.q("password").value, "");
      assert.equal(f.w("json").value, "");
      assert.equal(f.w("apply").disabled, true);
      assert.equal(f.writes.length, 0);
    } finally { f.dispose(); }
  });
}

test("visible document event does not discard a valid candidate", async () => {
  const f = lifecyclePanel();
  try {
    await f.unlock();
    f.document.hidden = false;
    f.document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(f.panel.state().canStage, true);
  } finally { f.dispose(); }
});

test("clock rollback prevents plaintext handoff in the UI", async () => {
  const f = lifecyclePanel();
  try {
    await f.unlock();
    f.time.advance(-1);
    f.q("stage").click();
    assert.equal(f.staged.length, 0);
    assert.equal(f.panel.state().canStage, false);
    assert.match(f.q("status").textContent, /経過時間/);
  } finally { f.dispose(); }
});

test("protected panel cannot reuse retained old DOM controls after dispose", async () => {
  const f = lifecyclePanel();
  await f.unlock();
  const stage = f.q("stage");
  const oldTimers = f.time.allIds();
  f.dispose();
  oldTimers.forEach(id => f.time.fire(id, { stale: true }));
  stage.click();
  assert.equal(f.staged.length, 0);
  assert.equal(f.parent.children.length, 0);
  assert.equal(f.time.pending, 0);
});

test("cancelled native work is explained while its slot remains occupied", async () => {
  const pending = gate();
  const runner = createSecureBackupRunner();
  const f = lifecyclePanel({ controllerOptions: { runner, encrypt: () => pending.promise } });
  try {
    f.input("password", PASSWORD);
    f.input("confirmation", PASSWORD);
    f.check(f.q("acknowledged"));
    f.q("encrypt").click();
    await tick();
    assert.match(f.parent.find("secure-operation-status").textContent, /実行しています/);
    f.q("cancel").click();
    await tick();
    assert.match(f.parent.find("secure-operation-status").textContent, /終了するのを待っています/);
    assert.equal(runner.busy(), true);
    pending.resolve({});
    await tick();
    assert.match(f.parent.find("secure-operation-status").textContent, /待機はありません/);
    assert.equal(f.downloads.length, 0);
  } finally { pending.resolve({}); f.dispose(); runner.dispose(); }
});

test("throwing parent protection callback does not retain credentials", async () => {
  const f = lifecyclePanel({ onProtect() { throw Error("parent view failed"); } });
  try {
    f.input("password", PASSWORD);
    f.q("cancel").click();
    assert.equal(f.q("password").value, "");
    assert.equal(f.panel.state().phase, "cancelled");
  } finally { f.dispose(); }
});

test("async parent protection rejection is observed", async () => {
  const f = lifecyclePanel({ onProtect: async () => { throw Error("async parent failed"); } });
  try {
    f.input("password", PASSWORD);
    f.q("cancel").click();
    await tick();
    assert.equal(f.q("password").value, "");
  } finally { f.dispose(); }
});
