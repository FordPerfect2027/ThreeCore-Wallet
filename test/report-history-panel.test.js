import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountReportHistoryPanel } from "../examples/report-history-panel.js";
import { prepareReportHistoryFile, decodeReportHistoryFile } from "../src/report-history-file.js";
import { historyMemory, historyDocument, historyRecord, sampleHistory, reportInput,
  id, LATER, fileFrom, waitUntil, deferred, walk, forkedInput } from "./helpers/report-history-fixtures.js";

function fixture(initial = sampleHistory(), options = {}) {
  const document = { createElement: tag => new Element(tag) }, parent = new Element("div");
  const store = options.store ?? historyMemory(initial), files = [], deliveries = [];
  let source = reportInput();
  const mounted = mountReportHistoryPanel({ document, parent, storage: store.storage,
    getReport: () => source, stageReport: input => { deliveries.push(input); return true; },
    now: () => LATER, createId: () => id(200), download: file => files.push(file), ...options.panel });
  const q = name => parent.find("report-history-" + name);
  const f = { document, parent, store, files, deliveries, mounted, q,
    source(input) { source = input; },
    click(name) { assert.equal(q(name).disabled, false, "Disabled: " + name); q(name).click(); },
    set(name, value, event = "change") { q(name).value = value; q(name).dispatchEvent(new Event(event)); },
    check(name, value = true) { q(name).checked = value; q(name).dispatchEvent(new Event("change")); },
    async settled() { await waitUntil(() => q("panel").getAttribute("aria-busy") === "false"); },
    async load() { f.click("refresh"); await f.settled(); },
    async file(text) { q("file").files = [fileFrom(text)]; q("file").dispatchEvent(new Event("change")); await f.settled(); },
    dispose() { mounted.dispose(); },
  };
  return f;
}

test("history panel starts lazy, labelled, and with write controls disabled", () => {
  const f = fixture(); assert.deepEqual(f.store.calls, []);
  assert.equal(f.q("panel").getAttribute("aria-label"), "PC内の報告履歴");
  assert.equal(f.q("status").getAttribute("role"), "status");
  for (const name of ["save", "open", "annotate", "archive", "restore", "backup-json", "apply"]) assert.equal(f.q(name).disabled, true, name);
  assert.equal(f.q("refresh").disabled, false); f.dispose();
});
test("loading shows counts and a filtered list without selecting or opening automatically", async () => {
  const f = fixture(); await f.load();
  assert.match(f.q("count").textContent, /3\/4/);
  assert.match(f.q("capacity").textContent, /通常 3件 \/ 非表示保管 1件 \/ 残り 8件/);
  assert.equal(f.q("selected").value, ""); assert.equal(f.deliveries.length, 0);
  assert.equal(f.q("selected-details").hidden, true); f.dispose();
});
test("selected report populates annotations and describes historical limitations", async () => {
  const f = fixture(); await f.load(); f.set("selected", id(101));
  assert.equal(f.q("label").value, "報告 1");
  assert.equal(f.q("note").value, "確認用メモ 1");
  assert.match(f.q("selected-text").textContent, /現在の残高/);
  assert.match(f.q("selected-text").textContent, /DAT/); assert.match(f.q("selected-text").textContent, /CAWELON/);
  assert.equal(f.q("open").disabled, false); f.dispose();
});
test("filtered-out selection remains explicit rather than silently selecting another report", async () => {
  const f = fixture(); await f.load(); f.set("selected", id(101));
  f.set("search", "EMA 確認", "input");
  assert.equal(f.q("selected").value, id(101));
  assert.ok(f.q("selected").children.some(row => row.textContent.startsWith("選択中（絞り込み対象外）")));
  assert.equal(f.mounted.getState().selectedId, id(101)); f.dispose();
});
test("new report is saved only after review and creates one row", async () => {
  const f = fixture(historyDocument()); await f.load();
  f.set("label", "今日の確認", "input"); f.set("note", "再確認予定", "input"); f.set("tags", "weekly, daily", "input");
  f.click("save"); assert.equal(f.q("review").hidden, false);
  assert.equal(f.store.document.entries.length, 0);
  assert.match(f.q("review-text").textContent, /今日の確認/);
  f.click("apply"); await f.settled();
  assert.equal(f.store.document.entries.length, 1);
  assert.equal(f.store.document.entries[0].note, "再確認予定");
  assert.deepEqual(f.store.document.entries[0].tags, ["daily", "weekly"]);
  assert.equal(f.q("selected").value, id(200)); f.dispose();
});
test("typing any annotation cancels an earlier pending review", async () => {
  const f = fixture(historyDocument()); await f.load(); f.click("save");
  f.set("note", "changed", "input");
  assert.equal(f.q("apply").disabled, true); assert.equal(f.q("review").hidden, true);
  assert.equal(f.store.document.entries.length, 0); f.dispose();
});
test("annotating a selected report does not replace evidence with displayed report", async () => {
  const f = fixture(); await f.load(); f.set("selected", id(102));
  const original = f.store.document.entries[1].report;
  f.set("label", "注意点を確認", "input"); f.set("note", "ハッシュの再確認", "input");
  f.click("annotate"); await f.settled();
  assert.equal(f.store.document.entries[1].label, "注意点を確認");
  assert.deepEqual(f.store.document.entries[1].report, original); f.dispose();
});
test("archive and restore are reversible and selected state stays visible", async () => {
  const f = fixture(); await f.load(); f.set("selected", id(101));
  f.click("archive"); await f.settled();
  assert.equal(f.store.document.entries[0].archived, true);
  assert.equal(f.q("archive").disabled, true); assert.equal(f.q("restore").disabled, false);
  assert.match(f.q("selection-note").textContent, /非表示保管/);
  f.click("restore"); await f.settled();
  assert.equal(f.store.document.entries[0].archived, false); f.dispose();
});
test("open review discloses archived status and delivers only after application", async () => {
  const f = fixture(); await f.load(); f.set("archive-filter", "archived"); f.set("selected", id(104));
  f.click("open"); assert.match(f.q("review-text").textContent, /非表示保管に移した報告/);
  assert.equal(f.deliveries.length, 0); f.click("apply"); await f.settled();
  assert.equal(f.deliveries.length, 1); assert.match(f.q("status").textContent, /上の期間レポート/); f.dispose();
});
test("comparison includes missing or changed evidence without arithmetic aggregation", async () => {
  const f = fixture(); await f.load(); f.set("baseline", id(101)); f.set("selected", id(102));
  f.click("compare");
  assert.match(f.q("comparison-text").textContent, /ハッシュ変更/);
  assert.match(f.q("comparison-note").textContent, /数量は合算しません/);
  assert.equal(f.deliveries.length, 0); f.dispose();
});
test("backup export requires checkbox and includes hidden reports", async () => {
  const f = fixture(); await f.load(); f.set("search", "does not exist", "input");
  assert.equal(f.q("backup-json").disabled, true); f.check("export-ack");
  f.click("backup-json"); await f.settled();
  assert.equal(f.files.length, 1);
  assert.equal((await decodeReportHistoryFile(f.files[0].text)).document.entries.length, 4); f.dispose();
});
test("selecting a different report resets export acknowledgment", async () => {
  const f = fixture(); await f.load(); f.check("export-ack");
  assert.equal(f.q("csv").disabled, false); f.set("selected", id(101));
  assert.equal(f.q("export-ack").checked, false); assert.equal(f.q("csv").disabled, true); f.dispose();
});
test("CSV reflects the visible filter without deleting reports", async () => {
  const f = fixture(); await f.load(); f.set("status-filter", "attention"); f.check("export-ack");
  f.click("csv"); await f.settled();
  assert.equal(f.files[0].rows, 1); assert.ok(f.files[0].text.includes("EMA 確認中"));
  assert.equal(f.store.document.entries.length, 4); f.dispose();
});
test("restore shows conflicts and disables apply until exclusion is explicit", async () => {
  const f = fixture(historyDocument([historyRecord()])); await f.load();
  const file = await prepareReportHistoryFile(historyDocument([historyRecord(1, { report: forkedInput() }), historyRecord(2)]));
  await f.file(file.text);
  assert.match(f.q("review-text").textContent, /追加 1件 \/ 重複 0件 \/ 競合 1件/);
  assert.equal(f.q("apply").disabled, true);
  assert.equal(f.q("skip-conflicts-label").hidden, false);
  f.check("skip-conflicts"); assert.equal(f.q("apply").disabled, false);
  f.click("apply"); await f.settled();
  assert.equal(f.store.document.entries.length, 2);
  assert.deepEqual(f.store.document.entries[0], historyRecord()); f.dispose();
});
test("corrupted backup reports failure and keeps original saved reports", async () => {
  const f = fixture(); await f.load(); const before = JSON.stringify(f.store.document);
  await f.file("not JSON"); assert.equal(f.q("status").getAttribute("data-error"), "true");
  assert.equal(JSON.stringify(f.store.document), before); assert.equal(f.q("review").hidden, true); f.dispose();
});
test("malicious-looking labels and notes are rendered as plain text", async () => {
  const text = '<img src=x onerror="alert(1)">';
  const f = fixture(historyDocument([historyRecord(1, { label: text, note: text })])); await f.load(); f.set("selected", id(101));
  assert.ok(f.q("selection-note").textContent.includes(text));
  assert.equal(walk(f.parent).some(node => ["SCRIPT", "IMG", "IFRAME"].includes(node.tagName)), false); f.dispose();
});
test("unsafe search shows guidance without corrupting the selection", async () => {
  const f = fixture(); await f.load(); f.set("selected", id(101)); f.set("tag-filter", "INVALID", "input");
  assert.match(f.q("count").textContent, /検索条件/);
  assert.equal(f.q("selected").value, id(101)); f.dispose();
});
test("busy writes disable duplicate save and edit controls", async () => {
  const gate = deferred(), store = historyMemory(historyDocument(), { beforeChange: () => gate.promise });
  const f = fixture(historyDocument(), { store }); await f.load(); f.click("save"); f.click("apply");
  assert.equal(f.q("save").disabled, true); assert.equal(f.q("label").disabled, true);
  assert.equal(f.q("cancel").disabled, false); gate.resolve(); await f.settled(); f.dispose();
});
test("dispose removes listeners and closes only its own adapter", async () => {
  const f = fixture(); await f.load(); const button = f.q("refresh"), count = f.store.calls.length;
  f.dispose(); button.click(); assert.equal(f.store.calls.length, count + 1);
  assert.equal(f.store.closed, true); assert.equal(f.parent.children.length, 0); f.dispose();
});
