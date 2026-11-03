import test from "node:test";
import assert from "node:assert/strict";
import { historyQuery, queryReportHistory, reportHistoryIndex, reportHistoryCSV } from "../src/report-history-query.js";
import { historyDocument, historyRecord, reportInput, shiftedReport, sequenceHistory, id, clone } from "./helpers/report-set-fixtures.js";

test("block lookup distinguishes interval interior from literal metadata and excludes the earlier balance endpoint", () => {
  const input = historyDocument([historyRecord()]);
  assert.equal(queryReportHistory(input, { search: "36" }).matched, 0);
  for (const [block, count] of [["0", 0], ["30", 0], ["31", 1], ["36", 1], ["42", 1], ["43", 0]]) {
    for (const blockScope of ["planned", "saved"]) assert.equal(queryReportHistory(input, { block, blockScope }).matched, count);
  }
});

test("saved block lookup must match the selected token's actual queried range in the same slot", () => {
  const input = historyDocument([historyRecord(1, { report: reportInput({ counts: [3, 2, 5] }) })]);
  for (const [agent, block, blockScope, count] of [["DAT", "35", "saved", 1], ["DAT", "36", "saved", 0],
    ["DAT", "36", "planned", 1], ["EMA", "31", "saved", 0], ["EMA", "31", "planned", 1],
    ["CAWELON", "36", "saved", 1], ["all", "36", "saved", 1]]) {
    assert.equal(queryReportHistory(input, { agent, block, blockScope }).matched, count, `${agent} ${block} ${blockScope}`);
  }
});

test("a saved query with zero events remains searchable without claiming a transfer occurred", () => {
  const report = clone(reportInput());
  for (const slot of report.slots) for (const observation of slot.entry.draft.records) observation.events = [];
  const input = historyDocument([historyRecord(1, { report })]);
  assert.equal(queryReportHistory(input, { block: "35", blockScope: "saved" }).matched, 1);
  const context = reportHistoryIndex(input).rows[0].contexts[0];
  assert.deepEqual(context.savedRanges[0], { fromBlock: "31", toBlock: "35" });
  assert.ok(Object.isFrozen(context.savedRanges) && Object.isFrozen(context.savedRanges[0]));
  assert.doesNotMatch(JSON.stringify(reportHistoryIndex(input)), /events|transactionHash|balanceBaseUnits|"records"/);
});

test("exact block comparison preserves adjacent values above Number's safe integer range", () => {
  const offset = 2n ** 60n, input = historyDocument([historyRecord(1, { report: shiftedReport(offset) })]);
  for (const [delta, expected] of [[30n, 0], [31n, 1], [42n, 1], [43n, 0]]) {
    assert.equal(queryReportHistory(input, { block: String(offset + delta), blockScope: "saved" }).matched, expected);
  }
});

test("scope search composes with archive, status, tag, and literal filters without changing source", () => {
  const entries = sequenceHistory([0n, 12n]).entries;
  const input = historyDocument([entries[0], { ...entries[1], archived: true }]), before = JSON.stringify(input);
  assert.equal(queryReportHistory(input, { block: "44" }).matched, 0);
  const options = { block: "44", blockScope: "saved", archive: "archived", status: "arithmetic-agreement", agent: "DAT", tag: "daily", search: "報告 2" };
  assert.deepEqual(queryReportHistory(input, options).rows.map(row => row.id), [id(102)]);
  const csv = reportHistoryCSV(input, options);
  assert.equal(csv.rows, 1); assert.ok(csv.text.includes(id(102))); assert.ok(!csv.text.includes(id(101)));
  assert.equal(JSON.stringify(input), before);
});

test("invalid block forms, modes and accessors fail without coercion or execution", () => {
  for (const block of [null, 35, 35n, "01", "-1", "+35", " 35", "35\n", "35.0", "0x23", "1e3", "9".repeat(79), String(2n ** 256n)]) {
    assert.throws(() => historyQuery({ block }), error => error.code === "PERIOD_HISTORY_QUERY");
  }
  assert.throws(() => historyQuery({ blockScope: "events" }));
  let calls = 0;
  assert.throws(() => historyQuery({ get block() { calls++; return "35"; } }));
  assert.throws(() => historyQuery({ block: { toString() { calls++; return "35"; } } }));
  assert.equal(calls, 0);
  assert.equal(historyQuery({ block: String(2n ** 256n - 1n) }).block, String(2n ** 256n - 1n));
});

test("clearing block search restores the same ordinary list with either valid scope", () => {
  const input = sequenceHistory(), expected = queryReportHistory(input).rows.map(row => row.id);
  assert.deepEqual(queryReportHistory(input, { block: "", blockScope: "saved" }).rows.map(row => row.id), expected);
  assert.deepEqual(queryReportHistory(input, { block: "", blockScope: "planned" }).rows.map(row => row.id), expected);
});
