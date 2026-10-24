import test from "node:test";
import assert from "node:assert/strict";
import { mountEncryptedLibraryPanel, LIBRARY_MESSAGES } from "../examples/encrypted-library-panel.js";
import { mountSecureBackupPanel } from "../examples/secure-backup-panel.js";
import { ENCRYPTED_LIBRARY_CODES, EncryptedLibraryError } from "../src/encrypted-library-model.js";
import { Element } from "./helpers/panel-dom.js";
import { until } from "./helpers/workspace-fixtures.js";
import { envelope, library, memoryStorage, gate, tick } from "./helpers/encrypted-library-fixtures.js";
import { draft, PASSWORD, fakePrepared, fakeDecoded, clone } from "./helpers/secure-backup-fixtures.js";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";

function documentFixture() {
  const document = new EventTarget();
  document.createElement = tag => new Element(tag);
  document.hidden = false;
  return document;
}
function fixture(t, { initial, ...options } = {}) {
  const document = documentFixture(), parent = new Element("main");
  const storage = memoryStorage(initial), downloads = [], opened = [];
  const panel = mountEncryptedLibraryPanel({ document, parent, readEncrypted: () => envelope(),
    onOpen(text) { opened.push(text); return true; },
    download: ({ prepared }) => downloads.push(prepared), ...options,
    controllerOptions: { storage, ...options.controllerOptions } });
  t.after(() => panel.dispose());
  const field = name => parent.find("encrypted-library-" + name);
  async function click(name) {
    field(name).click();
    await until(() => !panel.state().busy);
  }
  function check(value = true) {
    field("ack").checked = value;
    field("ack").dispatchEvent(new Event("change"));
  }
  function select(index = 0) {
    field("select").value = panel.state().summary.entries[index].id;
    field("select").dispatchEvent(new Event("change"));
  }
  return { document, parent, storage, panel, field, click, check, select, downloads, opened };
}

test("library UI opens no database and starts with all mutations disabled", t => {
  const f = fixture(t);
  assert.equal(f.storage.calls.reads, 0);
  assert.equal(f.field("save").disabled, true);
  assert.equal(f.field("remove").disabled, true);
  assert.equal(f.field("commit").disabled, true);
  assert.equal(f.field("open").disabled, true);
  assert.equal(f.field("export").disabled, true);
  assert.equal(f.field("load").disabled, false);
});

test("preparing encryption enables only review, never automatic storage", async t => {
  const f = fixture(t);
  f.panel.setReady(true);
  assert.equal(f.field("save").disabled, false);
  assert.equal(f.storage.calls.writes, 0);
  await f.click("save");
  assert.equal(f.panel.state().phase, "review");
  assert.equal(f.field("commit").disabled, true);
  assert.equal(f.storage.calls.writes, 0);
  f.check();
  assert.equal(f.field("commit").disabled, false);
  await f.click("commit");
  assert.equal(f.storage.calls.writes, 1);
  assert.equal(f.field("ack").checked, false);
  assert.match(f.field("status").textContent, /保管が完了/);
});

test("unchecked review cannot change storage by clicking a disabled confirmation", async t => {
  const f = fixture(t);
  f.panel.setReady(true);
  await f.click("save");
  await f.click("commit");
  assert.equal(f.storage.calls.writes, 0);
  assert.equal(f.panel.state().phase, "review");
});

test("each new preview clears the previous acknowledgement", async t => {
  const f = fixture(t);
  f.panel.setReady(true);
  await f.click("save");
  f.check();
  await f.click("save");
  assert.equal(f.field("ack").checked, false);
  assert.equal(f.field("commit").disabled, true);
});

test("listing shows only timestamps, size and a shortened digest", async t => {
  const f = fixture(t, { initial: await library([1, 2]) });
  await f.click("load");
  const options = f.field("select").children;
  assert.equal(options.length, 2);
  assert.match(options[0].textContent, /bytes/);
  assert.match(options[0].textContent, /2026-/);
  assert(!options[0].textContent.includes("ciphertext"));
  assert(!options[0].textContent.includes(envelope()));
  assert.equal(f.panel.state().selected, null);
  assert.equal(f.field("remove").disabled, true);
});

test("deletion identifies one record and requires a new acknowledgement", async t => {
  const f = fixture(t, { initial: await library([1, 2]) });
  await f.click("load");
  f.select(1);
  const selected = f.panel.state().selected;
  await f.click("remove");
  assert.match(f.field("review").textContent, /1件/);
  assert(f.field("review").textContent.includes(selected.slice(0, 12)));
  assert.equal(f.storage.calls.writes, 0);
  f.check();
  await f.click("commit");
  assert.equal(f.storage.snapshot().entries.length, 1);
  assert(!f.storage.snapshot().entries.some(entry => entry.id === selected));
});

test("changing selection clears the deletion review and confirmation", async t => {
  const f = fixture(t, { initial: await library([1, 2]) });
  await f.click("load");
  f.select(0);
  await f.click("remove");
  f.check();
  f.select(1);
  assert.equal(f.panel.state().review, null);
  assert.equal(f.field("ack").checked, false);
  assert.equal(f.field("review").textContent, "");
  assert.equal(f.field("commit").disabled, true);
});

test("opening requires selection and only stages encrypted content", async t => {
  const f = fixture(t, { initial: await library([1]) });
  await f.click("load");
  f.select();
  await f.click("open");
  assert.deepEqual(f.opened, [envelope()]);
  assert.match(f.field("status").textContent, /まだ復元していません/);
  assert.equal(f.storage.calls.writes, 0);
});

test("download preview does not itself write a file", async t => {
  const f = fixture(t, { initial: await library([1]) });
  await f.click("load");
  f.select();
  await f.click("prepare-export");
  assert.equal(f.downloads.length, 0);
  assert.equal(f.field("export").disabled, false);
  await f.click("export");
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].text, envelope());
  assert.match(f.field("status").textContent, /開始/);
  assert.match(f.field("status").textContent, /完了は/);
  assert.equal(f.field("export").disabled, true);
});

test("protection clears rendered inventory, selection and mutation candidates", async t => {
  const f = fixture(t, { initial: await library() });
  await f.click("load");
  f.select();
  await f.click("remove");
  f.check();
  f.panel.protect();
  assert.equal(f.field("select").children.length, 0);
  assert.equal(f.field("ack").checked, false);
  assert.equal(f.field("review").textContent, "");
  assert.equal(f.field("save").disabled, true);
  assert.equal(f.storage.snapshot().entries.length, 1);
});

test("source change makes preparing a stale ciphertext fail with a static message", async t => {
  const f = fixture(t, { readEncrypted() { throw Error("sensitive account"); } });
  f.panel.setReady(true);
  await f.click("save");
  assert.match(f.field("status").textContent, /準備し直/);
  assert(!f.field("status").textContent.includes("sensitive"));
  assert.equal(f.storage.calls.reads, 0);
});

test("busy state disables competing controls but leaves cancel available", async t => {
  const pending = gate(), base = memoryStorage();
  const f = fixture(t, { controllerOptions: { storage: { ...base, read: () => pending.promise } } });
  f.field("load").click();
  assert.equal(f.field("load").disabled, true);
  assert.equal(f.field("select").disabled, true);
  assert.equal(f.field("save").disabled, true);
  assert.equal(f.field("cancel").disabled, false);
  f.field("cancel").click();
  pending.resolve(base.snapshot());
  await tick();
  assert.equal(f.panel.state().phase, "cancelled");
});

for (const error of ENCRYPTED_LIBRARY_CODES) {
  test("user-facing error message is present and static for " + error, async t => {
    assert.equal(typeof LIBRARY_MESSAGES[error], "string");
    assert(LIBRARY_MESSAGES[error].length > 10);
    const base = memoryStorage();
    const f = fixture(t, { controllerOptions: { storage: { ...base,
      read() { throw new EncryptedLibraryError(error); } } } });
    await f.click("load");
    assert.equal(f.field("status").textContent, LIBRARY_MESSAGES[error]);
  });
}

test("disposing removes listeners and DOM without deleting stored data", async t => {
  const f = fixture(t, { initial: await library() });
  await f.click("load");
  const load = f.field("load");
  f.panel.dispose();
  const reads = f.storage.calls.reads;
  load.click();
  assert.equal(f.storage.calls.reads, reads);
  assert.equal(f.parent.children.length, 0);
  assert.equal(f.storage.snapshot().entries.length, 1);
});

function integratedFixture(t, options = {}) {
  const document = documentFixture(), parent = new Element("main"), eventTarget = new EventTarget();
  const storage = memoryStorage(), staged = [];
  let current = draft();
  const panel = mountSecureBackupPanel({ document, parent, eventTarget,
    readDraft: () => clone(current), onStage(text) { staged.push(text); return true; },
    controllerOptions: { runner: createSecureBackupRunner(), encrypt: async () => fakePrepared(),
      decrypt: async () => fakeDecoded() }, libraryOptions: { storage }, ...options });
  t.after(() => panel.dispose());
  const secure = name => parent.find("secure-backup-" + name);
  const local = name => parent.find("encrypted-library-" + name);
  async function encrypt() {
    secure("password").value = secure("confirmation").value = PASSWORD;
    secure("acknowledged").checked = true;
    secure("acknowledged").dispatchEvent(new Event("change"));
    secure("encrypt").click();
    await until(() => panel.state().phase === "encrypted");
  }
  async function save() {
    local("save").click();
    await until(() => !local("ack").disabled);
    local("ack").checked = true;
    local("ack").dispatchEvent(new Event("change"));
    local("commit").click();
    await until(() => !local("load").disabled);
  }
  return { panel, document, parent, eventTarget, storage, staged, secure, local, encrypt, save,
    change() { current[0].tokens = ""; } };
}

test("integrated encryption can be saved without marking a download as completed", async t => {
  const f = integratedFixture(t);
  await f.encrypt();
  assert.equal(f.secure("password").value, "");
  assert.equal(f.secure("confirmation").value, "");
  await f.save();
  assert.equal(f.storage.snapshot().entries.length, 1);
  assert.equal(f.storage.snapshot().entries[0].text, fakePrepared().text);
  assert.equal(f.panel.state().downloadOffered, false);
  assert.equal(f.panel.state().diskSaved, false);
});

test("integrated library handoff requires password and explicit staging", async t => {
  const f = integratedFixture(t);
  await f.encrypt();
  await f.save();
  f.local("open").click();
  await until(() => f.panel.state().phase === "selected");
  assert.equal(f.staged.length, 0);
  assert.equal(f.secure("stage").disabled, true);
  f.secure("restore-password").value = PASSWORD;
  f.secure("decrypt").click();
  assert.equal(f.secure("restore-password").value, "");
  await until(() => f.panel.state().phase === "decrypted");
  assert.equal(f.staged.length, 0);
  f.secure("stage").click();
  assert.equal(f.staged.length, 1);
});

for (const action of ["protect", "invalidate", "hidden", "pagehide"]) {
  test("integrated " + action + " cancels library review and clears password inputs", async t => {
    const f = integratedFixture(t);
    await f.encrypt();
    f.local("save").click();
    await until(() => !f.local("ack").disabled);
    f.secure("restore-password").value = PASSWORD;
    if (action === "hidden") { f.document.hidden = true; f.document.dispatchEvent(new Event("visibilitychange")); }
    else if (action === "pagehide") f.eventTarget.dispatchEvent(new Event("pagehide"));
    else f.panel[action]();
    assert.equal(f.local("review").textContent, "");
    assert.equal(f.local("commit").disabled, true);
    assert.equal(f.secure("restore-password").value, "");
    assert.equal(f.storage.snapshot().entries.length, 0);
  });
}

test("integrated source mutation prevents saving obsolete prepared ciphertext", async t => {
  const f = integratedFixture(t);
  await f.encrypt();
  f.change();
  f.local("save").click();
  assert.match(f.local("status").textContent, /準備し直/);
  assert.equal(f.storage.calls.writes, 0);
});
