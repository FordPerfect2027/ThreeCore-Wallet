import test from "node:test";
import assert from "node:assert/strict";
import { reportSetTimeline, historyCoverageSummaryText, historyCoverageCellText } from "../src/report-set-timeline.js";
import { mountReportSetTimeline } from "../examples/report-set-timeline-panel.js";
import { sequenceSet, sequenceHistory, demoSetHistory, historyRecord, historyDocument, reportInput, clone, id } from "./helpers/report-set-fixtures.js";
import { Element } from "./helpers/panel-dom.js";

const group = (input, agent = "DAT") => reportSetTimeline(input).groups.find(row => row.agent === agent);
const single = counts => sequenceSet(historyDocument([historyRecord(1, { report: reportInput({ counts }) })]));
function partition(value) {
  assert.equal(BigInt(value.recordedUniqueBlocks) + BigInt(value.pendingPlannedBlocks) + BigInt(value.unplannedBlocks), BigInt(value.spanBlocks));
  assert.equal(BigInt(value.recordedUniqueBlocks) + BigInt(value.pendingPlannedBlocks), BigInt(value.plannedUniqueBlocks));
  assert.equal(value.cells.reduce((sum, cell) => sum + BigInt(cell.blocks), 0n), BigInt(value.spanBlocks));
  value.cells.forEach((cell, index) => {
    assert.equal(BigInt(cell.toBlock) - BigInt(cell.fromBlock) + 1n, BigInt(cell.blocks));
    if (index) assert.equal(BigInt(cell.fromBlock), BigInt(value.cells[index - 1].toBlock) + 1n);
  });
}
test("saved prefixes distinguish empty plans, partial history and complete record presence", () => {
  const result = reportSetTimeline(single([0, 3, 5]));
  const [dat, ema, caw] = result.groups.map(row => row.historyCoverage);
  assert.deepEqual([dat.recordedUniqueBlocks, ema.recordedUniqueBlocks, caw.recordedUniqueBlocks], ["0", "5", "12"]);
  assert.deepEqual([dat.pendingPlannedBlocks, ema.pendingPlannedBlocks, caw.pendingPlannedBlocks], ["12", "7", "0"]);
  assert.equal(ema.reviewRecordedBlocks, "5");
  assert.deepEqual(ema.cells.map(row => [row.fromBlock, row.toBlock, row.kind]), [["31", "35", "recorded"], ["36", "42", "pending"]]);
  result.groups.forEach(row => partition(row.historyCoverage));
});
test("adjacent completed reports count each block once with exact inclusive query boundaries", () => {
  const value = group(sequenceSet()).historyCoverage;
  assert.deepEqual([value.fromBlock, value.toBlock, value.recordedUniqueBlocks, value.savedQueryRecords], ["31", "66", "36", 9]);
  assert.equal(value.multipleRecordBlocks, "0"); assert.equal(value.reviewRecordedBlocks, "0");
  assert.equal(value.cells[0].records[0].recordIndex, 0); assert.equal(value.cells[0].records[0].eventCount, 1);
  partition(value);
});
test("overlapping windows and identical saved reports never double count acquired ranges", () => {
  const overlap = group(sequenceSet(sequenceHistory([0n, 6n]))).historyCoverage;
  assert.equal(overlap.recordedUniqueBlocks, "18"); assert.equal(overlap.multipleRecordBlocks, "6"); partition(overlap);
  const repeated = group(sequenceSet(demoSetHistory(), [id(102), id(105)])).historyCoverage;
  assert.equal(repeated.recordedUniqueBlocks, "12"); assert.equal(repeated.multipleRecordBlocks, "12");
  assert.equal(repeated.reviewRecordedBlocks, "12"); assert.equal(repeated.savedQueryRecords, 6); partition(repeated);
  assert.match(historyCoverageCellText(repeated.cells[0]), /イベントや金額は結合していません/);
});
test("large unplanned gaps remain exact without allocating a row per block", () => {
  const gap = 9007199254740999n;
  const value = group(sequenceSet(sequenceHistory([0n, 12n + gap]))).historyCoverage;
  assert.equal(value.unplannedBlocks, gap.toString()); assert.equal(value.recordedUniqueBlocks, "24");
  assert.equal(value.cells.length, 7); assert.equal(value.cells[3].kind, "unplanned");
  assert.equal(value.cells[3].fromBlock, "43"); partition(value);
});
test("archived and restricted source records remain explicit review evidence", () => {
  const value = group(sequenceSet(demoSetHistory()), "CAWELON").historyCoverage;
  assert.equal(value.pendingPlannedBlocks, "7"); assert.equal(value.recordedUniqueBlocks, "53");
  assert.ok(value.cells.some(cell => cell.records.some(row => row.archivedReport))); partition(value);
  const restricted = sequenceSet(sequenceHistory([0n], report => { report.slots[0].entry.requiresNewPlan = true; }));
  const cells = group(restricted).historyCoverage.cells;
  assert.ok(cells.every(cell => cell.needsReview));
  assert.match(historyCoverageCellText(cells[0]), /再取得が必要/);
});
test("shared-chain hash disagreements remain visible despite full saved range coverage", () => {
  const result = reportSetTimeline(sequenceSet(demoSetHistory(), [id(101), id(106)]));
  for (const row of result.groups) {
    const value = row.historyCoverage;
    assert.equal(value.recordedUniqueBlocks, "24"); assert.equal(value.pendingPlannedBlocks, "0");
    assert.ok(value.cells.some(cell => cell.hashConflictBlocks.length && cell.needsReview));
    assert.equal(value.liveChainRechecked, false); assert.equal(value.completeHistory, false); partition(value);
  }
});
test("separate chains and missing tokens never acquire coverage from another group", () => {
  const history = historyDocument([
    historyRecord(1, { report: reportInput({ chainId: 84532, counts: [3, 5, 5] }) }),
    historyRecord(2, { report: reportInput({ chainId: 8453 }) }),
  ]);
  const result = reportSetTimeline(sequenceSet(history));
  const dat = result.groups.filter(row => row.agent === "DAT");
  assert.equal(dat.length, 2);
  assert.equal(dat.find(row => row.context.chainId === 84532).historyCoverage.recordedUniqueBlocks, "5");
  assert.equal(dat.find(row => row.context.chainId === 8453).historyCoverage.recordedUniqueBlocks, "12");
  const missing = reportSetTimeline(sequenceSet(sequenceHistory([0n], report => { report.slots[1].entry = null; })));
  assert.ok(!missing.groups.some(row => row.agent === "EMA")); assert.deepEqual(missing.missingAgents, ["EMA"]);
});
test("coverage is immutable, independent of selection order and does not alter evidence", () => {
  const history = sequenceHistory(), input = clone(sequenceSet(history)), before = JSON.stringify(input);
  const value = reportSetTimeline(input);
  assert.deepEqual(value, reportSetTimeline(sequenceSet(history, history.entries.map(row => row.id).reverse())));
  assert.equal(JSON.stringify(input), before);
  assert.ok(Object.isFrozen(value.groups[0].historyCoverage.cells[0].records[0]));
  assert.match(historyCoverageSummaryText(value.groups[0].historyCoverage), /重複する保存範囲は1回/);
  assert.match(historyCoverageCellText(value.groups[0].historyCoverage.cells[0]), /全履歴の取得や現在のチェーンとの一致を証明しません/);
});
test("coverage panel selects pending and recorded intervals and removes retained handlers", () => {
  const input = clone(single([3, 0, 5])); input.entries[0].label = "<img src=x onerror=fail()>";
  const before = JSON.stringify(input), parent = new Element("div"), document = { createElement: tag => new Element(tag) };
  const mounted = mountReportSetTimeline({ document, parent, input });
  const walk = node => [node, ...node.children.flatMap(walk)];
  const cells = walk(parent).filter(node => node.className === "report-set-history-coverage-cell");
  const detail = parent.find("report-set-history-coverage-detail");
  assert.equal(cells[0].getAttribute("aria-pressed"), "false"); cells[0].click();
  assert.match(detail.textContent, /<img src=x/); assert.equal(detail.children.length, 0);
  cells[1].click(); assert.match(detail.textContent, /計画はあるが履歴記録なし/);
  assert.equal(cells[0].getAttribute("aria-pressed"), "false"); assert.equal(cells[1].getAttribute("aria-pressed"), "true");
  assert.equal(JSON.stringify(input), before); const text = detail.textContent;
  mounted.dispose(); cells[0].click(); assert.equal(detail.textContent, text);
});
