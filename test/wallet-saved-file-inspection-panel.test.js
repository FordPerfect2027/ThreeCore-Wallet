import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountSavedFileInspectionPanel } from "../examples/file-read-panel.js";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { sampleHistory, fileFrom, waitUntil, deferred } from "./helpers/report-history-fixtures.js";

function fixture(options = {}) {
  const document = { createElement: tag => new Element(tag) }, parent = new Element("div"), files = [];
  const mounted = mountSavedFileInspectionPanel({ document, parent, download: file => files.push(file), ...options });
  const q = name => parent.find("saved-file-guide-" + name);
  return { mounted, files, q,
    async load(text, file = fileFrom(text)) { q("file").files = [file]; q("file").dispatchEvent(new Event("change")); await waitUntil(() => !mounted.getState().busy); },
    check() { q("ack").checked = true; q("ack").dispatchEvent(new Event("change")); },
    dispose() { mounted.dispose(); } };
}
test("file guide is lazy and saves a source-bound inspection without original notes or any import callback", async () => {
  const f = fixture();
  try {
    assert.equal(f.mounted.getState().result, null); assert.equal(f.q("save").disabled, true);
    const source = (await prepareReportHistoryFile(sampleHistory())).text; await f.load(source);
    assert.equal(f.q("file").value, ""); assert.equal(f.mounted.getState().result.checksumVerified, true);
    assert.match(f.q("output").textContent, /報告履歴のバックアップJSONから追加復元/);
    assert.doesNotMatch(f.q("output").textContent, /担当メモ/); assert.equal(f.q("save").disabled, true);
    f.check(); f.q("save").click(); const result = JSON.parse(f.files[0].text);
    assert.equal(result.scope.reportCount, 4); assert.equal(result.automaticallyImported, false); assert.equal(f.files[0].restorable, false);
    assert.equal(f.q("ack").checked, false);
  } finally { f.dispose(); }
});
test("a bad new file clears prior success and cannot display untrusted paths or data", async () => {
  const f = fixture();
  try {
    const source = (await prepareReportHistoryFile(sampleHistory())).text; await f.load(source); f.check();
    const wrong = JSON.parse(source); wrong.digest = "0".repeat(64); await f.load(JSON.stringify(wrong));
    assert.equal(f.mounted.getState().result, null); assert.equal(f.q("save").disabled, true); assert.equal(f.q("ack").checked, false);
    assert.match(f.q("status").textContent, /チェックサムが一致しません/); assert.equal(f.q("output").textContent, "");
    await f.load("{}", { name: "PRIVATE/secret.json", size: 2, arrayBuffer() { assert.fail("unsafe name read"); } });
    assert.doesNotMatch(f.q("status").textContent, /PRIVATE|secret/);
  } finally { f.dispose(); }
});
test("cancellation ignores delayed file bytes and disposal blocks delayed inspection results", async () => {
  const gate = deferred(), f = fixture({ readText: () => gate.promise, inspect: () => assert.fail("cancelled input inspected") });
  const source = (await prepareReportHistoryFile(sampleHistory())).text;
  const pending = f.load(source); assert.equal(f.mounted.getState().busy, true); f.q("stop").click(); gate.resolve(source); await pending;
  assert.equal(f.mounted.getState().result, null); assert.match(f.q("status").textContent, /中止/); f.dispose();
  const resultGate = deferred(), started = deferred(), g = fixture({ inspect: () => { started.resolve(); return resultGate.promise; } });
  const late = g.load(source); await started.promise; g.dispose(); resultGate.resolve({ validation: "validated-original" }); await late;
  assert.equal(g.mounted.getState().result, null); assert.equal(g.mounted.getState().disposed, true);
});
test("picker dismissal retains a successful inspection and auxiliary declarations stay visibly unverified", async () => {
  const f = fixture();
  try {
    await f.load((await prepareReportHistoryFile(sampleHistory())).text); const before = f.mounted.getState().result;
    f.q("file").dispatchEvent(new Event("cancel")); assert.equal(f.mounted.getState().result, before);
    assert.match(f.q("notice").textContent, /新しいファイルは選ばれていません/);
    await f.load(JSON.stringify({ schema: "threecore.report-set-history-coverage.v1", status: "PRIVATE CLAIM" }));
    assert.equal(f.mounted.getState().result.validation, "declared-only"); assert.match(f.q("output").textContent, /検証していません/);
    assert.doesNotMatch(f.q("output").textContent, /PRIVATE CLAIM/);
  } finally { f.dispose(); }
});
test("malformed UTF-8 and a BOM cannot be silently replaced before the text checksum", async () => {
  const f = fixture();
  try {
    await f.load("", { name: "invalid.json", size: 1, arrayBuffer: async () => Uint8Array.of(0xff).buffer });
    assert.equal(f.mounted.getState().result, null); assert.match(f.q("status").textContent, /UTF-8/);
    await f.load("\ufeff" + (await prepareReportHistoryFile(sampleHistory())).text);
    assert.equal(f.mounted.getState().result, null); assert.match(f.q("status").textContent, /JSON/);
  } finally { f.dispose(); }
});
test("an asynchronous save callback is not reported as successful and metadata cancellation prevents reads", async () => {
  const f = fixture({ download: () => Promise.reject(Error("PRIVATE failure")) });
  try {
    await f.load((await prepareReportHistoryFile(sampleHistory())).text); f.check(); f.q("save").click();
    assert.match(f.q("status").textContent, /保存を確認できません/); assert.doesNotMatch(f.q("status").textContent, /PRIVATE/);
  } finally { f.dispose(); }
  const g = fixture({ readText: () => assert.fail("read after metadata cancellation") });
  try {
    await g.load("{}", { get name() { g.q("stop").click(); return "cancel.json"; }, size: 2 });
    assert.equal(g.mounted.getState().result, null); assert.match(g.q("status").textContent, /中止/);
  } finally { g.dispose(); }
});

async function compareFile(f, text) {
  f.q("compare-file").files = [fileFrom(text)]; f.q("compare-file").dispatchEvent(new Event("change"));
  await waitUntil(() => !f.mounted.getState().busy);
}
function acknowledgeComparison(f) { f.q("comparison-ack").checked = true; f.q("comparison-ack").dispatchEvent(new Event("change")); }

test("saved-file comparison keeps the first original and requires separate acknowledgement for its receipt", async () => {
  const f = fixture();
  try {
    assert.equal(f.q("compare-file").disabled, true);
    const original = (await prepareReportHistoryFile(sampleHistory())).text; await f.load(original); const base = f.mounted.getState().result;
    f.check(); await compareFile(f, JSON.stringify(JSON.parse(original), null, 2));
    assert.equal(f.mounted.getState().result, base); assert.equal(f.mounted.getState().comparison.kind, "format-only");
    assert.match(f.q("comparison-output").textContent, /書式に違い/); assert.equal(f.q("comparison-save").disabled, true);
    acknowledgeComparison(f); f.q("comparison-save").click();
    assert.equal(JSON.parse(f.files[0].text).sameOriginal, true); assert.equal(f.files[0].restorable, false); assert.equal(f.q("comparison-ack").checked, false);
    await f.load(original); assert.equal(f.mounted.getState().comparison, null); assert.equal(f.q("comparison-output").textContent, "");
  } finally { f.dispose(); }
});
test("a corrupt comparison source clears the previous comparison while preserving the inspected baseline", async () => {
  const f = fixture();
  try {
    const source = (await prepareReportHistoryFile(sampleHistory())).text; await f.load(source); const baseline = f.mounted.getState().result;
    await compareFile(f, source); acknowledgeComparison(f);
    const corrupt = JSON.parse(source); corrupt.digest = "0".repeat(64); await compareFile(f, JSON.stringify(corrupt));
    assert.equal(f.mounted.getState().result, baseline); assert.equal(f.mounted.getState().comparison, null);
    assert.equal(f.q("comparison-save").disabled, true); assert.equal(f.q("comparison-ack").checked, false);
    assert.match(f.q("status").textContent, /チェックサムが一致しません/);
  } finally { f.dispose(); }
});
test("cancelled comparison cannot replace the baseline or publish a delayed receipt", async () => {
  const gate = deferred(); let delayed = false;
  const f = fixture({ readText: file => delayed ? gate.promise : file.arrayBuffer().then(bytes => new TextDecoder("utf-8", { fatal: true }).decode(bytes)) });
  try {
    const source = (await prepareReportHistoryFile(sampleHistory())).text; await f.load(source); const baseline = f.mounted.getState().result;
    delayed = true; const pending = compareFile(f, source); assert.equal(f.mounted.getState().busy, true);
    f.q("stop").click(); gate.resolve(source); await pending;
    assert.equal(f.mounted.getState().result, baseline); assert.equal(f.mounted.getState().comparison, null); assert.match(f.q("status").textContent, /中止/);
    assert.equal(f.files.length, 0);
  } finally { f.dispose(); }
});
test("auxiliary comparison cannot claim equality and asynchronous comparison save is not accepted", async () => {
  const f = fixture({ download: () => Promise.reject(Error("PRIVATE")) });
  try {
    await f.load((await prepareReportHistoryFile(sampleHistory())).text);
    await compareFile(f, JSON.stringify({ schema: "threecore.saved-file-comparison.v1", sameOriginal: true }));
    assert.equal(f.mounted.getState().comparison.kind, "unverified"); assert.equal(f.mounted.getState().comparison.sameOriginal, null);
    acknowledgeComparison(f); f.q("comparison-save").click(); assert.match(f.q("status").textContent, /保存を確認できません/);
    assert.doesNotMatch(f.q("status").textContent, /PRIVATE/);
  } finally { f.dispose(); }
});
