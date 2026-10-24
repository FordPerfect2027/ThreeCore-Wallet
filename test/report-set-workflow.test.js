import test from "node:test";
import assert from "node:assert/strict";
import { createReportSetController } from "../src/report-set-controller.js";
import { prepareReportSetFile, decodeReportSetFile, readReportSetFile } from "../src/report-set-file.js";
import { reportSetHTML, reportSetCSV } from "../src/report-set-export.js";
import { analyzeReportSet } from "../src/report-set-engine.js";
import { inspectSetSources } from "../src/report-set-model.js";
import { reportSetDiagnostics } from "../src/report-set-diagnostics.js";
import { sequenceSet, sequenceHistory, demoSetHistory, historyMemory,
  historyDocument, clone, id, AFTER, fileFrom } from "./helpers/report-set-fixtures.js";

async function capture(history, ids) {
  const memory = historyMemory(history);
  const controller = createReportSetController({ storage: memory.storage, now: () => AFTER });
  const files = [];
  try {
    assert.equal(await controller.refresh(), true);
    assert.equal(controller.select(ids), true);
    assert.equal(controller.prepare("引継ぎ用の期間確認"), true);
    assert.equal(controller.state.input, null);
    assert.equal(await controller.applyReview(), true);
    assert.equal(await controller.exportFile("json", true, file => files.push(file)), true);
    assert.deepEqual(memory.document, history);
    assert.ok(memory.calls.every(call => call[0] === "read"));
    return { file: files[0], input: controller.state.input, result: controller.state.result };
  } finally {
    controller.dispose();
  }
}

test("handoff workflow preserves evidence across an independent empty local history", async () => {
  const history = sequenceHistory();
  const before = JSON.stringify(history);
  const captured = await capture(history, [id(103), id(101), id(102)]);
  const receiver = historyMemory(historyDocument());
  const controller = createReportSetController({ storage: receiver.storage });
  try {
    assert.equal(await controller.importFile(fileFrom(captured.file.text)), true);
    assert.equal(controller.state.review.origin, "file");
    assert.deepEqual(controller.state.review.input.entries.map(entry => entry.id), [id(103), id(101), id(102)]);
    assert.equal(await controller.applyReview(), true);
    assert.deepEqual(controller.state.result, captured.result);
    assert.deepEqual(controller.state.input, captured.input);
    assert.equal(await controller.inspectSources(), true);
    assert.ok(controller.state.inspection.rows.every(row => row.status === "missing"));
    assert.equal(controller.state.result.allContinuous, true);
    assert.equal(receiver.document.entries.length, 0);
    assert.ok(receiver.calls.every(call => call[0] === "read"));
    assert.equal(JSON.stringify(history), before);
  } finally { controller.dispose(); }
});

test("different selection order changes backup identity but not chronological coverage", async () => {
  const history = sequenceHistory();
  const forward = sequenceSet(history, [id(101), id(102), id(103)]);
  const reverse = sequenceSet(history, [id(103), id(102), id(101)]);
  const files = await Promise.all([prepareReportSetFile(forward), prepareReportSetFile(reverse)]);
  assert.notEqual(files[0].digest, files[1].digest);
  const a = analyzeReportSet(forward), b = analyzeReportSet(reverse);
  assert.equal(a.allContinuous, true);
  assert.equal(b.allContinuous, true);
  assert.deepEqual(a.tokens, b.tokens);
  assert.notDeepEqual(a.reports, b.reports);
});

test("repeated save/open cycles cannot drift units, block numbers or metadata", async () => {
  const original = sequenceSet(sequenceHistory([9007199254740999n, 9007199254741011n]));
  let current = original;
  const digests = [];
  for (let iteration = 0; iteration < 3; iteration++) {
    const file = await prepareReportSetFile(current);
    digests.push(file.digest);
    current = (await readReportSetFile(fileFrom(file.text))).input;
  }
  assert.deepEqual(current, original);
  assert.equal(new Set(digests).size, 1);
  assert.deepEqual(analyzeReportSet(current), analyzeReportSet(original));
  assert.equal(analyzeReportSet(current).tokens[0].groups[0].plannedUniqueBlocks, "24");
});

test("twelve-report handoff preserves all reports with repeated source IDs across periods", async () => {
  const history = sequenceHistory(Array.from({ length: 12 }, (_, index) => BigInt(index * 12)));
  const captured = await capture(history, history.entries.map(entry => entry.id));
  const restored = await decodeReportSetFile(captured.file.text);
  assert.equal(restored.input.entries.length, 12);
  assert.deepEqual(restored.input.entries, history.entries);
  for (const token of captured.result.tokens) {
    assert.equal(token.groups[0].rows.length, 12);
    assert.equal(token.groups[0].links.length, 11);
    assert.equal(token.groups[0].plannedUniqueBlocks, "144");
    assert.equal(new Set(token.groups[0].rows.map(row => row.sourceId)).size, 1);
    assert.equal(new Set(token.groups[0].rows.map(row => row.reportId)).size, 12);
  }
});

test("annotations after export are differences to inspect, not a reason to mutate the backup", async () => {
  const history = sequenceHistory();
  const captured = await capture(history, history.entries.map(entry => entry.id));
  const current = clone(history);
  current.entries[0].label = "今日の名前";
  current.entries[1].note = "追記";
  current.entries[2].archived = true;
  const inspection = inspectSetSources(captured.input, current);
  assert.equal(inspection.changed, 3);
  assert.ok(inspection.rows.every(row => row.status === "metadata"));
  assert.equal((await prepareReportSetFile(captured.input)).digest, captured.file.digest);
  assert.equal(analyzeReportSet(captured.input).allContinuous, true);
});

test("summary exports and restored analysis agree on gaps and review state", async () => {
  const history = sequenceHistory([0n, 24n, 48n]);
  const captured = await capture(history, history.entries.map(entry => entry.id));
  const restored = (await decodeReportSetFile(captured.file.text)).input;
  const analysis = analyzeReportSet(restored);
  const html = reportSetHTML(restored).text;
  const csv = reportSetCSV(restored).text;
  assert.equal(analysis.allContinuous, false);
  assert.ok(analysis.tokens.every(token => token.groups[0].gapBlocks === "24"));
  assert.ok(html.includes("抜け 24"));
  assert.ok(csv.includes('"gap"'));
  assert.ok(csv.includes('"set_review_required"'));
  assert.equal(reportSetDiagnostics(restored).items.filter(row => row.kind === "gap").length, 6);
});

test("forked saved reports remain review-needed in JSON, HTML and CSV", async () => {
  const history = demoSetHistory();
  const input = sequenceSet(history, [id(101), id(106)]);
  const restored = (await decodeReportSetFile((await prepareReportSetFile(input)).text)).input;
  const analysis = analyzeReportSet(restored);
  assert.equal(analysis.allContinuous, false);
  assert.ok(analysis.tokens.every(token => token.hashConflictCount > 0));
  const csv = reportSetCSV(restored).text;
  assert.ok(csv.includes("token_hash_conflicts"));
  assert.ok(csv.includes("set_review_required"));
  const html = reportSetHTML(restored).text;
  assert.ok(html.includes("ハッシュが異なります"));
  assert.ok(html.includes("確認が必要な箇所"));
});

test("removing one report from a selection never deletes its source entry", async () => {
  const history = sequenceHistory();
  const first = await capture(history, [id(101), id(102), id(103)]);
  const second = await capture(history, [id(101), id(103)]);
  assert.equal(first.result.allContinuous, true);
  assert.equal(second.result.allContinuous, false);
  assert.ok(second.result.issues.includes("GAPS"));
  assert.equal(history.entries.length, 3);
  assert.equal(first.input.entries.length, 3);
  assert.equal(second.input.entries.length, 2);
});

test("no current-chain fetch, provider request or financial execution is needed by analysis", () => {
  // The evidence-only API takes one validated data argument and has no provider dependency.
  const input = sequenceSet();
  const result = analyzeReportSet(input);
  assert.equal(result.liveChainRechecked, false);
  assert.equal(result.provesProfit, false);
  assert.equal(result.tokenAmountsSummed, false);
  assert.equal(result.eventsCombined, false);
  const diagnostics = reportSetDiagnostics(input);
  assert.equal(diagnostics.automaticRepairs, false);
  assert.equal(diagnostics.historicalOnly, true);
});
