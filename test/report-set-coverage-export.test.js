import test from "node:test";
import assert from "node:assert/strict";
import { prepareReportSetCoverageFile } from "../src/report-set-export.js";
import { prepareReportSetFile, decodeReportSetFile } from "../src/report-set-file.js";
import { reportSetTimeline } from "../src/report-set-timeline.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { sequenceSet, sequenceHistory, demoSetHistory, historyDocument, historyRecord, reportInput, historyMemory, clone, fileFrom, deferred } from "./helpers/report-set-fixtures.js";

function csvRows(text) {
  const rows = []; let row = [], value = "", quoted = false; text = text.replace(/^\ufeff/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { row.push(value); value = ''; }
    else if (char === '\r' && text[i + 1] === '\n' && !quoted) { row.push(value); rows.push(row); row = []; value = ''; i++; }
    else value += char;
  }
  assert.equal(quoted, false); assert.equal(value, ''); const [columns, ...values] = rows;
  return values.map(row => { assert.equal(row.length, columns.length); return Object.fromEntries(columns.map((key, i) => [key, row[i]])); });
}
const single = counts => sequenceSet(historyDocument([historyRecord(1, { report: reportInput({ counts }) })]));
test("coverage files distinguish planned, saved and missing intervals without adding token counts", async () => {
  const input = single([0, 3, 5]), original = JSON.stringify(input), file = await prepareReportSetCoverageFile(input), data = JSON.parse(file.text);
  assert.deepEqual(data.groups.map(group => group.recordedUniqueBlocks), ["0", "5", "12"]);
  assert.deepEqual(data.groups.map(group => group.pendingPlannedBlocks), ["12", "7", "0"]);
  assert.equal(data.sourcePayloadDigest, (await prepareReportSetFile(input)).digest);
  assert.equal(data.blockCountsCombinedAcrossGroups, false); assert.equal(data.completeHistory, false);
  assert.equal(data.savedQueryPresenceOnly, true); assert.equal(data.summary.allContinuous, false);
  for (const group of data.groups) assert.equal(BigInt(group.recordedUniqueBlocks) + BigInt(group.pendingPlannedBlocks) + BigInt(group.unplannedBlocks), BigInt(group.spanBlocks));
  assert.equal(JSON.stringify(input), original); assert.equal(file.restorable, false); await assert.rejects(decodeReportSetFile(file.text));
});
test("references retain exact original windows and whole-window event counts across split cells", async () => {
  const input = sequenceSet(sequenceHistory([0n, 6n])), data = JSON.parse((await prepareReportSetCoverageFile(input)).text);
  const group = data.groups[0], expected = reportSetTimeline(input).groups[0].historyCoverage;
  assert.equal(group.recordedUniqueBlocks, "18"); assert.equal(group.multipleRecordBlocks, "6");
  assert.equal(data.recordIndexBase, 0); assert.equal(data.eventCountScope, "original-query-window-not-split-cell");
  for (let i = 0; i < group.cells.length; i++) {
    const cell = group.cells[i];
    assert.equal(cell.fromBlock, expected.cells[i].fromBlock); assert.equal(cell.records.length, expected.cells[i].records.length);
    cell.records.forEach((record, j) => { const original = expected.cells[i].records[j];
      assert.equal(record.fromBlock, (BigInt(original.start) + 1n).toString()); assert.equal(record.toBlock, original.end);
      assert.equal(record.eventsInOriginalWindow, original.eventCount); assert.equal(record.recordIndex, original.recordIndex);
      assert.equal(record.reportId, original.reportId);
    });
  }
});
test("large gaps, separate contexts and missing token sources remain explicit", async () => {
  const gap = 9007199254740999n, big = JSON.parse((await prepareReportSetCoverageFile(sequenceSet(sequenceHistory([0n, gap + 12n])))).text);
  assert.equal(big.groups[0].unplannedBlocks, gap.toString()); assert.equal(big.groups[0].cells.length, 7);
  const mixed = sequenceSet(historyDocument([historyRecord(1, { report: reportInput({ chainId: 8453 }) }), historyRecord(2, { report: reportInput({ chainId: 84532 }) })]));
  const data = JSON.parse((await prepareReportSetCoverageFile(mixed)).text); assert.equal(data.groups.filter(g => g.context.agent === "DAT").length, 2);
  const absent = sequenceSet(sequenceHistory([0n, 12n], report => { report.slots[1].entry = null; }));
  const missing = JSON.parse((await prepareReportSetCoverageFile(absent)).text); assert.deepEqual(missing.missingAgents, ["EMA"]);
  assert.equal(missing.missingReportsByAgent.find(row => row.agent === "EMA").reportIds.length, 2);
  const rows = csvRows((await prepareReportSetCoverageFile(absent, "csv")).text);
  assert.deepEqual(JSON.parse(rows[0].missing_agents), ["EMA"]); assert.equal(rows[0].source_all_continuous, "false");
});
test("CSV row types prevent summary/range confusion and preserve all source findings", async () => {
  const input = sequenceSet(demoSetHistory()), json = JSON.parse((await prepareReportSetCoverageFile(input)).text);
  const file = await prepareReportSetCoverageFile(input, "csv"), rows = csvRows(file.text);
  assert.equal(rows[0].row_type, "source-summary"); assert.equal(rows[0].group_id, ""); assert.equal(rows[0].blocks, "");
  assert.equal(rows.filter(row => row.row_type === "group-summary").length, json.groups.length);
  assert.equal(rows.filter(row => row.row_type === "range").length, json.groups.reduce((n, group) => n + group.cells.length, 0));
  for (const group of json.groups) {
    const summary = rows.find(row => row.group_id === group.id && row.row_type === "group-summary");
    assert.equal(summary.recorded_unique_blocks, group.recordedUniqueBlocks); assert.equal(summary.blocks, "");
    const ranges = rows.filter(row => row.group_id === group.id && row.row_type === "range");
    assert.equal(ranges.reduce((n, row) => n + BigInt(row.blocks), 0n), BigInt(group.spanBlocks));
    ranges.forEach((row, i) => { assert.deepEqual(JSON.parse(row.saved_record_refs), group.cells[i].records); assert.equal(row.recorded_unique_blocks, ""); });
  }
  assert.ok(rows.every(row => row.source_all_continuous === "false" && row.live_chain_rechecked === "false"));
  assert.equal(file.byteLength, new TextEncoder().encode(file.text).byteLength);
});
test("shortening affects structured addresses only; note bodies and balances are never copied", async () => {
  const input = clone(sequenceSet()); input.entries[0].note = "DO_NOT_COPY_NOTE"; input.entries[0].label = '=SUM(1,2) "quoted"';
  const short = JSON.parse((await prepareReportSetCoverageFile(input)).text), full = JSON.parse((await prepareReportSetCoverageFile(input, "json", { shortAddresses: false, includeNotes: true })).text);
  assert.ok(short.groups[0].context.account.includes("…")); assert.ok(short.groups[0].tokenAddress.includes("…"));
  assert.equal(full.groups[0].context.account, input.entries[0].report.slots[0].entry.draft.plan.context.account);
  assert.doesNotMatch(JSON.stringify(full), /DO_NOT_COPY_NOTE|balanceBaseUnits|transactionHash/);
  assert.equal(full.groups[0].cells[0].records[0].label, input.entries[0].label);
  const rows = csvRows((await prepareReportSetCoverageFile(input, "csv")).text);
  assert.equal(JSON.parse(rows.find(row => row.row_type === "range").saved_record_refs)[0].label, input.entries[0].label);
  assert.ok(rows.every(row => !Object.values(row).some(value => /^\s*[=+@]/.test(value))));
});
test("archive, restrictions and conflicts stay visible even with full recorded coverage", async () => {
  const input = sequenceSet(demoSetHistory()), data = JSON.parse((await prepareReportSetCoverageFile(input)).text);
  assert.ok(data.groups.some(group => group.cells.some(cell => cell.records.some(record => record.archivedReport))));
  assert.ok(data.groups.some(group => group.cells.some(cell => cell.hashConflictBlocks.length)));
  assert.ok(data.groups.some(group => group.reviewRecordedBlocks !== "0")); assert.equal(data.summary.allContinuous, false);
  const restricted = sequenceSet(sequenceHistory([0n], report => { report.slots[0].entry.requiresNewPlan = true; }));
  const dat = JSON.parse((await prepareReportSetCoverageFile(restricted)).text).groups[0];
  assert.ok(dat.cells.every(cell => cell.needsReview && cell.records[0].requiresNewPlan));
});
test("source and display options are captured before hashing; cancellation cannot publish output", async () => {
  const input = clone(sequenceSet()), options = { shortAddresses: false }, gate = deferred(), started = deferred();
  const pending = prepareReportSetCoverageFile(input, "json", options, { subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; input.entries[0].label = "LATE LABEL"; options.shortAddresses = true; gate.resolve();
  const data = JSON.parse((await pending).text); assert.equal(data.options.shortAddresses, false); assert.doesNotMatch(JSON.stringify(data), /LATE LABEL/);
  const abort = new AbortController(); abort.abort(); await assert.rejects(prepareReportSetCoverageFile(sequenceSet(), "csv", {}, { signal: abort.signal }));
});
test("controller exports coverage under the existing acknowledgement without changing saved data", async () => {
  const store = historyMemory(sequenceHistory()), c = createReportSetController({ storage: store.storage }), files = [];
  try {
    await c.importFile(fileFrom((await prepareReportSetFile(sequenceSet())).text)); await c.applyReview(); const original = c.state.input, saved = JSON.stringify(store.document);
    assert.equal(await c.exportFile("coverage-json", false, file => files.push(file)), false);
    assert.equal(await c.exportFile("coverage-json", true, file => files.push(file)), true);
    assert.equal(await c.exportFile("coverage-csv", true, file => files.push(file), { shortAddresses: false }), true);
    assert.equal(JSON.parse(files[0].text).sourcePayloadDigest, (await prepareReportSetFile(original)).digest); assert.equal(csvRows(files[1].text)[0].row_type, "source-summary");
    assert.equal(c.state.input, original); assert.equal(JSON.stringify(store.document), saved); assert.ok(store.calls.every(row => row[0] === "read"));
    assert.equal(await c.exportFile("coverage-json", true, () => Promise.reject(Error("PRIVATE"))), false); assert.equal(c.state.error, "PERIOD_ASYNC_DELIVERY");
  } finally { c.dispose(); }
});
