import test from "node:test";
import assert from "node:assert/strict";
import { inspectPeriodLibraryImport } from "../src/period-library-model.js";
import { preparePeriodLibraryFile, reviewPeriodLibraryImport } from "../src/period-library-file.js";
import { libraryImportInspectionText } from "../src/period-library-view.js";
import { createPeriodLibraryController } from "../src/period-library-controller.js";
import { entry, library, checkpoint, plan, context, memoryStorage, clone, fileFrom, deferred, LATER, id } from "./helpers/period-library-fixtures.js";

test("add-only inspection separates identical, changed, added and retained original entries", () => {
  const before = library([entry(1), entry(2), entry(3)]), incoming = library([entry(1), entry(2, { label: "SECRET_LABEL" }), entry(4)]);
  const original = JSON.stringify([before, incoming]), result = inspectPeriodLibraryImport(before, incoming);
  assert.deepEqual([result.additions, result.identical, result.conflicts], [1,1,1]);
  assert.deepEqual(result.retainedIds, [id(3)]); assert.equal(result.compatible, false);
  assert.deepEqual(result.rows[1].changedFields, ["label"]); assert.equal(result.rows[1].draftComparison.kind, "identical");
  assert.equal(result.capacity.entriesAfter, 4); assert.equal(result.capacity.fits, true);
  assert.equal(result.capacity.bytesAfter, new TextEncoder().encode(JSON.stringify(library([...before.entries, incoming.entries[2]]))).byteLength);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_LABEL|"account"|transactionHash|amountBaseUnits/);
  assert.equal(JSON.stringify([before,incoming]), original); assert.ok(Object.isFrozen(result.rows[1].changedFields));
  assert.match(libraryImportInspectionText(result), /違い: 保存名/); assert.match(libraryImportInspectionText(result), /そのまま残る既存の控え: 1件/);
  assert.throws(() => reviewPeriodLibraryImport(before, incoming), error => error.code === "PERIOD_LIBRARY_IMPORT_CONFLICT");
});

test("restriction removal and shorter, extended, changed or different-plan records remain explicit conflicts", () => {
  const before = library([entry(1, { requiresNewPlan: true, archived: true, draft: checkpoint(3) })]);
  for (const [kind, draft] of [["shorter", checkpoint(2)], ["extension", checkpoint(5)], ["different-plan", checkpoint(3, plan({}, context("EMA")))],
    ["changed-evidence", { ...checkpoint(3), earlier: { ...checkpoint(3).earlier, balanceBaseUnits: "1" } }]]) {
    const after = library([entry(1, { draft, updatedAt: LATER })]), result = inspectPeriodLibraryImport(before, after), row = result.rows[0];
    assert.equal(row.kind, "conflict"); assert.equal(row.draftComparison.kind, kind); assert.equal(row.removedRestriction, true);
    assert.equal(row.before.archived, true); assert.equal(row.incoming.archived, false); assert.equal(result.compatible, false);
    assert.match(libraryImportInspectionText(result), /再取得の印が外れています/);
  }
});

test("compatible import, empty subset, exact duplicates and capacity match existing import rules", () => {
  const before = library([entry(1), entry(2)], 9);
  for (const incoming of [library(), library([entry(1)]), library([entry(3)])]) {
    const inspection = inspectPeriodLibraryImport(before, incoming), review = reviewPeriodLibraryImport(before, incoming);
    assert.equal(inspection.compatible, true); assert.equal(inspection.additions, review.additions);
    assert.equal(inspection.identical, review.duplicates); assert.equal(inspection.capacity.entriesAfter, review.after.count);
  }
  const full = library(Array.from({ length: 12 }, (_, i) => entry(i + 1))), extra = library([entry(13)]);
  const result = inspectPeriodLibraryImport(full, extra); assert.equal(result.conflicts, 0); assert.equal(result.capacity.entriesAfter, 13);
  assert.equal(result.capacity.fits, false); assert.equal(result.compatible, false); assert.match(libraryImportInspectionText(result), /上限を超えます/);
});

test("malformed originals are rejected and caller mutation cannot change a completed inspection", () => {
  const before = clone(library([entry(1)])), incoming = clone(library([entry(1, { archived: true })]));
  const result = inspectPeriodLibraryImport(before, incoming); incoming.entries[0].archived = false; assert.equal(result.rows[0].incoming.archived, true);
  let calls = 0; Object.defineProperty(before, "entries", { get() { calls++; return []; } });
  assert.throws(() => inspectPeriodLibraryImport(before, incoming)); assert.equal(calls, 0);
});

async function fixture(options = {}) {
  const store = memoryStorage(library([entry(1, { requiresNewPlan: true })]));
  const controller = createPeriodLibraryController({ storage: store.storage, getCheckpoint: () => assert.fail("live source"), stageCheckpoint: () => assert.fail("handoff"), ...options });
  await controller.refresh(); return { store, controller };
}
test("conflicting imports display a completed inspection without creating a write review", async () => {
  const f = await fixture(), c = f.controller, original = c.state.document;
  try {
    assert.equal(await c.importFile(fileFrom((await preparePeriodLibraryFile(library([entry(1)]))).text)), false);
    assert.equal(c.state.error, "PERIOD_LIBRARY_IMPORT_CONFLICT"); assert.equal(c.state.review, null);
    assert.equal(c.state.importInspection.rows[0].removedRestriction, true); assert.equal(c.state.document, original);
    assert.equal(await c.applyReview(), false); assert.equal(f.store.calls.filter(call => call[0] === "change").length, 0);
    assert.equal(await c.importFile(fileFrom((await preparePeriodLibraryFile(library([entry(2)]))).text)), true);
    assert.equal(c.state.importInspection.compatible, true); assert.equal(c.state.review.kind, "import");
    await c.applyReview(); assert.equal(c.state.importInspection, null); assert.equal(c.state.document.entries.length, 2);
  } finally { c.dispose(); }
});

test("failed files, cancel, refresh, dispose and stale writes cannot leave current-looking import inspections", async () => {
  const incoming = fileFrom((await preparePeriodLibraryFile(library([entry(2)]))).text);
  const f = await fixture(), c = f.controller;
  try {
    await c.importFile(incoming); assert.ok(c.state.importInspection);
    await c.importFile(fileFrom("{")); assert.equal(c.state.importInspection, null); assert.equal(c.state.review, null);
    await c.importFile(incoming); c.cancel(); assert.equal(c.state.importInspection, null);
    await c.importFile(incoming); await c.refresh(); assert.equal(c.state.importInspection, null);
    await c.importFile(incoming); f.store.replace(library([entry(1), entry(3)], 10));
    assert.equal(await c.applyReview(), false); assert.equal(c.state.importInspection, null); assert.equal(c.state.loaded, false);
  } finally { c.dispose(); assert.equal(c.state.importInspection, null); }
  for (const action of ["cancel", "dispose"]) {
    const gate = deferred(), f = await fixture({ readFile: () => gate.promise });
    const pending = f.controller.importFile({}); f.controller[action](); gate.resolve({ document: library([entry(2)]) });
    assert.equal(await pending, false); assert.equal(f.controller.state.importInspection, null); f.controller.dispose();
  }
});

test("import inspection uses the actual resulting local revision when computing bytes", () => {
  for (const revision of [9, 99, Number.MAX_SAFE_INTEGER - 1]) {
    const before = library([entry(1)], revision), incoming = library([entry(2)]);
    const inspection = inspectPeriodLibraryImport(before, incoming), actual = reviewPeriodLibraryImport(before, incoming);
    assert.equal(inspection.revisionAvailable, true); assert.equal(inspection.resultingRevision, revision + 1);
    assert.equal(inspection.capacity.bytesAfter, actual.after.bytes); assert.equal(inspection.compatible, true);
  }
});

test("revision exhaustion refuses additions but still admits an identical no-op", () => {
  const before = library([entry(1)], Number.MAX_SAFE_INTEGER), addition = inspectPeriodLibraryImport(before, library([entry(2)]));
  assert.equal(addition.compatible, false); assert.equal(addition.revisionAvailable, false);
  assert.equal(addition.resultingRevision, null); assert.equal(addition.capacity.bytesAfter, null);
  assert.match(libraryImportInspectionText(addition), /更新番号が上限/);
  assert.doesNotMatch(libraryImportInspectionText(addition), /追加可能な構成/);
  const identical = inspectPeriodLibraryImport(before, library([entry(1)]));
  assert.equal(identical.compatible, true); assert.equal(identical.resultingRevision, Number.MAX_SAFE_INTEGER);
  assert.equal(identical.capacity.bytesAfter, reviewPeriodLibraryImport(before, library([entry(1)])).after.bytes);
});

test("a revision-limited stored library cannot display an incoming addition as compatible", async () => {
  const store = memoryStorage(library([entry(1)], Number.MAX_SAFE_INTEGER));
  const controller = createPeriodLibraryController({ storage: store.storage, getCheckpoint: () => assert.fail("live"), stageCheckpoint: () => assert.fail("restore") });
  try {
    await controller.refresh(); const file = await preparePeriodLibraryFile(library([entry(2)]));
    assert.equal(await controller.importFile(fileFrom(file.text)), false); assert.equal(controller.state.error, "PERIOD_LIBRARY_REVISION_LIMIT");
    assert.equal(controller.state.importInspection.compatible, false); assert.equal(controller.state.review, null);
    assert.equal(store.calls.filter(row => row[0] === "change").length, 0);
  } finally { controller.dispose(); }
});
