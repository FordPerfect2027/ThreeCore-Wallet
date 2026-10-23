import test from "node:test";
import assert from "node:assert/strict";
import { mountTransferVaultPanel } from "../examples/transfer-vault-panel.js";
import { mountTransferPanel } from "../examples/transfer-panel.js";
import { Element } from "./helpers/panel-dom.js";
import { bundleFor, archiveFor, memoryVault, id, TIME } from "./helpers/vault-fixtures.js";
import { fileFromText, deferred, context, snapshot, OTHER } from "./helpers/transfer-fixtures.js";
import { prepareVaultFile } from "../src/transfer-vault-file.js";

async function settle(predicate) {
  for (let count = 0; count < 200; count++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail("Vault panel did not settle");
}
function fixture(options = {}) {
  const parent = new Element("div"), document = { createElement: tag => new Element(tag) };
  const storage = options.storage ?? memoryVault();
  const downloads = [], stages = [];
  let cards = bundleFor(), serial = 0;
  const panel = mountTransferVaultPanel({ document, parent, storage, readCards: () => cards,
    stageArchive: async (...args) => { stages.push(args); return true; }, download: file => downloads.push(file),
    now: () => TIME, createId: () => id(++serial), ...options });
  const q = name => parent.find("transfer-vault-" + name);
  return { parent, document, panel, storage, downloads, stages, q,
    setCards(value) { cards = value; },
    input(name, value, type = "input") { q(name).value = value; q(name).dispatchEvent(new Event(type)); },
    check(name, value = true) { q(name).checked = value; q(name).dispatchEvent(new Event("change")); },
    async click(name) { assert.equal(q(name).disabled, false, name + " disabled"); q(name).click(); await settle(() => q("panel").getAttribute("aria-busy") === "false"); },
    async capture() { await this.click("capture"); await this.click("apply"); },
    async save() { await this.click("refresh"); this.input("label", "My history"); await this.click("save"); },
    async load(file, name = "file") { q(name).files = [file]; q(name).dispatchEvent(new Event("change")); await settle(() => q("panel").getAttribute("aria-busy") === "false"); },
  };
}

test("vault panel starts with explicit controls and no storage reads", () => {
  const f = fixture();
  assert.equal(f.storage.calls.length, 0);
  assert.equal(f.q("save").disabled, true);
  assert.equal(f.q("apply").disabled, true);
  assert.equal(f.q("export-json").disabled, true);
  assert.equal(f.q("status").getAttribute("role"), "status");
  assert.equal(f.q("status").getAttribute("aria-live"), "polite");
  assert.match(f.q("notice").textContent, /ブラウザーデータの削除で失われる/);
  f.panel.dispose();
});

test("capture preview lists all tokens and apply is distinct from persistence", async () => {
  const f = fixture();
  await f.click("capture");
  assert.match(f.q("review").textContent, /DAT: 追加 1期間/);
  assert.match(f.q("review").textContent, /EMA: 追加 1期間/);
  assert.match(f.q("review").textContent, /CAWELON: 追加 1期間/);
  assert.equal(f.q("export-json").disabled, true);
  await f.click("apply");
  assert.equal(f.q("export-json").disabled, false);
  assert.equal(f.q("save").disabled, true);
  assert.equal(f.storage.calls.length, 0);
});

test("PC save opens storage explicitly and shows completion only after commit", async () => {
  const pending = deferred();
  const f = fixture({ storage: memoryVault(undefined, { beforeChange: () => pending.promise }) });
  await f.capture();
  await f.click("refresh");
  f.input("label", "保存テスト");
  f.q("save").click();
  assert.equal(f.q("panel").getAttribute("aria-busy"), "true");
  assert.equal(f.q("save").disabled, true);
  assert.equal(f.q("status").textContent.includes("完了"), false);
  pending.resolve();
  await settle(() => f.q("panel").getAttribute("aria-busy") === "false");
  assert.match(f.q("status").textContent, /保存が完了/);
  assert.match(f.q("metadata").textContent, /1 \/ 5件/);
  assert.equal(f.storage.value.entries[0].label, "保存テスト");
});

test("file replacement needs an acknowledgement only when records disappear", async () => {
  const f = fixture();
  await f.capture();
  await f.load(fileFromText((await prepareVaultFile(bundleFor(["DAT"]))).text));
  assert.equal(f.q("file").value, "");
  assert.equal(f.q("acknowledge-label").hidden, false);
  assert.equal(f.q("apply").disabled, true);
  f.check("acknowledge");
  assert.equal(f.q("apply").disabled, false);
  await f.click("apply");
  assert.match(f.q("overview").textContent, /EMA\n記録なし/);
  assert.equal(f.storage.value.entries.length, 0);
});

test("new previews reset the previous removal acknowledgement", async () => {
  const f = fixture();
  await f.capture();
  const file = fileFromText((await prepareVaultFile(bundleFor(["DAT"]))).text);
  await f.load(file);
  f.check("acknowledge");
  await f.click("cancel");
  await f.load(file);
  assert.equal(f.q("acknowledge").checked, false);
  assert.equal(f.q("apply").disabled, true);
});

test("activity filters reset pages and select distinct token quantities", async () => {
  const f = fixture({ readCards: () => bundleFor(undefined, { count: 22 }) });
  await f.capture();
  assert.equal(f.q("rows").children.length, 20);
  await f.click("next");
  assert.match(f.q("counter").textContent, /2ページ目/);
  f.input("agent", "EMA", "change");
  assert.match(f.q("counter").textContent, /22件 \/ 1ページ目/);
  assert.ok(f.q("rows").children.every(row => row.textContent.startsWith("EMA /")));
  assert.match(f.q("counterparties").textContent, /本人確認や信用評価ではありません/);
  f.input("search", "<img src=x>");
  assert.match(f.q("counter").textContent, /0件/);
  assert.equal(f.q("next").disabled, true);
  assert.equal(f.q("previous").disabled, true);
});

test("saved labels are rendered as literal text", async () => {
  const f = fixture();
  await f.capture();
  await f.click("refresh");
  f.input("label", "<img src=x onerror=alert(1)>");
  await f.click("save");
  assert.ok(f.q("stored").children.some(child => child.textContent.includes("<img")));
  assert.equal(f.q("stored").children.some(child => child.tagName === "IMG"), false);
});

test("archive, unarchive and purge require different deliberate controls", async () => {
  const f = fixture();
  await f.capture();
  await f.save();
  assert.equal(f.q("purge").disabled, true);
  await f.click("archive");
  assert.equal(f.q("inspect").disabled, true);
  assert.equal(f.q("stored-export").disabled, false);
  assert.equal(f.q("unarchive").disabled, false);
  assert.equal(f.q("purge").disabled, true);
  f.check("purge-ack");
  assert.equal(f.q("purge").disabled, false);
  await f.click("unarchive");
  assert.equal(f.q("purge-ack").checked, false);
  assert.equal(f.q("purge").disabled, true);
  await f.click("archive");
  f.check("purge-ack");
  await f.click("purge");
  assert.equal(f.storage.value.entries.length, 0);
});

test("changing selected saved record resets purge acknowledgement", async () => {
  const f = fixture();
  await f.capture();
  await f.save();
  await f.click("archive");
  await f.click("save");
  await f.click("archive");
  f.check("purge-ack");
  f.input("stored", id(1), "change");
  assert.equal(f.q("purge-ack").checked, false);
  assert.equal(f.q("purge").disabled, true);
});

test("one selected card receives a review, never a connection request", async () => {
  const f = fixture();
  await f.capture();
  f.input("restore-agent", "CAWELON", "change");
  await f.click("stage-card");
  assert.equal(f.stages.length, 1);
  assert.equal(f.stages[0][0], "CAWELON");
  assert.match(f.q("status").textContent, /個別カードにプレビュー/);
});

for (const kind of ["json", "csv", "txt"]) {
  test("explicit export control delivers " + kind, async () => {
    const f = fixture();
    await f.capture();
    await f.click("export-" + kind);
    await settle(() => f.downloads.length === 1);
    assert.equal(f.downloads[0].filename.endsWith("." + kind), true);
    assert.equal(f.storage.calls.length, 0);
  });
}

test("collection backup includes saved entries and requires review before import", async () => {
  const f = fixture();
  await f.capture();
  await f.save();
  await f.click("collection-export");
  await settle(() => f.downloads.length === 1);
  const second = fixture();
  assert.equal(second.q("collection-file").disabled, true);
  await second.click("refresh");
  await second.load(fileFromText(f.downloads[0].text), "collection-file");
  assert.equal(second.storage.value.entries.length, 0);
  assert.match(second.q("collection-review").textContent, /保存一覧への追加: 1件/);
  await second.click("collection-apply");
  assert.equal(second.storage.value.entries.length, 1);
  assert.equal(second.q("export-json").disabled, true);
});

test("cancel remains available during collection preview", async () => {
  const f = fixture();
  await f.capture();
  await f.save();
  await f.click("collection-export");
  await settle(() => f.downloads.length === 1);
  await f.load(fileFromText(f.downloads[0].text), "collection-file");
  assert.equal(f.q("cancel").disabled, false);
  await f.click("cancel");
  assert.equal(f.q("collection-review").textContent, "");
  assert.equal(f.q("collection-apply").disabled, true);
});

test("unavailable storage keeps JSON export usable", async () => {
  const storage = memoryVault();
  storage.read = async () => { throw Object.assign(Error("browser secret"), { code: "CHECKPOINT_UNAVAILABLE" }); };
  const f = fixture({ storage });
  await f.capture();
  await f.click("refresh");
  assert.match(f.q("status").textContent, /JSONへの保存を使用/);
  assert.equal(f.q("export-json").disabled, false);
  assert.equal(f.q("save").disabled, true);
});

test("disposal removes event handlers and prevents a late download", async () => {
  const pending = deferred();
  const f = fixture({ subtle: { digest: () => pending.promise } });
  await f.capture();
  const exportButton = f.q("export-json");
  exportButton.click();
  f.panel.dispose();
  pending.resolve(new ArrayBuffer(32));
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(f.downloads.length, 0);
  exportButton.click();
  assert.equal(f.parent.children.length, 0);
});

test("individual transfer panel captures data and stages only a matching context", async () => {
  const parent = new Element("div"), document = { createElement: tag => new Element(tag) };
  let selected = context();
  const panel = mountTransferPanel({ document, parent, getContext: () => selected, read: async () => snapshot() });
  assert.equal(panel.exportArchive(), null);
  parent.find("transfer-read").click();
  await settle(() => parent.find("transfer-panel").getAttribute("aria-busy") === "false");
  assert.equal(panel.exportArchive().records.length, 1);
  assert.equal(panel.stageArchive(archiveFor()), true);
  assert.equal(parent.find("transfer-archive-apply").disabled, false);
  assert.equal(parent.find("transfer-archive-overview").textContent, "");
  parent.find("transfer-archive-apply").click();
  assert.ok(parent.find("transfer-archive-overview").textContent.includes("1記録"));
  selected = context("DAT", 8453, OTHER);
  assert.equal(panel.stageArchive(archiveFor()), false);
  assert.equal(parent.find("transfer-archive-apply").disabled, true);
  panel.dispose();
  assert.equal(panel.exportArchive(), null);
});

test("individual card staging obeys cancelled-operation guard", () => {
  const parent = new Element("div"), document = { createElement: tag => new Element(tag) };
  const panel = mountTransferPanel({ document, parent, getContext: () => context(), read: async () => snapshot() });
  assert.equal(panel.stageArchive(archiveFor(), { current: () => false }), false);
  assert.equal(parent.find("transfer-archive-apply").disabled, true);
  panel.dispose();
});
