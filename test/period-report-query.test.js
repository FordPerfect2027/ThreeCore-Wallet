import test from "node:test";
import assert from "node:assert/strict";
import { queryPeriodReportEvents, validateReportEventQuery, REPORT_PAGE_SIZE } from "../src/period-report-query.js";
import { analyzePeriodReport } from "../src/period-report-engine.js";
import { reportInput, manyEventsInput, changedSlot, AGENTS, ACCOUNT, OTHER, hash, code } from "./helpers/period-report-fixtures.js";

const query = changes => ({ agent: "DAT", direction: "all", search: "", page: 0, ...changes });

test("events are chronologically ordered with independent exact token deltas", () => {
  const value = queryPeriodReportEvents(reportInput(), query());
  assert.deepEqual(value.rows.map(row => row.blockNumber), ["35", "40"]);
  assert.equal(value.total, 2);
  assert.equal(value.matched, 2);
  assert.equal(value.page, 0);
  assert.equal(value.pages, 1);
  assert.equal(value.pageSize, REPORT_PAGE_SIZE);
  assert.equal(value.totalsAreUnfiltered, true);
});

for (const agent of AGENTS) {
  test("filter selects only " + agent + " evidence", () => {
    const result = queryPeriodReportEvents(reportInput(), query({ agent }));
    assert.equal(result.agent, agent);
    assert.equal(result.rows.length, 2);
    assert.equal(result.status, "arithmetic-agreement");
  });
  test(agent + " pagination is bounded and lossless", () => {
    const input = manyEventsInput(57, agent);
    const first = queryPeriodReportEvents(input, query({ agent }));
    const second = queryPeriodReportEvents(input, query({ agent, page: 1 }));
    const third = queryPeriodReportEvents(input, query({ agent, page: 2 }));
    assert.deepEqual([first.rows.length, second.rows.length, third.rows.length], [25, 25, 7]);
    assert.equal(new Set([...first.rows, ...second.rows, ...third.rows].map(row => row.transactionHash)).size, 57);
    assert.equal(third.rows.at(-1).transactionHash, hash(10056));
  });
}

test("out-of-range page clamps without overflowing safe integer arithmetic", () => {
  const result = queryPeriodReportEvents(manyEventsInput(), query({ page: Number.MAX_SAFE_INTEGER }));
  assert.equal(result.page, 2);
  assert.equal(result.rows.length, 7);
});

test("empty search result remains page one of one", () => {
  const result = queryPeriodReportEvents(manyEventsInput(), query({ page: 40, search: "no matching hash" }));
  assert.equal(result.page, 0);
  assert.equal(result.pages, 1);
  assert.equal(result.matched, 0);
  assert.equal(result.total, 57);
  assert.deepEqual(result.rows, []);
});

test("direction filters distinguish incoming, outgoing and self", () => {
  const input = reportInput();
  assert.equal(queryPeriodReportEvents(input, query({ direction: "incoming" })).rows[0].blockNumber, "35");
  assert.equal(queryPeriodReportEvents(input, query({ direction: "outgoing" })).rows[0].blockNumber, "40");
  assert.equal(queryPeriodReportEvents(input, query({ direction: "self" })).matched, 0);
  const self = changedSlot(input, "DAT", entry => { entry.draft.records[0].events[0].from = ACCOUNT; });
  assert.equal(queryPeriodReportEvents(self, query({ direction: "self" })).matched, 1);
  assert.equal(queryPeriodReportEvents(self, query({ direction: "incoming" })).matched, 0);
});

for (const [name, search, expected] of [
  ["counterparty", OTHER, 2], ["owner", ACCOUNT, 2], ["block", "35", 1],
  ["transaction", hash(101), 1], ["uppercase hash", hash(101).toUpperCase(), 1],
  ["trimmed block", " 35 ", 1], ["literal symbols", "[.*]", 0],
]) {
  test("literal search by " + name, () => {
    assert.equal(queryPeriodReportEvents(reportInput(), query({ search })).matched, expected);
  });
}

test("filtered events never change residuals or report conclusions", () => {
  const input = changedSlot(reportInput(), "EMA", entry => { entry.draft.later.balanceBaseUnits = "0"; });
  const before = analyzePeriodReport(input);
  queryPeriodReportEvents(input, query({ agent: "EMA", direction: "incoming", search: "unknown" }));
  assert.deepEqual(analyzePeriodReport(input), before);
});

test("missing slot has no events and remains missing", () => {
  const input = reportInput({ selection: { DAT: null, EMA: null, CAWELON: "12345678-1234-4234-8234-000000000003" } });
  const result = queryPeriodReportEvents(input, query());
  assert.equal(result.total, 0);
  assert.equal(result.status, "missing");
});

test("partial and quarantined sources retain their status in event views", () => {
  const partial = queryPeriodReportEvents(reportInput({ counts: [3, 5, 5] }), query());
  assert.equal(partial.status, "partial");
  assert.equal(partial.rows.length, 1);
  const blocked = queryPeriodReportEvents(reportInput({ changes: { DAT: { requiresNewPlan: true } } }), query());
  assert.equal(blocked.status, "requires-new-plan");
  assert.equal(blocked.rows.length, 2);
});

for (const [changes, expected] of [
  [{ agent: "ETH" }, "PERIOD_REPORT_AGENT"], [{ direction: "all; DROP" }, "PERIOD_REPORT_DIRECTION"],
  [{ search: "x".repeat(101) }, "PERIOD_REPORT_SEARCH"], [{ search: "\u202e" }, "PERIOD_REPORT_SEARCH"],
  [{ search: "\n" }, "PERIOD_REPORT_SEARCH"], [{ search: null }, "PERIOD_REPORT_SEARCH"],
  [{ page: -1 }, "PERIOD_REPORT_PAGE"], [{ page: 0.1 }, "PERIOD_REPORT_PAGE"],
  [{ page: "1" }, "PERIOD_REPORT_PAGE"], [{ page: Infinity }, "PERIOD_REPORT_PAGE"],
  [{ page: Number.MAX_SAFE_INTEGER + 1 }, "PERIOD_REPORT_PAGE"], [{ extra: true }, "PERIOD_SHAPE"],
]) {
  test("reject malformed event query " + JSON.stringify(changes), () => {
    assert.throws(() => validateReportEventQuery(query(changes)), code(expected));
  });
}

test("query accessor is rejected without running it", () => {
  const value = query(); let read = false;
  Object.defineProperty(value, "search", { get() { read = true; return ""; } });
  assert.throws(() => validateReportEventQuery(value), code("PERIOD_SHAPE"));
  assert.equal(read, false);
});
