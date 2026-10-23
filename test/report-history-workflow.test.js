import test from "node:test";
import assert from "node:assert/strict";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { createPeriodReportController } from "../src/period-report-controller.js";
import { prepareReportHistoryFile, decodeReportHistoryFile } from "../src/report-history-file.js";
import { historyMemory, historyDocument, historyRecord, libraryMemory, reportInput, reportLibrary,
  selection, LATER, id, forkedInput, fileFrom, changedSlot, saveHistory } from "./helpers/report-history-fixtures.js";

test("full workflow captures report, persists history, reopens and recomputes without wallet access", async () => {
  const library = libraryMemory(reportLibrary()), store = historyMemory();
  const report = createPeriodReportController({ storage: library.storage, now: () => LATER });
  const history = createReportHistoryController({ storage: store.storage, getReport: () => report.state.input,
    stageReport: report.stageHistory, now: () => LATER, createId: () => id(200) });
  await report.refresh();
  for (const [agent, key] of Object.entries(selection())) report.select(agent, key);
  report.prepare("完成した期間レポート"); await report.applyReview();
  const original = report.state.input;
  await history.refresh(); history.prepareSave({ label: "保存1", note: "後から確認", tags: ["daily"] });
  await history.applyReview(); assert.deepEqual(store.document.entries[0].report, original);
  report.select("DAT", null); assert.equal(report.state.input, null);
  history.prepareOpen(); await history.applyReview();
  assert.equal(report.state.input, null); assert.equal(report.state.review.origin, "history");
  await report.applyReview(); assert.deepEqual(report.state.input, original);
  assert.equal(report.state.report.allArithmeticAgreement, true); assert.equal(report.state.origin, "history");
  assert.equal(library.calls.filter(row => row[0] === "change").length, 0);
  history.dispose(); report.dispose();
});

test("recovered backup opens even if the original checkpoint library no longer exists", async () => {
  const original = historyDocument([historyRecord(1, { archived: true, report: forkedInput() })]);
  const backup = await prepareReportHistoryFile(original), store = historyMemory();
  const absentLibrary = { read: async () => { throw Error("unavailable"); }, close() {} };
  const report = createPeriodReportController({ storage: absentLibrary });
  const history = createReportHistoryController({ storage: store.storage, getReport: () => report.state.input,
    stageReport: report.stageHistory });
  await history.refresh(); await history.importFile(fileFrom(backup.text)); await history.applyReview();
  history.select(id(101)); history.prepareOpen(); await history.applyReview(); await report.applyReview();
  assert.equal(report.state.report.status, "attention");
  assert.equal(report.state.report.issues.includes("BLOCK_HASH_CONFLICT"), true);
  assert.equal(report.state.selection.DAT, null);
  assert.equal(report.state.loaded, false);
  history.dispose(); report.dispose();
});

test("staging stored reports respects a busy report controller", async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const report = createPeriodReportController({ storage: { read: () => pending, close() {} } });
  const loading = report.refresh();
  assert.equal(report.stageHistory(reportInput()), false);
  assert.equal(report.state.error, "PERIOD_REPORT_BUSY");
  release(reportLibrary()); await loading;
  assert.equal(report.state.review, null); report.dispose();
});

test("staging does not clear accepted report or export before user applies review", async () => {
  const report = createPeriodReportController({ storage: libraryMemory().storage });
  report.stageHistory(reportInput()); await report.applyReview(); const previous = report.state.input;
  report.stageHistory(reportInput({ counts: [2, 5, 5] }));
  assert.equal(report.state.input, previous);
  assert.equal(report.state.review.report.status, "incomplete");
  report.cancel(); assert.equal(report.state.input, previous); report.dispose();
});

test("multiple backup cycles preserve annotations and quarantine flags", async () => {
  let document = historyDocument([historyRecord(1, { report: reportInput({ changes: { EMA: { requiresNewPlan: true } } }),
    note: "保持するメモ", tags: ["review"], archived: true })]);
  const original = document.entries[0];
  for (let index = 0; index < 3; index++) {
    const file = await prepareReportHistoryFile(document);
    document = (await decodeReportHistoryFile(file.text)).document;
  }
  assert.deepEqual(document.entries[0], original);
  assert.equal(document.entries[0].report.slots[1].entry.requiresNewPlan, true);
});

test("matching saved report aligns source selectors only to exact current library entries", async () => {
  const source = reportLibrary(), library = libraryMemory(source);
  const report = createPeriodReportController({ storage: library.storage }); await report.refresh();
  report.stageHistory(reportInput({ library: source })); await report.applyReview();
  assert.deepEqual(report.state.selection, selection());
  const changed = changedSlot(reportInput({ library: source }), "EMA", entry => { entry.label = "別名"; });
  report.stageHistory(changed); await report.applyReview();
  assert.equal(report.state.selection.EMA, null); assert.equal(report.state.selection.DAT, id(1));
  report.dispose();
});

test("changing selected history entry during open review preserves current report", async () => {
  const report = createPeriodReportController({ storage: libraryMemory().storage });
  report.stageHistory(reportInput()); await report.applyReview(); const current = report.state.input;
  const store = historyMemory(historyDocument([historyRecord(), historyRecord(2)]));
  const history = createReportHistoryController({ storage: store.storage, getReport: () => report.state.input,
    stageReport: report.stageHistory });
  await history.refresh(); history.select(id(101)); history.prepareOpen(); history.select(id(102));
  assert.equal(await history.applyReview(), false);
  assert.equal(report.state.input, current); assert.equal(report.state.review, null);
  history.dispose(); report.dispose();
});
