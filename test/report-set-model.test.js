import test from "node:test";
import assert from "node:assert/strict";
import { validateReportSet, createReportSet, validateSetSelection, inspectSetSources,
  assertSetSourcesUnchanged, validateSetExportOptions } from "../src/report-set-model.js";
import { sequenceHistory, sequenceSet, historyRecord, historyDocument, clone, id, AFTER, code } from "./helpers/report-set-fixtures.js";

test("set creation preserves explicit selection order and copies original evidence", () => {
  const history = sequenceHistory();
  const value = createReportSet(history, [id(103), id(101)], "  確認  ", AFTER);
  assert.deepEqual(value.entries.map(row => row.id), [id(103), id(101)]);
  assert.equal(value.title, "確認");
  assert.equal(value.sourceRevision, history.revision);
  assert.deepEqual(value.entries[0], history.entries[2]);
  assert.notEqual(value.entries[0], history.entries[2]);
  assert.ok(Object.isFrozen(value.entries[0].report.slots));
});
test("creating a set never changes the source history", () => {
  const history = clone(sequenceHistory()), before = JSON.stringify(history);
  createReportSet(history, [id(101)], "確認", AFTER);
  assert.equal(JSON.stringify(history), before);
});
test("selection can be empty while editing, but accepted sets cannot", () => {
  assert.deepEqual(validateSetSelection([]), []);
  assert.throws(() => validateSetSelection([], { allowEmpty: false }), code("PERIOD_SET_EMPTY"));
  assert.throws(() => createReportSet(sequenceHistory(), [], "確認", AFTER), code("PERIOD_SET_EMPTY"));
});
for (const ids of [[id(101), id(101)], ["bad"], [null], [1], Array(1), Array.from({ length: 13 }, (_, n) => id(n))]) {
  test("invalid selection is rejected: " + JSON.stringify(ids), () => {
    assert.throws(() => validateSetSelection(ids));
  });
}
test("accessor in a selection is rejected without invocation", () => {
  let calls = 0; const ids = [];
  Object.defineProperty(ids, "0", { get() { calls++; return id(101); }, enumerable: true });
  assert.throws(() => validateSetSelection(ids)); assert.equal(calls, 0);
});
test("source missing from loaded history is never silently omitted", () => {
  assert.throws(() => createReportSet(sequenceHistory(), [id(101), id(111)], "確認", AFTER), code("PERIOD_SET_SOURCE_MISSING"));
});
for (const [field, value] of [["schema", "unknown"], ["historicalOnly", false], ["sourceRevision", -1],
  ["sourceRevision", 1.5], ["sourceRevision", Number.MAX_SAFE_INTEGER + 1], ["title", " leading"],
  ["title", ""], ["title", "x".repeat(61)], ["createdAt", "2026-02-30T00:00:00.000Z"], ["createdAt", AFTER.replace("Z", "+00:00")]]) {
  test("set field validation rejects " + field + ": " + value, () => {
    assert.throws(() => validateReportSet({ ...sequenceSet(), [field]: value }));
  });
}
test("unknown properties and forged conclusions cannot be imported", () => {
  assert.throws(() => validateReportSet({ ...sequenceSet(), allContinuous: true }), code("PERIOD_SHAPE"));
  const value = clone(sequenceSet()); value.entries[0].report.securityAudit = true;
  assert.throws(() => validateReportSet(value), code("PERIOD_SHAPE"));
});
test("accessor on top-level evidence does not execute", () => {
  const value = clone(sequenceSet()); let calls = 0;
  Object.defineProperty(value, "entries", { get() { calls++; return []; } });
  assert.throws(() => validateReportSet(value), code("PERIOD_SHAPE")); assert.equal(calls, 0);
});
test("duplicate IDs and duplicate canonical report inputs remain invalid", () => {
  const value = clone(sequenceSet()); value.entries[1].id = value.entries[0].id;
  assert.throws(() => validateReportSet(value));
  const same = clone(sequenceSet()); same.entries[1].report = same.entries[0].report;
  assert.throws(() => validateReportSet(same));
});
test("archived reports can be explicitly included without reactivating them", () => {
  const history = historyDocument([historyRecord(1, { archived: true })]);
  assert.equal(sequenceSet(history).entries[0].archived, true);
  assert.equal(history.entries[0].archived, true);
});
test("maximum supported selection is twelve reports", () => {
  const history = sequenceHistory(Array.from({ length: 12 }, (_, n) => BigInt(n) * 12n));
  assert.equal(sequenceSet(history).entries.length, 12);
});
test("local revision changes unrelated to selection do not imply stale evidence", () => {
  const history = sequenceHistory(), value = sequenceSet(history, [id(101)]);
  const next = clone(history); next.revision++;
  next.entries[1].note = "別の報告の変更";
  assert.equal(assertSetSourcesUnchanged(value, next).unchanged, true);
});
for (const field of ["label", "note", "tags", "archived"]) {
  test("source metadata change is reported separately: " + field, () => {
    const history = sequenceHistory(), value = sequenceSet(history);
    const next = clone(history);
    next.entries[0][field] = { label: "変更", note: "追記", tags: ["review"], archived: true }[field];
    const inspection = inspectSetSources(value, next);
    assert.equal(inspection.rows[0].status, "metadata");
    assert.equal(inspection.changed, 1);
    assert.throws(() => assertSetSourcesUnchanged(value, next), code("PERIOD_SET_SOURCE_CHANGED"));
    assert.deepEqual(value.entries[0][field], history.entries[0][field]);
  });
}
test("missing and changed reports are detected without replacing captured evidence", () => {
  const history = sequenceHistory(), value = sequenceSet(history);
  const next = clone(history); next.entries.shift(); next.entries[0].report.title = "変更";
  const inspection = inspectSetSources(value, next);
  assert.deepEqual(inspection.rows.map(row => row.status), ["missing", "changed", "exact"]);
  assert.equal(value.entries.length, 3);
});
test("file sourceRevision is informational and cannot authenticate a local database", () => {
  const history = sequenceHistory(), value = { ...sequenceSet(history), sourceRevision: 999 };
  assert.equal(inspectSetSources(value, history).unchanged, true);
  assert.equal(inspectSetSources(value, history).revision, 3);
});
test("summary export options default to no notes and shortened addresses", () => {
  assert.deepEqual(validateSetExportOptions(), { includeNotes: false, shortAddresses: true });
  assert.deepEqual(validateSetExportOptions({ includeNotes: true }), { includeNotes: true, shortAddresses: true });
});
for (const options of [{ includeNotes: "true" }, { shortAddresses: 1 }, { secret: true }, null, []]) {
  test("invalid summary export options reject: " + JSON.stringify(options), () => {
    assert.throws(() => validateSetExportOptions(options));
  });
}
