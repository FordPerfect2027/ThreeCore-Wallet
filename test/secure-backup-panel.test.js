import test from "node:test";
import assert from "node:assert/strict";
import { mountSecureBackupPanel, SECURE_BACKUP_MESSAGES } from "../examples/secure-backup-panel.js";
import { mountWorkspacePanel } from "../examples/workspace-panel.js";
import { SECURE_BACKUP_CODES, SecureBackupError } from "../src/secure-backup-format.js";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { Element } from "./helpers/panel-dom.js";
import { until } from "./helpers/workspace-fixtures.js";
import { draft, clone, PASSWORD, fakePrepared, fakeDecoded, encryptedText,
  fileObject, gate, tick } from "./helpers/secure-backup-fixtures.js";

function fixture(options = {}) {
  const document = new EventTarget();
  document.createElement = tag => new Element(tag);
  document.hidden = false;
  const eventTarget = new EventTarget();
  const parent = new Element("main");
  let current = draft();
  const downloaded = [];
  const staged = [];
  let protections = 0;
  const panel = mountSecureBackupPanel({
    document, parent, eventTarget,
    readDraft: () => clone(current),
    onStage(text) { staged.push(text); return true; },
    onProtect() { protections++; },
    download: ({ prepared }) => downloaded.push(prepared),
    ...options,
    controllerOptions: {
      runner: createSecureBackupRunner(),
      encrypt: async () => fakePrepared(),
      decrypt: async () => fakeDecoded(),
      ...options.controllerOptions,
    },
  });
  const field = name => parent.find("secure-backup-" + name);
  function input(name, value) {
    field(name).value = value;
    field(name).dispatchEvent(new Event("input"));
  }
  function acknowledge(checked = true) {
    field("acknowledged").checked = checked;
    field("acknowledged").dispatchEvent(new Event("change"));
  }
  function enter() {
    input("password", PASSWORD);
    input("confirmation", PASSWORD);
    acknowledge();
  }
  async function seal() {
    enter();
    field("encrypt").click();
    await until(() => panel.state().phase !== "encrypting");
  }
  async function select() {
    field("file").files = [fileObject(encryptedText())];
    field("file").dispatchEvent(new Event("change"));
    await until(() => panel.state().phase !== "reading");
  }
  async function unlock() {
    await select();
    input("restore-password", PASSWORD);
    field("decrypt").click();
    await until(() => panel.state().phase !== "decrypting");
  }
  return { panel, parent, document, eventTarget, field, input, acknowledge, enter, seal, select, unlock,
    downloaded, staged, get protections() { return protections; },
    change() { current[0].tokens = ""; } };
}

test("password UI defaults to hidden inputs with no values or automatic actions", t => {
  const f = fixture(); t.after(() => f.panel.dispose());
  for (const name of ["password", "confirmation", "restore-password"]) {
    assert.equal(f.field(name).type, "password");
    assert.equal(f.field(name).value, "");
    assert.equal(f.field(name).spellcheck, false);
    assert.equal(f.field(name).maxLength, 1024);
  }
  assert.equal(f.field("encrypt").disabled, true);
  assert.equal(f.field("download").disabled, true);
  assert.equal(f.field("decrypt").disabled, true);
  assert.equal(f.field("stage").disabled, true);
  assert.equal(f.downloaded.length, 0);
  assert.equal(f.staged.length, 0);
});

test("required acknowledgement gates encryption and is consumed by use", async t => {
  const f = fixture(); t.after(() => f.panel.dispose());
  f.input("password", PASSWORD);
  f.input("confirmation", PASSWORD);
  f.field("encrypt").click();
  assert.equal(f.panel.state().phase, "idle");
  f.acknowledge();
  assert.equal(f.field("encrypt").disabled, false);
  f.field("encrypt").click();
  assert.equal(f.field("acknowledged").checked, false);
  await until(() => f.panel.state().phase === "encrypted");
});

test("passwords are cleared synchronously before encryption completes", async t => {
  const pending = gate();
  const f = fixture({ controllerOptions: { encrypt: () => pending.promise } });
  t.after(() => f.panel.dispose());
  f.enter();
  f.field("encrypt").click();
  assert.equal(f.field("password").value, "");
  assert.equal(f.field("confirmation").value, "");
  assert.equal(f.field("file").disabled, true);
  assert.equal(f.field("password").disabled, true);
  assert.equal(f.field("panel").getAttribute("aria-busy"), "true");
  pending.resolve(fakePrepared());
  await until(() => f.panel.state().phase === "encrypted");
  assert.equal(f.field("download").disabled, false);
  assert.equal(f.downloaded.length, 0);
});

test("only explicit download action offers encrypted file and does not claim disk save", async t => {
  const f = fixture(); t.after(() => f.panel.dispose());
  await f.seal();
  assert.equal(f.downloaded.length, 0);
  f.field("download").click();
  assert.equal(f.downloaded.length, 1);
  assert.equal(f.downloaded[0].text, encryptedText());
  assert.match(f.field("status").textContent, /保存完了.*確認/);
  assert.equal(f.panel.state().diskSaved, false);
});

test("file selection resets credentials, acknowledgement and input file value", async t => {
  const f = fixture(); t.after(() => f.panel.dispose());
  f.enter();
  await f.select();
  assert.equal(f.field("password").value, "");
  assert.equal(f.field("confirmation").value, "");
  assert.equal(f.field("acknowledged").checked, false);
  assert.equal(f.field("file").value, "");
  assert.equal(f.field("decrypt").disabled, false);
  assert.equal(f.field("restore-password").disabled, false);
  assert.equal(f.field("stage").disabled, true);
});

test("decryption clears entered password before promise resolves", async t => {
  const pending = gate();
  const f = fixture({ controllerOptions: { decrypt: () => pending.promise } });
  t.after(() => f.panel.dispose());
  await f.select();
  f.input("restore-password", PASSWORD);
  f.field("decrypt").click();
  assert.equal(f.field("restore-password").value, "");
  assert.equal(f.field("restore-password").disabled, true);
  pending.resolve(fakeDecoded());
  await until(() => f.panel.state().phase === "decrypted");
  assert.equal(f.field("stage").disabled, false);
  assert.equal(f.staged.length, 0);
});

test("unlocked content is not rendered until the explicit preview handoff", async t => {
  const f = fixture(); t.after(() => f.panel.dispose());
  await f.unlock();
  assert.equal(f.staged.length, 0);
  assert(!f.field("detail").textContent.includes("0x111111"));
  assert.match(f.field("status").textContent, /まだ復元していません/);
  f.field("stage").click();
  assert.equal(f.staged.length, 1);
  assert.equal(f.field("stage").disabled, true);
  f.field("stage").click();
  assert.equal(f.staged.length, 1);
});

for (const operation of ["cancel", "protect", "invalidate", "hidden", "pagehide"]) {
  test(operation + " clears credentials and decrypted review", async t => {
    const f = fixture(); t.after(() => f.panel.dispose());
    await f.unlock();
    f.enter();
    if (operation === "cancel") f.field("cancel").click();
    else if (operation === "hidden") {
      f.document.hidden = true;
      f.document.dispatchEvent(new Event("visibilitychange"));
    } else if (operation === "pagehide") f.eventTarget.dispatchEvent(new Event("pagehide"));
    else f.panel[operation]();
    assert.equal(f.field("password").value, "");
    assert.equal(f.field("confirmation").value, "");
    assert.equal(f.field("restore-password").value, "");
    assert.equal(f.field("acknowledged").checked, false);
    assert.equal(f.field("stage").disabled, true);
    assert.equal(f.field("detail").textContent, "");
    assert(f.protections > 0);
  });
}

test("becoming visible does not clear a freshly typed password", t => {
  const f = fixture(); t.after(() => f.panel.dispose());
  f.enter();
  f.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(f.field("password").value, PASSWORD);
});

test("automatic expiry clears typed credentials", async t => {
  const f = fixture({ plaintextLifetimeMs: 20 }); t.after(() => f.panel.dispose());
  f.enter();
  await until(() => f.field("password").value === "");
  assert.equal(f.field("confirmation").value, "");
  assert.match(f.field("status").textContent, /一定時間/);
});

test("automatic expiry clears decrypted candidate before staging", async t => {
  const f = fixture({ plaintextLifetimeMs: 40 }); t.after(() => f.panel.dispose());
  await f.unlock();
  await until(() => !f.panel.state().canStage);
  assert.equal(f.staged.length, 0);
  assert.equal(f.panel.state().summary, null);
});

test("automatic expiry invokes parent cleanup after preview handoff", async t => {
  const f = fixture({ plaintextLifetimeMs: 40 }); t.after(() => f.panel.dispose());
  await f.unlock();
  f.field("stage").click();
  const before = f.protections;
  await until(() => f.protections > before);
  assert.match(f.field("status").textContent, /一定時間/);
});

test("source mutation prevents download and presents a safe message", async t => {
  const f = fixture(); t.after(() => f.panel.dispose());
  await f.seal();
  f.change();
  f.field("download").click();
  assert.equal(f.downloaded.length, 0);
  assert.match(f.field("status").textContent, /変わりました/);
});

test("target mutation prevents preview handoff", async t => {
  const f = fixture(); t.after(() => f.panel.dispose());
  await f.unlock();
  f.change();
  f.field("stage").click();
  assert.equal(f.staged.length, 0);
  assert.match(f.field("status").textContent, /変わりました/);
});

for (const length of [0, 2]) {
  test("file picker rejects " + length + " files and clears old candidate", async t => {
    const f = fixture(); t.after(() => f.panel.dispose());
    await f.unlock();
    f.field("file").files = Array.from({ length }, () => fileObject(encryptedText()));
    f.field("file").dispatchEvent(new Event("change"));
    assert.equal(f.panel.state().canStage, false);
    assert.match(f.field("status").textContent, /1ファイル/);
  });
}

for (const code of ["SECURE_AUTH", "SECURE_TIMEOUT", "SECURE_BUSY", "SECURE_CONTENT"]) {
  test("panel exposes static safe message for " + code, async t => {
    const f = fixture({ controllerOptions: { decrypt: async () => { throw new SecureBackupError(code); } } });
    t.after(() => f.panel.dispose());
    await f.unlock();
    assert.equal(f.field("status").textContent, SECURE_BACKUP_MESSAGES[code]);
    assert.equal(f.field("restore-password").value, "");
    assert.equal(f.field("stage").disabled, true);
  });
}

test("each stable error code has a Japanese user message", () => {
  for (const code of SECURE_BACKUP_CODES) {
    assert.equal(typeof SECURE_BACKUP_MESSAGES[code], "string", code);
    assert(SECURE_BACKUP_MESSAGES[code].length > 8);
  }
});

test("disposing a panel removes listeners, timers, inputs and pending candidate", async () => {
  const f = fixture({ plaintextLifetimeMs: 20 });
  await f.unlock();
  const button = f.field("stage");
  const password = f.field("password");
  f.enter();
  f.panel.dispose();
  f.panel.dispose();
  assert.equal(password.value, "");
  assert.equal(f.parent.children.length, 0);
  button.click();
  f.document.hidden = true;
  f.document.dispatchEvent(new Event("visibilitychange"));
  f.eventTarget.dispatchEvent(new Event("pagehide"));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(f.staged.length, 0);
  assert.equal(f.panel.state().phase, "disposed");
});

test("panel tolerates lightweight documents without visibility APIs", t => {
  const parent = new Element("main");
  const panel = mountSecureBackupPanel({ document: { createElement: tag => new Element(tag) },
    parent, readDraft: draft, onStage: () => true });
  t.after(() => panel.dispose());
  assert.equal(panel.state().phase, "idle");
});

test("workspace mounts encrypted backup controls without altering its existing plain workflow", t => {
  const document = { createElement: tag => new Element(tag) };
  const parent = new Element("main");
  let writes = 0;
  const panel = mountWorkspacePanel({ document, parent, readDraft: draft, writeDraft() { writes++; } });
  t.after(() => panel.dispose());
  assert(parent.find("secure-backup-password"));
  assert(parent.find("workspace-json"));
  assert(parent.find("workspace-save"));
  assert.equal(writes, 0);
  parent.find("secure-backup-password").value = PASSWORD;
  panel.protect();
  assert.equal(parent.find("secure-backup-password").value, "");
  assert.equal(writes, 0);
});
