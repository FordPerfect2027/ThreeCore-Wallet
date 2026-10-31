import { prepareReportHistoryFile, decodeReportHistoryFile } from "../src/report-history-file.js";
import { historyErrorText } from "../src/report-history-view.js";
import { reportSetHistoryDocument } from "../src/report-set-model.js";
import { preparePeriodLibraryFile, decodePeriodLibraryFile } from "../src/period-library-file.js";
import { libraryErrorText } from "../src/period-library-view.js";
import { periodReportEntryLibrary } from "../src/period-report-model.js";
import test from "node:test";
import assert from "node:assert/strict";
import { walletSavedFileTargetCode, walletSavedFileTargetMessage } from "../src/file-read-status.js";
import { preparePeriodFile, decodePeriodFile } from "../src/period-file.js";
import { preparePeriodReportFile, decodePeriodReportFile } from "../src/period-report-file.js";
import { prepareReportSetFile, decodeReportSetFile } from "../src/report-set-file.js";
import { prepareReportSetChecksFile, prepareReportSetComparisonFile, prepareReportSetCoverageFile,
  reviewReportSetChecksFile, reviewReportSetComparisonFile, prepareReportSetEventComparisonFile, reviewReportSetEventComparisonFile, reviewReportSetCoverageFile } from "../src/report-set-export.js";
import { periodMessage } from "../src/period-view.js";
import { reportErrorText } from "../src/period-report-view.js";
import { setErrorText } from "../src/report-set-view.js";
import { sequenceSet, demoSetHistory } from "./helpers/report-set-fixtures.js";

const source = sequenceSet(), after = sequenceSet(demoSetHistory());
const routes = [
  ["threecore.wallet-saved-browser-batch.v1",null,"PERIOD_FILE_SAVED_BATCH_ONLY","複数の保存ファイル"],
  ["threecore.wallet-saved-browser-batch.v2",null,"PERIOD_FILE_SAVED_BATCH_ONLY","複数の保存ファイル"],
  ["threecore.wallet-saved-batch-inspection.v1",null,"PERIOD_FILE_SAVED_BATCH_ONLY","複数の保存ファイル"],
  ["threecore.saved-file-comparison-review.v1",null,"PERIOD_FILE_SAVED_REVIEW_ONLY","保存ファイル比較の照合結果"],
  ["threecore.saved-file-comparison-bundle.v1",null,"PERIOD_FILE_SAVED_BUNDLE_ONLY","両方の元資料をまとめたJSON"],
  ["threecore.saved-file-comparison-bundle-review.v1",null,"PERIOD_FILE_SAVED_BUNDLE_REVIEW_ONLY","元資料は含まれません"],
  ["threecore.saved-file-comparison.v1", null, "PERIOD_FILE_SAVED_COMPARISON_ONLY", "比較した両方の元のJSON"],
  ["threecore.saved-file-inspection.v1", null, "PERIOD_FILE_INSPECTION_ONLY", "元記録は含まれず"],
  ["threecore.report-history-import-inspection.v1", null, "PERIOD_FILE_HISTORY_INSPECTION_ONLY", "元の報告やメモは含まれません"],
  ["threecore.report-history-file.v1", "history", "PERIOD_FILE_USE_HISTORY", "報告履歴のバックアップJSONから追加復元"],
  ["threecore.period-library-file.v1", "library", "PERIOD_FILE_USE_LIBRARY", "期間の保存一覧JSONを読み込む"],
  ["threecore.period-library-import-inspection.v1", null, "PERIOD_FILE_IMPORT_INSPECTION_ONLY", "現在側と読込側"],
  ["threecore.saved-event-comparison-file.v1", "event-comparison", "PERIOD_FILE_EVENT_COMPARISON_ONLY", "保存した履歴比較JSONを元資料と照合"],
  ["threecore.saved-event-comparison-review.v1", null, "PERIOD_FILE_EVENT_REVIEW_ONLY", "元の確認セットJSONと履歴比較JSON"],
  ["threecore.period-file.v1", "period", "PERIOD_FILE_USE_PERIOD", "控えの保存と復元"],
  ["threecore.period-report-file.v1", "report", "PERIOD_FILE_USE_REPORT", "3つの記録を、一つの報告に"],
  ["threecore.report-set-file.v1", "set", "PERIOD_FILE_USE_SET", "保存した確認セットを開く"],
  ["threecore.report-set-check-details.v1", "checks", "PERIOD_FILE_USE_CHECKS", "保存した確認箇所JSONを元資料と照合"],
  ["threecore.report-set-comparison-file.v1", "comparison", "PERIOD_FILE_USE_COMPARISON", "保存した比較JSONを照合"],
  ["threecore.report-set-check-review.v1", null, "PERIOD_FILE_CHECK_REVIEW_ONLY", "元の確認セットJSONと確認箇所JSON"],
  ["threecore.report-set-comparison-review.v1", null, "PERIOD_FILE_COMPARISON_REVIEW_ONLY", "差し替え前と候補"],
  ["threecore.report-set-history-coverage.v1", "coverage", "PERIOD_FILE_COVERAGE_ONLY", "元の履歴を復元するファイルではありません"],
  ["threecore.report-set-history-coverage-review.v1", null, "PERIOD_FILE_COVERAGE_REVIEW_ONLY", "元の確認セットJSONと履歴範囲JSON"],
  ["threecore.missing-history-queue.v1", null, "PERIOD_FILE_QUEUE_ONLY", "未取得の期間控え"],
];
const decoders = {
  history: decodeReportHistoryFile,
  library: decodePeriodLibraryFile,
  coverage: text => reviewReportSetCoverageFile(source, text),
  "event-comparison": text => reviewReportSetEventComparisonFile(source, text),
  period: decodePeriodFile, report: decodePeriodReportFile, set: decodeReportSetFile,
  checks: text => reviewReportSetChecksFile(source, text), comparison: text => reviewReportSetComparisonFile(source, after, text),
};
for (const [schema, target, code, label] of routes) test("declared wallet artifact gives a bounded destination hint: " + schema, async () => {
  for (const [current, decode] of Object.entries(decoders)) {
    assert.equal(walletSavedFileTargetCode(schema, current), target === current ? null : code);
    if (target === current) continue;
    await assert.rejects(decode(JSON.stringify({ schema, privateText: "DO_NOT_DISPLAY" })), error => error.code === code);
  }
  for (const view of [periodMessage, reportErrorText, setErrorText, libraryErrorText, historyErrorText]) {
    const message = view(code); assert.ok(message.includes(label)); assert.doesNotMatch(message, /DO_NOT_DISPLAY/);
  }
});
test("all existing supported artifacts still undergo their complete successful validation", async () => {
  const period = source.entries[0].report.slots[0].entry.draft, report = source.entries[0].report;
  const history = reportSetHistoryDocument(source);
  assert.deepEqual((await decodeReportHistoryFile((await prepareReportHistoryFile(history)).text)).document, history);
  const library = periodReportEntryLibrary(report, "DAT");
  assert.deepEqual((await decodePeriodLibraryFile((await preparePeriodLibraryFile(library)).text)).document, library);
  assert.deepEqual((await decodePeriodFile((await preparePeriodFile(period)).text)).draft, period);
  assert.deepEqual((await decodePeriodReportFile((await preparePeriodReportFile(report)).text)).input, report);
  assert.deepEqual((await decodeReportSetFile((await prepareReportSetFile(source)).text)).input, source);
  const checks = await prepareReportSetChecksFile(source), comparison = await prepareReportSetComparisonFile(source, after);
  assert.equal((await reviewReportSetChecksFile(source, checks.text)).matchesRecomputation, true);
  assert.equal((await reviewReportSetComparisonFile(source, after, comparison.text)).matchesRecomputation, true);
  const events = await prepareReportSetEventComparisonFile(source, { beforeId: source.entries[0].id, afterId: source.entries[1].id, agent: "DAT" });
  assert.equal((await reviewReportSetEventComparisonFile(source, events.text)).matchesRecomputation, true);
  assert.equal((await reviewReportSetCoverageFile(source, (await prepareReportSetCoverageFile(source)).text)).matchesRecomputation, true);
});
test("real exported explanation files receive guidance instead of being treated as restorable sources", async () => {
  const files = [await prepareReportSetChecksFile(source), await prepareReportSetComparisonFile(source, after), await prepareReportSetCoverageFile(source)];
  for (const file of files) await assert.rejects(decodeReportSetFile(file.text), error => /^PERIOD_FILE_(USE_CHECKS|USE_COMPARISON|COVERAGE_ONLY)$/.test(error.code));
});
test("unknown, duplicate, unsafe or malformed declarations never receive a guessed route", async () => {
  for (const text of ["{", "null", "[]", '{"schema":"unknown-private-name"}',
    '{"schema":"threecore.period-file.v1","schema":"threecore.report-set-file.v1"}',
    '{"schema":"threecore.period-file.v1","__proto__":{}}']) {
    for (const decode of Object.values(decoders)) await assert.rejects(decode(text), error => !/^PERIOD_FILE_(USE_|.*_ONLY$)/.test(error.code));
  }
  for (const value of [null, "__proto__", "constructor", "<script>private</script>", { toString() { throw Error("Do not coerce"); } }]) {
    assert.equal(walletSavedFileTargetCode(value, "set"), null); assert.equal(walletSavedFileTargetMessage(value), null);
    assert.equal(walletSavedFileTargetCode("threecore.period-file.v1", value), null);
  }
});
test("destination hints cannot mask checksum corruption in the correct reader", async () => {
  for (const [prepare, decode, value] of [[prepareReportHistoryFile, decodeReportHistoryFile, reportSetHistoryDocument(source)], [preparePeriodLibraryFile, decodePeriodLibraryFile, periodReportEntryLibrary(source.entries[0].report, "DAT")], [preparePeriodFile, decodePeriodFile, source.entries[0].report.slots[0].entry.draft],
    [preparePeriodReportFile, decodePeriodReportFile, source.entries[0].report], [prepareReportSetFile, decodeReportSetFile, source]]) {
    const data = JSON.parse((await prepare(value)).text); data.digest = "0".repeat(64);
    await assert.rejects(decode(JSON.stringify(data)), error => error.code === "PERIOD_CHECKSUM");
  }
});
