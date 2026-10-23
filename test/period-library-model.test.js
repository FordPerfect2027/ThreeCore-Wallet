import test from "node:test";
import assert from "node:assert/strict";
import {
  PERIOD_LIBRARY_ENTRIES, emptyPeriodLibrary, validatePeriodLibrary,
  validateLibraryEntry, mutatePeriodLibrary, libraryMetadata, libraryEntryStatus,
  compareLibraryDrafts,
} from "../src/period-library-model.js";
import { periodDraftKey } from "../src/period-draft.js";
import {
  id, TIME, LATER, entry, library, saveOperation, sampleLibrary,
  checkpoint, plan, context, clone, code, ACCOUNT, OTHER,
} from "./helpers/period-library-fixtures.js";

test("period library starts empty without an invented observation", () => {
  const value = emptyPeriodLibrary();
  assert.equal(value.schema, "threecore.period-library.v1");
  assert.equal(value.revision, 0);
  assert.deepEqual(value.entries, []);
  assert.ok(Object.isFrozen(value.entries));
  assert.equal(libraryMetadata(value).remaining, 12);
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chain of [8453, 84532]) {
    test("save preserves exact " + agent + " evidence on chain " + chain, () => {
      const source = checkpoint(4, plan({}, context(agent, chain, OTHER)));
      const before = clone(source);
      const result = mutatePeriodLibrary(emptyPeriodLibrary(), 0, saveOperation(1, source));
      assert.equal(result.revision, 1);
      assert.equal(result.entries[0].draft.plan.context.agent, agent);
      assert.equal(result.entries[0].draft.plan.context.chainId, chain);
      assert.equal(result.entries[0].draft.plan.context.account, OTHER);
      assert.equal(periodDraftKey(result.entries[0].draft), periodDraftKey(source));
      assert.deepEqual(source, before);
      assert.ok(Object.isFrozen(result.entries[0].draft));
      assert.equal(libraryEntryStatus(result.entries[0]), "partial");
    });
  }
}

test("a later checkpoint creates a second record without overwriting the earlier one", () => {
  const first = mutatePeriodLibrary(emptyPeriodLibrary(), 0, saveOperation(1, checkpoint(2)));
  const before = JSON.stringify(first);
  const second = mutatePeriodLibrary(first, 1, saveOperation(2, checkpoint(5)));
  assert.equal(first.entries.length, 1);
  assert.equal(JSON.stringify(first), before);
  assert.equal(second.entries.length, 2);
  assert.equal(second.entries[0].draft.records.length, 0);
  assert.equal(second.entries[1].draft.records.length, 3);
  assert.equal(second.revision, 2);
});

test("a duplicate checkpoint cannot silently consume a second library slot", () => {
  const first = mutatePeriodLibrary(emptyPeriodLibrary(), 0, saveOperation());
  assert.throws(() => mutatePeriodLibrary(first, 1, saveOperation(2)), code("PERIOD_LIBRARY_DUPLICATE_DRAFT"));
  const archived = mutatePeriodLibrary(first, 1, { kind: "archive", id: id(1), archived: true, time: LATER });
  assert.throws(() => mutatePeriodLibrary(archived, 2, saveOperation(2)), code("PERIOD_LIBRARY_DUPLICATE_DRAFT"));
  assert.equal(archived.entries.length, 1);
});

test("same evidence with a quarantine marker is separately preservable", () => {
  const first = mutatePeriodLibrary(emptyPeriodLibrary(), 0, saveOperation());
  const marked = mutatePeriodLibrary(first, 1, saveOperation(2, checkpoint(3), { requiresNewPlan: true }));
  assert.equal(marked.entries.length, 2);
  assert.equal(libraryEntryStatus(marked.entries[1]), "blocked");
  assert.equal(libraryEntryStatus(marked.entries[0]), "partial");
});

test("completed quarantined evidence is not presented as resumable", () => {
  const blocked = entry(1, { draft: checkpoint(5), requiresNewPlan: true });
  assert.equal(libraryEntryStatus(blocked), "blocked");
  const row = libraryMetadata(library([blocked])).entries[0];
  assert.equal(row.complete, true);
  assert.equal(row.status, "blocked");
  assert.equal(row.requiresNewPlan, true);
});

test("a quarantine marker without any acquired evidence is rejected", () => {
  assert.throws(() => entry(1, { draft: checkpoint(0), requiresNewPlan: true }), code("PERIOD_LIBRARY_ENTRY"));
});

test("saving normalizes the human-entered name before storage", () => {
  const saved = mutatePeriodLibrary(emptyPeriodLibrary(), 0, saveOperation(1, checkpoint(2), { label: "  DAT 午後  " }));
  assert.equal(saved.entries[0].label, "DAT 午後");
  assert.throws(() => validateLibraryEntry({ ...saved.entries[0], label: " DAT 午後" }), code("PERIOD_LIBRARY_ENTRY"));
});

for (const label of ["", " ", "\t", "x".repeat(61), "a\nb", "a\u202eb", "a\u2066b"]) {
  test("invalid label cannot be persisted: " + JSON.stringify(label), () => {
    assert.throws(() => mutatePeriodLibrary(emptyPeriodLibrary(), 0, saveOperation(1, checkpoint(2), { label })),
      code("PERIOD_LIBRARY_LABEL"));
  });
}

for (const revision of [-1, 0.5, Infinity, NaN, "1", null]) {
  test("invalid storage revision is refused: " + String(revision), () => {
    assert.throws(() => validatePeriodLibrary({ ...emptyPeriodLibrary(), revision }), code("PERIOD_LIBRARY_SCHEMA"));
  });
}

test("old and future writers cannot overwrite the current committed revision", () => {
  const initial = library([entry()], 4);
  for (const revision of [0, 3, 5, "4", null, NaN]) {
    assert.throws(() => mutatePeriodLibrary(initial, revision, saveOperation(2, checkpoint(4))), code("PERIOD_LIBRARY_STALE"));
  }
  assert.equal(initial.entries.length, 1);
  assert.equal(initial.revision, 4);
});

test("revision exhaustion allows a no-op but refuses a new mutation", () => {
  const fullRevision = library([entry()], Number.MAX_SAFE_INTEGER);
  const noOp = mutatePeriodLibrary(fullRevision, fullRevision.revision, {
    kind: "rename", id: id(1), label: entry().label, time: LATER,
  });
  assert.equal(noOp.revision, Number.MAX_SAFE_INTEGER);
  assert.throws(() => mutatePeriodLibrary(fullRevision, fullRevision.revision, {
    kind: "rename", id: id(1), label: "Changed", time: LATER,
  }), code("PERIOD_LIBRARY_REVISION_LIMIT"));
});

for (const kind of ["", "overwrite", "clear", "toString", "constructor", "__proto__", 2, null]) {
  test("unrecognized operation cannot clear saved drafts: " + String(kind), () => {
    assert.throws(() => mutatePeriodLibrary(library([entry()]), 0, { kind }), code("PERIOD_LIBRARY_OPERATION"));
  });
}

test("an operation getter is rejected without evaluating it", () => {
  let invoked = 0;
  const operation = { get kind() { invoked++; return "purge"; } };
  assert.throws(() => mutatePeriodLibrary(emptyPeriodLibrary(), 0, operation), code("PERIOD_LIBRARY_OPERATION"));
  assert.equal(invoked, 0);
});

test("unknown entry and document fields cannot be silently stripped on import", () => {
  assert.throws(() => validateLibraryEntry({ ...entry(), privateKey: "never-accepted" }), code("PERIOD_SHAPE"));
  assert.throws(() => validatePeriodLibrary({ ...emptyPeriodLibrary(), futureSchema: true }), code("PERIOD_SHAPE"));
});

test("an entry getter cannot execute during validation", () => {
  let invoked = 0;
  const value = { ...entry() };
  Object.defineProperty(value, "draft", { enumerable: true, get() { invoked++; return checkpoint(); } });
  assert.throws(() => validateLibraryEntry(value), code("PERIOD_SHAPE"));
  assert.equal(invoked, 0);
});

test("sparse, accessor, decorated and oversized arrays are rejected", () => {
  const sparse = Array(1);
  const accessor = [];
  Object.defineProperty(accessor, 0, { get() { throw Error("must not execute"); } });
  const decorated = [entry()];
  decorated.note = "unexpected";
  const oversized = Array.from({ length: 13 }, (_, index) => entry(index + 1));
  for (const entries of [sparse, accessor, decorated, oversized]) {
    assert.throws(() => validatePeriodLibrary({ ...emptyPeriodLibrary(), entries }));
  }
});

test("duplicate record IDs are rejected even if content happens to match", () => {
  assert.throws(() => library([entry(), entry()]), code("PERIOD_LIBRARY_DUPLICATE_ID"));
});

test("capacity includes archived entries and never evicts an existing draft", () => {
  const rows = Array.from({ length: PERIOD_LIBRARY_ENTRIES }, (_, index) =>
    entry(index + 1, { archived: true, label: "Backup " + index }));
  const before = library(rows, 12);
  assert.throws(() => mutatePeriodLibrary(before, 12, saveOperation(99, checkpoint(5))), code("PERIOD_LIBRARY_CAPACITY"));
  assert.equal(before.entries.length, 12);
  assert.equal(libraryMetadata(before).remaining, 0);
});

test("rename changes only label and update time; acquired observations remain intact", () => {
  const before = library([entry()]);
  const after = mutatePeriodLibrary(before, 0, { kind: "rename", id: id(1), label: "Edited", time: LATER });
  assert.equal(after.entries[0].createdAt, TIME);
  assert.equal(after.entries[0].updatedAt, LATER);
  assert.equal(after.entries[0].label, "Edited");
  assert.equal(periodDraftKey(after.entries[0].draft), periodDraftKey(before.entries[0].draft));
  assert.equal(before.entries[0].label, "控え 1");
});

test("repeating rename and archive is revision-stable", () => {
  const before = library([entry()]);
  const renamed = mutatePeriodLibrary(before, 0, { kind: "rename", id: id(1), label: "控え 1", time: LATER });
  const unarchived = mutatePeriodLibrary(before, 0, { kind: "archive", id: id(1), archived: false, time: LATER });
  assert.deepEqual(renamed, before);
  assert.deepEqual(unarchived, before);
});

test("archive and unarchive preserve quarantine, evidence and creation date", () => {
  const before = library([entry(1, { requiresNewPlan: true })]);
  const hidden = mutatePeriodLibrary(before, 0, { kind: "archive", id: id(1), archived: true, time: LATER });
  const visible = mutatePeriodLibrary(hidden, 1, { kind: "archive", id: id(1), archived: false, time: LATER });
  assert.equal(visible.entries[0].requiresNewPlan, true);
  assert.equal(visible.entries[0].createdAt, TIME);
  assert.equal(periodDraftKey(visible.entries[0].draft), periodDraftKey(before.entries[0].draft));
});

test("clock rollback refuses metadata changes without touching the stored record", () => {
  const before = library([entry(1, { updatedAt: LATER })], 3);
  assert.throws(() => mutatePeriodLibrary(before, 3, { kind: "rename", id: id(1), label: "New", time: TIME }),
    code("PERIOD_LIBRARY_TIME_ORDER"));
  assert.equal(before.entries[0].label, "控え 1");
});

for (const archived of [false, true]) {
  for (const acknowledged of [false, true, "true", 1, undefined]) {
    test("purge requires archived=true and a literal acknowledgement: " + archived + "/" + acknowledged, () => {
      const before = library([entry(1, { archived }), entry(2, { draft: checkpoint(4) })], 7);
      const operation = { kind: "purge", id: id(1), acknowledged };
      if (archived && acknowledged === true) {
        const after = mutatePeriodLibrary(before, 7, operation);
        assert.equal(after.revision, 8);
        assert.deepEqual(after.entries.map(row => row.id), [id(2)]);
      } else {
        assert.throws(() => mutatePeriodLibrary(before, 7, operation), code("PERIOD_LIBRARY_PURGE_ACK"));
        assert.equal(before.entries.length, 2);
      }
    });
  }
}

test("an unknown record cannot be renamed, archived or deleted", () => {
  const before = library([entry()]);
  for (const operation of [
    { kind: "rename", id: id(99), label: "Unknown", time: TIME },
    { kind: "archive", id: id(99), archived: true, time: TIME },
    { kind: "purge", id: id(99), acknowledged: true },
  ]) assert.throws(() => mutatePeriodLibrary(before, 0, operation), code("PERIOD_LIBRARY_NOT_FOUND"));
});

test("import is idempotent for byte-equivalent canonical records", () => {
  const before = sampleLibrary();
  const after = mutatePeriodLibrary(before, 4, { kind: "import", entries: clone(before.entries) });
  assert.deepEqual(after, before);
});

test("import appends missing IDs without replacing current labels or evidence", () => {
  const before = library([entry(1)], 9);
  const incoming = [entry(1), entry(2, { archived: true, requiresNewPlan: true, draft: checkpoint(5) })];
  const result = mutatePeriodLibrary(before, 9, { kind: "import", entries: incoming });
  assert.equal(result.revision, 10);
  assert.deepEqual(result.entries[0], before.entries[0]);
  assert.equal(result.entries[1].archived, true);
  assert.equal(result.entries[1].requiresNewPlan, true);
});

test("a conflicting ID fails the whole import, including otherwise new entries", () => {
  const before = library([entry()], 9);
  const json = JSON.stringify(before);
  assert.throws(() => mutatePeriodLibrary(before, 9, {
    kind: "import", entries: [entry(2), entry(1, { label: "Conflicting name" })],
  }), code("PERIOD_LIBRARY_IMPORT_CONFLICT"));
  assert.equal(JSON.stringify(before), json);
});

test("metadata contains historical scope but omits token and native amounts", () => {
  const metadata = libraryMetadata(sampleLibrary());
  assert.equal(metadata.entries[0].context.account, ACCOUNT);
  assert.equal(metadata.entries[0].earlierBlock, "30");
  assert.equal(metadata.entries[0].laterBlock, "42");
  const text = JSON.stringify(metadata);
  assert.ok(!text.includes("balanceBaseUnits"));
  assert.ok(!text.includes("nativeBalanceBaseUnits"));
  assert.ok(!text.includes("100000000000000000000"));
  assert.equal(metadata.entries[0].completed, 3);
});

test("comparison reports identical, extended and shorter drafts without merging", () => {
  for (const [before, after, kind] of [[3, 3, "identical"], [2, 5, "extension"], [5, 2, "shorter"]]) {
    const comparison = compareLibraryDrafts(checkpoint(before), checkpoint(after));
    assert.equal(comparison.kind, kind);
    assert.equal(comparison.automaticallyMerged, false);
    assert.equal(comparison.independentlyVerified, false);
    assert.equal(comparison.before.completed, before);
    assert.equal(comparison.after.completed, after);
  }
});

test("comparison flags changed acquired evidence instead of calling it progress", () => {
  const left = checkpoint(2), right = clone(checkpoint(4));
  right.earlier.balanceBaseUnits = "200000000000000000000";
  const result = compareLibraryDrafts(left, right);
  assert.equal(result.kind, "changed-evidence");
  assert.deepEqual(result.changedParts, ["earlier"]);
});

for (const selected of [
  plan({}, context("EMA")),
  plan({}, context("DAT", 84532)),
  plan({}, context("DAT", 8453, OTHER)),
  plan({ laterBlock: "41" }),
  plan({ windowSize: 4 }),
]) {
  test("different acquisition scope is never merged: " + JSON.stringify(selected), () => {
    const comparison = compareLibraryDrafts(checkpoint(2), checkpoint(2, selected));
    assert.equal(comparison.kind, "different-plan");
    assert.equal(comparison.automaticallyMerged, false);
  });
}
