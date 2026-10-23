import test from "node:test";
import assert from "node:assert/strict";
import { historyQuery, queryReportHistory, reportHistoryIndex, reportHistoryCSV } from "../src/report-history-query.js";
import { historyDocument, historyRecord, sampleHistory, reportInput, id, TIME, LATER,
  clone, code, changedSlot } from "./helpers/report-history-fixtures.js";

test("default list excludes archived records while capacity includes them", () => {
  const result = queryReportHistory(sampleHistory());
  assert.equal(result.count, 4); assert.equal(result.matched, 3);
  assert.equal(result.active, 3); assert.equal(result.archived, 1); assert.equal(result.remaining, 8);
  assert.equal(result.rows.some(row => row.archived), false);
});
test("status index recalculates agreement, incomplete and inconsistent evidence", () => {
  const index = reportHistoryIndex(sampleHistory());
  assert.deepEqual(index.rows.map(row => row.status), ["arithmetic-agreement", "attention", "incomplete", "arithmetic-agreement"]);
  assert.equal(index.rows[1].issues.includes("BLOCK_HASH_CONFLICT"), true);
  assert.equal(index.rows[0].selectedCount, 3);
  assert.equal(index.rows[0].contexts.length, 3);
});
test("index never returns raw balances or event arrays", () => {
  const index = reportHistoryIndex(sampleHistory());
  const text = JSON.stringify(index);
  for (const forbidden of ["balanceBaseUnits", "transactionHash", "records", "privateKey", "report\":"]) assert.equal(text.includes(forbidden), false);
  assert.ok(Object.isFrozen(index.rows[0].contexts));
});
for (const [status, count] of [["all", 4], ["arithmetic-agreement", 2], ["attention", 1], ["incomplete", 1]]) {
  test("status filter " + status + " preserves all evidence outside view", () => {
    const input = sampleHistory(), before = JSON.stringify(input);
    assert.equal(queryReportHistory(input, { status, archive: "all" }).matched, count);
    assert.equal(JSON.stringify(input), before);
  });
}
for (const [archive, count] of [["active", 3], ["archived", 1], ["all", 4]]) {
  test("archive filter " + archive, () => assert.equal(queryReportHistory(sampleHistory(), { archive }).matched, count));
}
test("agent filter is about included records, not inferred token ownership", () => {
  const report = changedSlot(reportInput(), "EMA", (_entry, slot) => { slot.entry = null; });
  const input = historyDocument([historyRecord(1, { report })]);
  assert.equal(queryReportHistory(input, { agent: "EMA" }).matched, 0);
  assert.equal(queryReportHistory(input, { agent: "DAT" }).matched, 1);
  assert.equal(queryReportHistory(input, { agent: "CAWELON" }).matched, 1);
});
test("tag matching is exact; text search is literal and case-insensitive", () => {
  const input = sampleHistory();
  assert.equal(queryReportHistory(input, { tag: "review" }).matched, 1);
  assert.equal(queryReportHistory(input, { tag: "rev" }).matched, 0);
  assert.equal(queryReportHistory(input, { search: "ema 確認" }).matched, 1);
  assert.equal(queryReportHistory(input, { search: ".*" }).matched, 0);
  assert.equal(queryReportHistory(input, { archive: "all", search: "担当メモ" }).matched, 1);
});
test("search covers public account, chain and block, and never parses a regex", () => {
  const entry = historyRecord(), account = entry.report.slots[0].entry.draft.plan.context.account;
  const input = historyDocument([entry]);
  for (const search of [account.toUpperCase(), "84532", "42", "  確認用メモ  "]) {
    assert.equal(queryReportHistory(input, { search }).matched, 1, search);
  }
  assert.equal(queryReportHistory(input, { search: "[" }).matched, 0);
});
test("filters compose without changing overall counts", () => {
  const result = queryReportHistory(sampleHistory(), { archive: "all", status: "attention", tag: "review", search: "EMA", agent: "DAT" });
  assert.equal(result.count, 4); assert.equal(result.matched, 1);
  assert.equal(result.rows[0].id, id(102));
});
test("saved chronology differs from original report creation and annotation updates", () => {
  const first = historyRecord(1, { label: "B", updatedAt: LATER, report: reportInput({ time: LATER }) });
  const second = historyRecord(2, { label: "A", savedAt: LATER, updatedAt: LATER, report: reportInput({ time: TIME }) });
  const input = historyDocument([first, second]);
  const ids = order => queryReportHistory(input, { order }).rows.map(row => row.id);
  assert.deepEqual(ids("newest"), [id(102), id(101)]);
  assert.deepEqual(ids("oldest"), [id(101), id(102)]);
  assert.deepEqual(ids("name"), [id(102), id(101)]);
  assert.deepEqual(ids("created"), [id(101), id(102)]);
});
test("equal sorting keys use stable IDs independent of import order", () => {
  const a = historyRecord(1, { label: "equal" }), b = historyRecord(2, { label: "equal" });
  assert.deepEqual(queryReportHistory(historyDocument([b, a]), { order: "name" }).rows.map(row => row.id), [id(101), id(102)]);
});
for (const input of [{ archive: "deleted" }, { status: "verified" }, { agent: "DOT" }, { order: "value" },
  { tag: "UPPER" }, { search: "\u202e" }, { search: "x".repeat(101) }, { search: 1 }, { extra: true }, null, []]) {
  test("invalid search controls fail safely " + JSON.stringify(input), () => assert.throws(() => historyQuery(input)));
}
test("search query accessor cannot run", () => {
  let reads = 0;
  assert.throws(() => historyQuery({ get search() { reads++; return "x"; } }));
  assert.equal(reads, 0);
});
test("empty index exports header only and is not marked restorable", () => {
  const result = reportHistoryCSV(historyDocument());
  assert.equal(result.rows, 0);
  assert.equal(result.restorable, false);
  assert.equal(result.containsEvidence, false);
  assert.equal(result.text.split("\r\n").length, 2);
});
test("CSV exports only the requested view and preserves quoted multiline notes", () => {
  const input = historyDocument([historyRecord(1, { note: 'line one\n"quoted", line two' }), historyRecord(2, { archived: true })]);
  const csv = reportHistoryCSV(input);
  assert.equal(csv.rows, 1);
  assert.ok(csv.text.includes('"line one\n""quoted"", line two"'));
  assert.ok(!csv.text.includes(id(102)));
});
for (const note of ["=SUM(1,2)", "+1", "-1", "@command", "\t=cmd", "\n+cmd"]) {
  test("CSV annotations neutralize formula prefixes: " + JSON.stringify(note), () => {
    const input = historyDocument([historyRecord(1, { note: note.trim() })]);
    assert.ok(reportHistoryCSV(input).text.includes('"\'' + note.trim().replaceAll('"', '""') + '"'));
  });
}
