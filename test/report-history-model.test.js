import test from "node:test";
import assert from "node:assert/strict";
import { emptyReportHistory, validateReportHistory, validateHistoryEntry, historyNote, historyTags,
  historyEntry, mutateReportHistory, planHistoryMerge, REPORT_HISTORY_LIMIT } from "../src/report-history-model.js";
import { historyRecord, historyDocument, saveHistory, annotateHistory, clone, id, TIME, LATER, code,
  reportInput, sampleHistory, forkedInput } from "./helpers/report-history-fixtures.js";

test("history preserves original evidence independently of annotation editing", () => {
  const initial = historyDocument([historyRecord()]), before = JSON.stringify(initial);
  const result = mutateReportHistory(initial, 0, annotateHistory());
  assert.equal(result.entries[0].label, "変更後");
  assert.equal(result.entries[0].note, "メモ");
  assert.deepEqual(result.entries[0].report, initial.entries[0].report);
  assert.equal(result.entries[0].savedAt, TIME);
  assert.equal(result.entries[0].updatedAt, LATER);
  assert.equal(JSON.stringify(initial), before);
  assert.equal(result.revision, 1);
});

test("archive and restore retain all report evidence and metadata", () => {
  const initial = historyDocument([historyRecord()]);
  const archived = mutateReportHistory(initial, 0, { kind: "archive", id: id(101), archived: true, time: LATER });
  const restored = mutateReportHistory(archived, 1, { kind: "archive", id: id(101), archived: false, time: LATER });
  assert.equal(archived.entries[0].archived, true);
  assert.equal(restored.entries[0].archived, false);
  assert.deepEqual(restored.entries[0].report, initial.entries[0].report);
  assert.equal(restored.entries[0].note, initial.entries[0].note);
  assert.equal(restored.revision, 2);
});

test("model clones input and freezes nested evidence", () => {
  const input = clone(historyDocument([historyRecord()]));
  const result = validateReportHistory(input);
  input.entries[0].report.title = "changed outside";
  input.entries[0].tags.push("other");
  assert.notEqual(result.entries[0].report.title, input.entries[0].report.title);
  assert.equal(result.entries[0].tags.length, 1);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.entries[0].report.slots[0].entry.draft));
  assert.throws(() => { result.entries[0].note = "replace"; }, TypeError);
});

for (const value of [null, [], "text", 3, { extra: true }]) {
  test("history rejects malformed document shape: " + JSON.stringify(value), () => {
    assert.throws(() => validateReportHistory(value));
  });
}
for (const revision of [-1, 1.5, "0", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test("history rejects invalid revision " + revision, () => {
    assert.throws(() => validateReportHistory({ ...emptyReportHistory(), revision }), code("PERIOD_HISTORY_SCHEMA"));
  });
}
for (const field of ["schema", "revision", "entries"]) {
  test("history rejects missing " + field, () => {
    const input = clone(emptyReportHistory()); delete input[field];
    assert.throws(() => validateReportHistory(input), code("PERIOD_SHAPE"));
  });
}
for (const field of ["id", "label", "note", "tags", "savedAt", "updatedAt", "archived", "report"]) {
  test("history record rejects missing " + field, () => {
    const input = clone(historyRecord()); delete input[field];
    assert.throws(() => validateHistoryEntry(input), code("PERIOD_SHAPE"));
  });
}

test("accessors and prototype pollution cannot execute during validation", () => {
  let reads = 0;
  const input = clone(historyRecord());
  Object.defineProperty(input, "note", { get() { reads++; return "secret"; }, enumerable: true });
  assert.throws(() => validateHistoryEntry(input), code("PERIOD_SHAPE"));
  const entries = [historyRecord()];
  Object.defineProperty(entries, "0", { get() { reads++; return historyRecord(); } });
  assert.throws(() => validateReportHistory({ ...emptyReportHistory(), entries }));
  assert.equal(reads, 0);
  assert.throws(() => validateReportHistory(Object.assign(Object.create({ inherited: true }), emptyReportHistory())));
});

test("sparse arrays and extra array properties are refused", () => {
  const entries = [historyRecord()]; entries.extra = true;
  assert.throws(() => historyDocument(entries));
  assert.throws(() => historyDocument(Array(1)));
  const tags = ["daily"]; tags.extra = true;
  assert.throws(() => historyTags(tags));
});

for (const value of ["\u0000", "\r", "\u001b", "\u007f", "\u0085", "\u202e", "\u2067", "x".repeat(501), null, 4]) {
  test("memo refuses unsafe or excessive input " + JSON.stringify(value), () => {
    assert.throws(() => historyNote(value), code("PERIOD_HISTORY_NOTE"));
  });
}
test("notes support Japanese, newlines, tabs, and a 500-character boundary", () => {
  assert.equal(historyNote("  保存した報告\n確認\t済み  "), "保存した報告\n確認\t済み");
  assert.equal(historyNote("あ".repeat(500)).length, 500);
  assert.equal(historyNote(""), "");
});
for (const tags of [["UPPER"], ["two words"], ["-start"], ["日本語"], ["a".repeat(25)], ["x", "x"],
  ["a", "b", "c", "d", "e", "f", "g"], [null], "daily"]) {
  test("invalid report tags are refused: " + JSON.stringify(tags), () => assert.throws(() => historyTags(tags)));
}
test("tag normalization is sorted and bounded", () => {
  assert.deepEqual(historyTags(["weekly", "2026", "daily-check"]), ["2026", "daily-check", "weekly"]);
  assert.deepEqual(historyTags([]), []);
  assert.equal(historyTags(["a".repeat(24)])[0].length, 24);
});

for (const changes of [{ note: " untrimmed " }, { label: " untrimmed " }, { tags: ["z", "a"] },
  { archived: 1 }, { updatedAt: "2026-10-23T00:00:00.000Z" }]) {
  test("portable records must already be canonical: " + JSON.stringify(changes), () => {
    assert.throws(() => validateHistoryEntry({ ...historyRecord(), ...changes }), code("PERIOD_HISTORY_ENTRY"));
  });
}

test("saving identical report twice is prevented even with another id or archived original", () => {
  const existing = historyRecord(1, { archived: true }), document = historyDocument([existing]);
  assert.throws(() => mutateReportHistory(document, 0, saveHistory(2, { report: existing.report })), code("PERIOD_HISTORY_DUPLICATE_REPORT"));
  assert.throws(() => historyDocument([existing, historyRecord(2, { report: existing.report })]), code("PERIOD_HISTORY_DUPLICATE_REPORT"));
});
test("duplicate ID with different evidence is refused during saving and validation", () => {
  const initial = historyDocument([historyRecord()]);
  assert.throws(() => mutateReportHistory(initial, 0, saveHistory(1, { report: forkedInput() })), code("PERIOD_HISTORY_DUPLICATE_ID"));
  assert.throws(() => historyDocument([historyRecord(), historyRecord(2, { id: id(101) })]), code("PERIOD_HISTORY_DUPLICATE_ID"));
});
test("report identity includes title and original report timestamp", () => {
  const input = reportInput();
  const initial = historyDocument([historyRecord(1, { report: input })]);
  const next = mutateReportHistory(initial, 0, saveHistory(2, { report: { ...input, title: "別の報告" } }));
  assert.equal(next.entries.length, 2);
});

test("twelve reports fit and the thirteenth cannot displace older evidence", () => {
  const initial = historyDocument(Array.from({ length: REPORT_HISTORY_LIMIT }, (_, i) => historyRecord(i + 1)));
  const before = JSON.stringify(initial);
  assert.throws(() => mutateReportHistory(initial, 0, saveHistory(13)));
  assert.equal(JSON.stringify(initial), before);
  const plan = planHistoryMerge(initial, historyDocument([historyRecord(13)]));
  assert.equal(plan.capacityExceeded, true);
  assert.equal(plan.resultingCount, 13);
});

for (const revision of [-1, 1, null, "0"]) {
  test("stale and incorrectly typed write revisions cannot write: " + revision, () => {
    assert.throws(() => mutateReportHistory(emptyReportHistory(), revision, saveHistory()), code("PERIOD_HISTORY_STALE"));
  });
}
test("revision overflow blocks changes while still allowing a no-op", () => {
  const initial = historyDocument([historyRecord()], Number.MAX_SAFE_INTEGER);
  assert.throws(() => mutateReportHistory(initial, initial.revision, annotateHistory()), code("PERIOD_HISTORY_REVISION_LIMIT"));
  const unchanged = mutateReportHistory(initial, initial.revision, { kind: "archive", id: id(101), archived: false, time: LATER });
  assert.deepEqual(unchanged, initial);
});
test("no-op annotations and duplicate backups do not change update time or revision", () => {
  const initial = historyDocument([historyRecord()], 3), row = initial.entries[0];
  const result = mutateReportHistory(initial, 3, annotateHistory(1, { label: row.label, note: row.note, tags: row.tags }));
  assert.deepEqual(result, initial);
  assert.deepEqual(mutateReportHistory(initial, 3, { kind: "merge", document: initial, skipConflicts: false }), initial);
});
for (const kind of ["purge", "delete", "replace", "update-report", null]) {
  test("destructive or unsupported operation is not available: " + kind, () => {
    assert.throws(() => mutateReportHistory(historyDocument([historyRecord()]), 0, { kind }), code("PERIOD_HISTORY_OPERATION"));
  });
}
test("operation getters are not invoked", () => {
  let reads = 0;
  assert.throws(() => mutateReportHistory(emptyReportHistory(), 0, { get kind() { reads++; return "save"; } }));
  assert.equal(reads, 0);
});
test("operation cannot smuggle extra report or secret fields", () => {
  assert.throws(() => mutateReportHistory(historyDocument([historyRecord()]), 0, { ...annotateHistory(), report: reportInput() }), code("PERIOD_SHAPE"));
  assert.throws(() => validateHistoryEntry({ ...historyRecord(), privateKey: "forbidden" }), code("PERIOD_SHAPE"));
});
test("missing selection and backwards local clock cannot update records", () => {
  const initial = historyDocument([historyRecord()]);
  assert.throws(() => historyEntry(initial, id(300)), code("PERIOD_HISTORY_NOT_FOUND"));
  assert.throws(() => mutateReportHistory(initial, 0, annotateHistory(2)), code("PERIOD_HISTORY_NOT_FOUND"));
  assert.throws(() => mutateReportHistory(initial, 0, annotateHistory(1, { time: "2026-10-23T00:00:00.000Z" })), code("PERIOD_HISTORY_TIME_ORDER"));
});

test("merge is additive, deduplicates exact reports and preserves local notes", () => {
  const local = historyRecord(1, { note: "local annotation", archived: true });
  const incoming = historyRecord(9, { report: local.report, note: "remote annotation" });
  const before = historyDocument([local], 8), backup = historyDocument([incoming, historyRecord(2)], 99);
  const plan = planHistoryMerge(before, backup);
  assert.equal(plan.additions.length, 1);
  assert.deepEqual(plan.duplicates, [{ incomingId: id(109), retainedId: id(101) }]);
  assert.deepEqual(plan.metadataKept, [id(101)]);
  const result = mutateReportHistory(before, 8, { kind: "merge", document: backup, skipConflicts: false });
  assert.deepEqual(result.entries[0], local);
  assert.equal(result.entries.length, 2);
  assert.equal(result.revision, 9);
});
test("same ID with changed evidence blocks the whole merge unless conflicts are explicitly excluded", () => {
  const before = historyDocument([historyRecord()], 1);
  const backup = historyDocument([historyRecord(1, { report: forkedInput() }), historyRecord(2)]);
  const plan = planHistoryMerge(before, backup);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.additions.length, 1);
  assert.throws(() => mutateReportHistory(before, 1, { kind: "merge", document: backup, skipConflicts: false }), code("PERIOD_HISTORY_CONFLICT"));
  const result = mutateReportHistory(before, 1, { kind: "merge", document: backup, skipConflicts: true });
  assert.deepEqual(result.entries[0], before.entries[0]);
  assert.equal(result.entries[1].id, id(102));
});
test("conflicting ID takes precedence over matching report under another ID", () => {
  const before = historyDocument([historyRecord(), historyRecord(2)]);
  const incoming = historyDocument([historyRecord(2, { report: before.entries[0].report })]);
  const plan = planHistoryMerge(before, incoming);
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.duplicates.length, 0);
  assert.equal(plan.additions.length, 0);
});
test("merging archive metadata never hides or unhides an existing record", () => {
  const before = historyDocument([historyRecord()]);
  const incoming = historyDocument([historyRecord(1, { archived: true, updatedAt: LATER })]);
  const result = mutateReportHistory(before, 0, { kind: "merge", document: incoming, skipConflicts: false });
  assert.deepEqual(result, before);
});
test("empty backup is safe and all merge result arrays are immutable", () => {
  const current = sampleHistory(), plan = planHistoryMerge(current, emptyReportHistory());
  assert.equal(plan.resultingCount, 4);
  assert.equal(plan.overwritesExisting, false);
  assert.ok(Object.isFrozen(plan.conflicts));
  assert.deepEqual(mutateReportHistory(current, 4, { kind: "merge", document: emptyReportHistory(), skipConflicts: false }), current);
});
