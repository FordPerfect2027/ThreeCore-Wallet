import test from "node:test";
import assert from "node:assert/strict";
import { PERIOD_REPORT_SCHEMA, PERIOD_REPORT_AGENTS, emptyReportSelection, validateReportSelection,
  createPeriodReportInput, validatePeriodReportInput, periodReportInputKey, assertReportSourcesUnchanged } from "../src/period-report-model.js";
import { reportInput, reportLibrary, selection, changedSlot, clone, id, library, entry,
  TIME, LATER, checkpoint, context, plan, code } from "./helpers/period-report-fixtures.js";

test("report selection begins empty without silently choosing a wallet", () => {
  assert.deepEqual(emptyReportSelection(), { DAT: null, EMA: null, CAWELON: null });
  assert.ok(Object.isFrozen(emptyReportSelection()));
  assert.ok(Object.isFrozen(PERIOD_REPORT_AGENTS));
});

test("canonical report contains original immutable evidence and no conclusion", () => {
  const result = reportInput();
  assert.equal(result.schema, PERIOD_REPORT_SCHEMA);
  assert.deepEqual(result.slots.map(row => row.agent), PERIOD_REPORT_AGENTS);
  assert.equal(result.slots[0].entry.id, id(1));
  assert.equal(result.historicalOnly, true);
  assert.equal(result.independentlyVerified, false);
  assert.equal(result.status, undefined);
  assert.equal(result.report, undefined);
  assert.ok(Object.isFrozen(result.slots[0].entry.draft.records[0].events));
});

test("input validation detaches source objects recursively", () => {
  const source = clone(reportInput()), result = validatePeriodReportInput(source);
  source.title = "later";
  source.slots[0].entry.label = "later label";
  source.slots[0].entry.draft.records[0].events[0].amountBaseUnits = "0";
  assert.notEqual(result.title, source.title);
  assert.notEqual(result.slots[0].entry.label, source.slots[0].entry.label);
  assert.notEqual(result.slots[0].entry.draft.records[0].events[0].amountBaseUnits, "0");
});

for (const agent of PERIOD_REPORT_AGENTS) {
  test("single selected " + agent + " remains reportable with missing slots", () => {
    const choice = { ...emptyReportSelection(), [agent]: selection()[agent] };
    const result = reportInput({ selection: choice });
    assert.equal(result.slots.filter(row => row.entry).length, 1);
    assert.equal(result.slots.find(row => row.agent === agent).entry.draft.plan.context.agent, agent);
  });
  test("wrong agent cannot be assigned to " + agent, () => {
    const other = PERIOD_REPORT_AGENTS.find(value => value !== agent);
    assert.throws(() => reportInput({ selection: { ...selection(), [agent]: selection()[other] } }), code("PERIOD_REPORT_AGENT"));
  });
  test("missing selected " + agent + " source is not silently dropped", () => {
    assert.throws(() => reportInput({ selection: { ...selection(), [agent]: id(99) } }), code("PERIOD_REPORT_SOURCE_MISSING"));
  });
  test("archived and quarantined " + agent + " evidence is preserved", () => {
    const result = reportInput({ changes: { [agent]: { archived: true, requiresNewPlan: true } } });
    const value = result.slots.find(row => row.agent === agent).entry;
    assert.equal(value.archived, true);
    assert.equal(value.requiresNewPlan, true);
  });
}

test("all-missing report is rejected", () => {
  assert.throws(() => reportInput({ selection: emptyReportSelection() }), code("PERIOD_REPORT_EMPTY"));
});

for (const value of [null, [], {}, "DAT", { ...selection(), unexpected: true }]) {
  test("reject selection shape " + JSON.stringify(value), () => {
    assert.throws(() => validateReportSelection(value), code("PERIOD_SHAPE"));
  });
}

for (const value of ["", "not-an-id", 1, undefined, id(1).toUpperCase().replace("1234", "ABCD")]) {
  test("reject malformed selected record " + String(value), () => {
    assert.throws(() => validateReportSelection({ ...selection(), DAT: value }));
  });
}

test("selection accessor does not run", () => {
  let reads = 0;
  const value = { ...selection() };
  Object.defineProperty(value, "DAT", { enumerable: true, get() { reads++; return id(1); } });
  assert.throws(() => validateReportSelection(value), code("PERIOD_SHAPE"));
  assert.equal(reads, 0);
});

const invalidInputs = [
  ["schema", value => { value.schema = "future"; }, "PERIOD_REPORT_SCHEMA"],
  ["historical", value => { value.historicalOnly = false; }, "PERIOD_REPORT_SCHEMA"],
  ["verified", value => { value.independentlyVerified = true; }, "PERIOD_REPORT_SCHEMA"],
  ["unknown result", value => { value.status = "safe"; }, "PERIOD_SHAPE"],
  ["empty title", value => { value.title = ""; }, "PERIOD_LIBRARY_LABEL"],
  ["padded title", value => { value.title = " report "; }, "PERIOD_REPORT_TITLE"],
  ["long title", value => { value.title = "x".repeat(61); }, "PERIOD_LIBRARY_LABEL"],
  ["bidi title", value => { value.title = "report\u202e"; }, "PERIOD_LIBRARY_LABEL"],
  ["invalid time", value => { value.createdAt = "2026-10-24"; }, "PERIOD_LIBRARY_TIME"],
  ["short slots", value => { value.slots.pop(); }, "PERIOD_REPORT_SLOTS"],
  ["reordered slots", value => { value.slots.reverse(); }, "PERIOD_REPORT_SLOTS"],
  ["slot extras", value => { value.slots[0].verified = true; }, "PERIOD_SHAPE"],
  ["wrong entry agent", value => { value.slots[0].entry = value.slots[1].entry; }, "PERIOD_REPORT_AGENT"],
  ["duplicate ids", value => { value.slots[1].entry.id = value.slots[0].entry.id; }, "PERIOD_REPORT_DUPLICATE"],
];
for (const [name, mutate, expected] of invalidInputs) {
  test("report rejects " + name, () => {
    const value = clone(reportInput()); mutate(value);
    assert.throws(() => validatePeriodReportInput(value), code(expected));
  });
}

test("creating a report trims a title without changing saved labels", () => {
  const result = createPeriodReportInput(reportLibrary(), selection(), "  Report  ", LATER);
  assert.equal(result.title, "Report");
  assert.equal(result.slots[0].entry.label, "DAT 期間30–42");
});

test("metadata field order does not change the canonical key", () => {
  const source = reportInput(), reversed = Object.fromEntries(Object.entries(source).reverse());
  assert.equal(periodReportInputKey(source), periodReportInputKey(reversed));
});

test("decorated, sparse and accessor slot arrays are rejected without access", () => {
  for (const modify of [
    value => { value.slots.extra = true; },
    value => { delete value.slots[1]; },
    value => { Object.setPrototypeOf(value.slots, null); },
  ]) {
    const value = clone(reportInput()); modify(value);
    assert.throws(() => validatePeriodReportInput(value));
  }
  let reads = 0;
  const value = clone(reportInput());
  Object.defineProperty(value.slots, "0", { get() { reads++; return null; } });
  assert.throws(() => validatePeriodReportInput(value));
  assert.equal(reads, 0);
});

test("report sources tolerate unrelated additions and revision changes", () => {
  const input = reportInput();
  const fresh = library([...reportLibrary().entries, entry(9)], 100);
  assert.equal(assertReportSourcesUnchanged(input, fresh).revision, 100);
});

for (const [name, modify] of [
  ["rename", value => { value.label = "Renamed"; value.updatedAt = LATER; }],
  ["archive", value => { value.archived = true; }],
  ["restriction", value => { value.requiresNewPlan = true; }],
  ["creation time", value => { value.createdAt = "2026-10-24T00:00:00.000Z"; }],
  ["evidence", value => { value.draft.later.balanceBaseUnits = "1"; }],
]) {
  test("selected source " + name + " invalidates review atomically", () => {
    const input = reportInput(), fresh = clone(reportLibrary()); modify(fresh.entries[1]);
    assert.throws(() => assertReportSourcesUnchanged(input, fresh), code("PERIOD_REPORT_SOURCE_CHANGED"));
    assert.equal(input.slots[1].entry.updatedAt, TIME);
  });
}

test("deleted selected entry invalidates review", () => {
  const input = reportInput();
  assert.throws(() => assertReportSourcesUnchanged(input, library(reportLibrary().entries.slice(1))), code("PERIOD_REPORT_SOURCE_CHANGED"));
});

test("unselected evidence changes do not invalidate the selected snapshot", () => {
  const source = reportLibrary();
  const input = reportInput({ selection: { DAT: id(1), EMA: null, CAWELON: null } });
  const next = clone(source); next.entries[1].label = "Different";
  assert.equal(assertReportSourcesUnchanged(input, next).entries[1].label, "Different");
});

test("partial snapshot preserves every completed prefix without upgrading its status", () => {
  for (let count = 0; count <= 5; count++) {
    const result = reportInput({ counts: [count, count, count] });
    for (const slot of result.slots) {
      assert.equal(slot.entry.draft.records.length, Math.max(0, count - 2));
      assert.equal(Boolean(slot.entry.draft.earlier), count > 0);
      assert.equal(Boolean(slot.entry.draft.later), count > 1);
    }
  }
});

test("report creation is independent of storage revision", () => {
  const first = reportLibrary(), second = { ...first, revision: Number.MAX_SAFE_INTEGER };
  assert.equal(periodReportInputKey(createPeriodReportInput(first, selection(), "Report", LATER)),
    periodReportInputKey(createPeriodReportInput(second, selection(), "Report", LATER)));
});
