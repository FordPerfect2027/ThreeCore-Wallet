import test from "node:test";
import assert from "node:assert/strict";
import { mountCheckpointPanel } from "../examples/checkpoint-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { draft, gate, tick, until, fileObject } from "./helpers/workspace-fixtures.js";
import { stored, id, TIME, preparedDraft, memoryStorage } from "./helpers/checkpoint-fixtures.js";
import { prepareCheckpointCollection, decodeCheckpointCollection } from "../src/checkpoint-transfer.js";
import { CheckpointError } from "../src/checkpoint-model.js";

const prepared = await preparedDraft();
function fixture(options = {}) {
  const document = { createElement: name => new Element(name) };
  const parent = new Element("main");
  const storage = options.storage ?? memoryStorage();
  const staged = [], downloads = [];
  let counter = 20;
  const panel = mountCheckpointPanel({ document, parent, storage,
    readDraft: () => draft(), onStage: value => staged.push(value),
    download: value => downloads.push(value.prepared),
    now: () => TIME, createId: () => id(++counter), ...options });
  const field = name => parent.find("checkpoint-" + name);
  const settled = () => until(() => field("panel").getAttribute("aria-busy") === "false");
  async function click(name) { field(name).click(); await settled(); }
  function select(value) {
    field("select").value = value;
    field("select").dispatchEvent(new Event("change"));
  }
  function check(name, value = true) {
    field(name).checked = value;
    field(name).dispatchEvent(new Event("change"));
  }
  async function loadFile(text, changes = {}) {
    field("import-file").files = [fileObject(text, changes)];
    field("import-file").dispatchEvent(new Event("change"));
    await settled();
  }
  return { panel, parent, storage, staged, downloads, field, settled, click, select, check, loadFile };
}

test("panel mount does not access storage or wallet and exposes a manual refresh", () => {
  const f = fixture();
  assert.deepEqual(f.storage.calls, []);
  assert.equal(f.field("save").disabled, true);
  assert.equal(f.field("refresh").disabled, false);
  assert.match(f.field("count").textContent, /まだ読み込んでいません/);
  f.panel.dispose();
});

test("panel exposes plain-language scope and privacy information", () => {
  const f = fixture();
  const texts = [];
  const visit = node => { texts.push(node.textContent); node.children.forEach(visit); };
  visit(f.parent);
  const content = texts.join("\n");
  assert.match(content, /ブラウザー/);
  assert.match(content, /暗号化/);
  assert.match(content, /ファイル/);
  f.panel.dispose();
});

test("refresh enables save without restoring any wallet data", async () => {
  const f = fixture();
  await f.click("refresh");
  assert.equal(f.field("save").disabled, false);
  assert.match(f.field("count").textContent, /0 \/ 5/);
  assert.deepEqual(f.staged, []);
  assert.match(f.field("status").textContent, /設定・履歴は変更していません/);
  f.panel.dispose();
});

test("an empty checkpoint name produces a usable message and no write", async () => {
  const f = fixture();
  await f.click("refresh");
  await f.click("save");
  assert.match(f.field("status").textContent, /1〜60文字/);
  assert.equal(f.storage.current().entries.length, 0);
  f.panel.dispose();
});

test("saving selects the new snapshot but requires inspection before stage", async () => {
  const f = fixture();
  await f.click("refresh");
  f.field("name").value = "今日の控え";
  await f.click("save");
  assert.equal(f.field("select").value, id(21));
  assert.equal(f.field("inspect").disabled, false);
  assert.equal(f.field("stage").disabled, true);
  assert.equal(f.storage.current().entries[0].label, "今日の控え");
  assert.match(f.field("status").textContent, /保存しました/);
  f.panel.dispose();
});

test("inspection describes all three agents and staging is explicit", async () => {
  const f = fixture({ storage: memoryStorage(stored(1, prepared.text)) });
  await f.click("refresh");
  f.select(id(1));
  await f.click("inspect");
  for (const agent of ["DAT", "EMA", "CAWELON"]) assert.match(f.field("detail").textContent, new RegExp(agent));
  assert.equal(f.field("stage").disabled, false);
  assert.equal(f.staged.length, 0);
  await f.click("stage");
  assert.equal(f.staged.length, 1);
  assert.match(f.field("status").textContent, /一括復元の入力欄/);
  f.panel.dispose();
});

test("changing selection clears the old inspection", async () => {
  const f = fixture({ storage: memoryStorage(stored(2, prepared.text)) });
  await f.click("refresh");
  f.select(id(1));
  await f.click("inspect");
  f.select(id(2));
  assert.equal(f.field("stage").disabled, true);
  assert.equal(f.field("detail").textContent, "");
  f.panel.dispose();
});

test("placeholder selection disables destructive and restore controls", async () => {
  const f = fixture({ storage: memoryStorage(stored(1, prepared.text)) });
  await f.click("refresh");
  f.select(id(1));
  f.select("");
  for (const name of ["inspect", "stage", "archive", "unarchive", "purge", "export", "rename-button"]) {
    assert.equal(f.field(name).disabled, true, name);
  }
  f.panel.dispose();
});

test("rename keeps the original payload and refreshes option text", async () => {
  const f = fixture({ storage: memoryStorage(stored(1, prepared.text)) });
  await f.click("refresh");
  f.select(id(1));
  f.field("rename").value = "保存しておく設定";
  await f.click("rename-button");
  const row = f.storage.current().entries[0];
  assert.equal(row.label, "保存しておく設定");
  assert.equal(row.fileText, prepared.text);
  assert.match(f.field("select").children[1].textContent, /保存しておく設定/);
  f.panel.dispose();
});

test("HTML-looking checkpoint names remain text in options", async () => {
  const input = stored(1, prepared.text);
  input.entries[0].label = "<img src=x onerror=alert(1)>";
  const f = fixture({ storage: memoryStorage(input) });
  await f.click("refresh");
  const option = f.field("select").children[1];
  assert.equal(option.children.length, 0);
  assert.match(option.textContent, /<img/);
  f.panel.dispose();
});

test("archive switches to the archived view and disables direct restore", async () => {
  const f = fixture({ storage: memoryStorage(stored(1, prepared.text)) });
  await f.click("refresh");
  f.select(id(1));
  await f.click("archive");
  assert.equal(f.field("archived").checked, true);
  assert.equal(f.field("select").value, id(1));
  assert.equal(f.field("archive").disabled, true);
  assert.equal(f.field("unarchive").disabled, false);
  await f.click("inspect");
  assert.equal(f.field("stage").disabled, true);
  assert.equal(f.field("export").disabled, false);
  f.panel.dispose();
});

test("unarchive restores list membership without touching current settings", async () => {
  const input = stored(1, prepared.text);
  input.entries[0].archived = true;
  const f = fixture({ storage: memoryStorage(input) });
  await f.click("refresh");
  f.check("archived");
  f.select(id(1));
  await f.click("unarchive");
  assert.equal(f.field("archived").checked, false);
  assert.equal(f.field("select").value, id(1));
  assert.equal(f.staged.length, 0);
  f.panel.dispose();
});

test("purge stays disabled until an archived snapshot is explicitly confirmed", async () => {
  const input = stored(1, prepared.text);
  input.entries[0].archived = true;
  const f = fixture({ storage: memoryStorage(input) });
  await f.click("refresh");
  f.check("archived");
  f.select(id(1));
  assert.equal(f.field("purge").disabled, true);
  await f.click("purge");
  assert.equal(f.storage.current().entries.length, 1);
  f.check("confirmed");
  assert.equal(f.field("purge").disabled, false);
  await f.click("purge");
  assert.equal(f.storage.current().entries.length, 0);
  assert.equal(f.field("confirmed").checked, false);
  f.panel.dispose();
});

test("purge confirmation is cleared by selection and filter changes", async () => {
  const input = stored(2, prepared.text);
  input.entries.forEach(row => { row.archived = true; });
  const f = fixture({ storage: memoryStorage(input) });
  await f.click("refresh");
  f.check("archived");
  f.select(id(1));
  f.check("confirmed");
  f.select(id(2));
  assert.equal(f.field("confirmed").checked, false);
  assert.equal(f.field("purge").disabled, true);
  f.check("confirmed");
  f.check("archived", false);
  assert.equal(f.field("confirmed").checked, false);
  f.panel.dispose();
});

test("five checkpoints including archived ones disable a sixth save", async () => {
  const input = stored(5, prepared.text);
  input.entries[4].archived = true;
  const f = fixture({ storage: memoryStorage(input) });
  await f.click("refresh");
  assert.equal(f.field("save").disabled, true);
  assert.match(f.field("count").textContent, /5 \/ 5/);
  assert.equal(f.field("select").children.length, 5);
  f.panel.dispose();
});

test("busy storage locks controls and prevents duplicate refreshes", async () => {
  const f = fixture();
  const pending = gate();
  f.storage.onRead(() => pending.promise);
  f.field("refresh").click();
  assert.equal(f.field("refresh").disabled, true);
  assert.equal(f.field("save").disabled, true);
  f.field("refresh").click();
  assert.deepEqual(f.storage.calls, ["read"]);
  pending.resolve();
  await f.settled();
  assert.equal(f.field("refresh").disabled, false);
  f.panel.dispose();
});

for (const [errorCode, message] of [
  ["CHECKPOINT_QUOTA", /容量が不足/],
  ["CHECKPOINT_UNAVAILABLE", /利用できません/],
  ["CHECKPOINT_BLOCKED", /ほかのページ/],
  ["CHECKPOINT_VERSION", /新しい形式/],
  ["CHECKPOINT_STALE", /一覧を読み直して/],
]) {
  test("storage error has actionable wording: " + errorCode, async () => {
    const f = fixture();
    f.storage.onRead(async () => { throw new CheckpointError(errorCode); });
    await f.click("refresh");
    assert.match(f.field("status").textContent, message);
    assert.equal(f.field("save").disabled, true);
    assert.equal(f.field("refresh").disabled, false);
    f.panel.dispose();
  });
}

test("a broken inner checksum cannot enable stage or download", async () => {
  const input = stored(1, prepared.text.replace(/"digest": "./, '"digest": "x'));
  const f = fixture({ storage: memoryStorage(input) });
  await f.click("refresh");
  f.select(id(1));
  await f.click("inspect");
  assert.equal(f.field("stage").disabled, true);
  await f.click("export");
  assert.equal(f.downloads.length, 0);
  f.panel.dispose();
});

test("single-snapshot export returns verified file bytes to the download adapter", async () => {
  const f = fixture({ storage: memoryStorage(stored(1, prepared.text)) });
  await f.click("refresh");
  f.select(id(1));
  await f.click("export");
  assert.equal(f.downloads.length, 1);
  assert.equal(f.downloads[0].text, prepared.text);
  f.panel.dispose();
});

test("collection export includes snapshots hidden by the current filter", async () => {
  const input = stored(2, prepared.text);
  input.entries[1].archived = true;
  const f = fixture({ storage: memoryStorage(input) });
  await f.click("refresh");
  await f.click("export-collection");
  assert.equal((await decodeCheckpointCollection(f.downloads[0].text)).entries.length, 2);
  assert.equal(f.staged.length, 0);
  f.panel.dispose();
});

test("collection import previews first and requires a separate checkbox", async () => {
  const f = fixture();
  await f.click("refresh");
  const text = (await prepareCheckpointCollection(stored(2, prepared.text))).text;
  await f.loadFile(text);
  assert.match(f.field("import-detail").textContent, /0 → 2/);
  assert.equal(f.storage.current().entries.length, 0);
  assert.equal(f.field("import-apply").disabled, true);
  f.check("import-confirmed");
  await f.click("import-apply");
  assert.equal(f.storage.current().entries.length, 2);
  assert.equal(f.field("import-confirmed").checked, false);
  assert.equal(f.field("import-apply").disabled, true);
  assert.equal(f.staged.length, 0);
  f.panel.dispose();
});

test("choosing a new collection clears prior confirmation", async () => {
  const f = fixture();
  await f.click("refresh");
  await f.loadFile((await prepareCheckpointCollection(stored(1, prepared.text))).text);
  f.check("import-confirmed");
  await f.loadFile((await prepareCheckpointCollection(stored(2, prepared.text))).text);
  assert.equal(f.field("import-confirmed").checked, false);
  assert.equal(f.field("import-apply").disabled, true);
  assert.match(f.field("import-detail").textContent, /0 → 2/);
  f.panel.dispose();
});

test("cancel clears the proposed collection without writing to storage", async () => {
  const f = fixture();
  await f.click("refresh");
  await f.loadFile((await prepareCheckpointCollection(stored(1, prepared.text))).text);
  f.check("import-confirmed");
  await f.click("import-cancel");
  assert.equal(f.field("import-detail").textContent, "");
  assert.equal(f.field("import-apply").disabled, true);
  assert.equal(f.storage.current().entries.length, 0);
  f.panel.dispose();
});

test("invalid JSON clears a prior successful preview", async () => {
  const f = fixture();
  await f.click("refresh");
  await f.loadFile((await prepareCheckpointCollection(stored(1, prepared.text))).text);
  await f.loadFile("{damaged");
  assert.equal(f.field("import-detail").textContent, "");
  assert.equal(f.field("import-apply").disabled, true);
  assert.equal(f.storage.current().entries.length, 0);
  f.panel.dispose();
});

test("wrong extension fails before file content is read", async () => {
  let reads = 0;
  const f = fixture({ readBytes: async () => { reads++; return new Uint8Array(); } });
  await f.click("refresh");
  await f.loadFile("{}", { name: "backup.exe" });
  assert.equal(reads, 0);
  assert.match(f.field("status").textContent, /読み込めません/);
  assert.equal(f.field("import-apply").disabled, true);
  f.panel.dispose();
});

test("cancel during file IO prevents a late preview", async () => {
  const pending = gate();
  const f = fixture({ readBytes: () => pending.promise });
  await f.click("refresh");
  const text = (await prepareCheckpointCollection(stored(1, prepared.text))).text;
  f.field("import-file").files = [fileObject(text)];
  f.field("import-file").dispatchEvent(new Event("change"));
  assert.equal(f.field("save").disabled, true);
  f.field("import-cancel").click();
  pending.resolve(new TextEncoder().encode(text));
  await tick();
  await f.settled();
  assert.equal(f.field("import-detail").textContent, "");
  assert.equal(f.field("import-apply").disabled, true);
  f.panel.dispose();
});

test("dispose removes event listeners and prevents late UI writes", async () => {
  const pending = gate();
  const f = fixture();
  const refresh = f.field("refresh");
  f.storage.onRead(() => pending.promise);
  refresh.click();
  f.panel.dispose();
  pending.resolve();
  await tick();
  assert.equal(f.parent.children.length, 0);
  refresh.click();
  assert.deepEqual(f.storage.calls, ["read", "close"]);
});

test("draft edits do not automatically persist or request wallet restoration", async () => {
  const f = fixture();
  await f.click("refresh");
  f.panel.invalidateDraft();
  f.panel.invalidateDraft();
  assert.deepEqual(f.storage.calls, ["read"]);
  assert.equal(f.staged.length, 0);
  f.panel.dispose();
});

