import test from "node:test";
import assert from "node:assert/strict";
import { periodReportEntryLibrary } from "../src/period-report-model.js";
import { preparePeriodReportEntryFile, preparePeriodReportFile } from "../src/period-report-file.js";
import { decodePeriodLibraryFile, reviewPeriodLibraryImport } from "../src/period-library-file.js";
import { emptyPeriodLibrary } from "../src/period-library-model.js";
import { createPeriodReportController } from "../src/period-report-controller.js";
import { createPeriodLibraryController } from "../src/period-library-controller.js";
import { reportInput, memoryStorage, fileFrom, clone, deferred, changedSlot } from "./helpers/period-report-fixtures.js";

test("entry extraction preserves every original field and restriction without including the other tokens", async () => {
  const input = reportInput({ counts: [3, 5, 0], changes: { DAT: { archived: true, requiresNewPlan: true } } }), before = JSON.stringify(input);
  for (const slot of input.slots) {
    const file = await preparePeriodReportEntryFile(input, slot.agent), decoded = await decodePeriodLibraryFile(file.text);
    assert.deepEqual(decoded.document.entries, [slot.entry]); assert.equal(decoded.document.revision, 0);
    assert.equal(file.agent, slot.agent); assert.equal(file.entryId, slot.entry.id); assert.equal(file.requiresNewPlan, slot.entry.requiresNewPlan);
    assert.equal(file.liveChainRechecked, false); assert.equal(file.authorizesExecution, false);
    // Another account may legitimately be a counterparty in this token's original events.
    for (const other of input.slots.filter(row => row.agent !== slot.agent)) assert.ok(!decoded.document.entries.some(row => row.id === other.entry.id));
    const current = emptyPeriodLibrary(), review = reviewPeriodLibraryImport(current, decoded.document);
    assert.equal(review.additions, 1); assert.equal(review.blockedAdditions, Number(slot.entry.requiresNewPlan));
    assert.equal(review.archivedAdditions, Number(slot.entry.archived)); assert.equal(current.entries.length, 0);
  }
  assert.equal(JSON.stringify(input), before);
});

test("missing slots and invalid tokens cannot be substituted with another entry", async () => {
  const input = changedSlot(reportInput(), "EMA", (_entry, slot) => { slot.entry = null; });
  assert.throws(() => periodReportEntryLibrary(input, "EMA"), error => error.code === "PERIOD_REPORT_ENTRY_MISSING");
  for (const agent of ["all", "dat", " DAT", null, {}, ["DAT"]]) await assert.rejects(preparePeriodReportEntryFile(input, agent));
  let reads = 0; await assert.rejects(preparePeriodReportEntryFile(input, "DAT", { get signal() { reads++; return null; } })); assert.equal(reads, 0);
  const malformed = clone(input); malformed.slots[2].entry.draft.plan.laterBlock = "1";
  await assert.rejects(preparePeriodReportEntryFile(malformed, "DAT"));
});

test("extracted restricted entry requires the existing import and restore reviews and keeps its restriction", async () => {
  const input = reportInput({ changes: { DAT: { archived: true, requiresNewPlan: true } } });
  const file = await preparePeriodReportEntryFile(input, "DAT"), store = memoryStorage(emptyPeriodLibrary()), deliveries = [];
  const controller = createPeriodLibraryController({ storage: store.storage,
    getCheckpoint: () => assert.fail("must not request a live draft"),
    stageCheckpoint: (draft, options) => { deliveries.push({ draft, options }); return true; } });
  try {
    await controller.refresh(); assert.equal(await controller.importFile(fileFrom(file.text)), true);
    assert.equal(store.document.entries.length, 0); assert.equal(deliveries.length, 0);
    assert.equal(controller.state.review.plan.blockedAdditions, 1); assert.equal(controller.state.review.plan.archivedAdditions, 1);
    assert.equal(await controller.applyReview(), true); assert.deepEqual(store.document.entries, [input.slots[0].entry]);
    assert.equal(deliveries.length, 0); controller.select(input.slots[0].entry.id);
    assert.equal(controller.prepareRestore(), true); assert.equal(deliveries.length, 0);
    assert.equal(await controller.applyReview(), true);
    assert.deepEqual(deliveries, [{ draft: input.slots[0].entry.draft, options: { requiresNewPlan: true } }]);
  } finally { controller.dispose(); }
});

test("source entries and options are captured before digest waits; abort refuses a completed file", async () => {
  const input = clone(reportInput()), original = clone(input.slots[0].entry), started = deferred(), gate = deferred();
  const pending = preparePeriodReportEntryFile(input, "DAT", { subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; input.slots[0].entry.label = "changed after start"; gate.resolve();
  assert.deepEqual((await decodePeriodLibraryFile((await pending).text)).document.entries, [original]);
  const aborter = new AbortController(); aborter.abort();
  await assert.rejects(preparePeriodReportEntryFile(input, "DAT", { signal: aborter.signal }));
});

async function ready(options = {}) {
  const store = memoryStorage(emptyPeriodLibrary()), controller = createPeriodReportController({ storage: store.storage, ...options });
  const input = reportInput({ changes: { DAT: { archived: true, requiresNewPlan: true } } });
  await controller.importFile(fileFrom((await preparePeriodReportFile(input)).text)); await controller.applyReview();
  await controller.importFile(fileFrom((await preparePeriodReportFile(reportInput())).text));
  return { controller, store, input };
}
test("exporting one entry preserves accepted and pending reports and never reads or writes storage", async () => {
  const f = await ready(), c = f.controller, input = c.state.input, review = c.state.review, files = [];
  try {
    assert.equal(await c.exportEntryFile("DAT", false, file => files.push(file)), false);
    assert.equal(await c.exportEntryFile("all", true, file => files.push(file)), false);
    assert.equal(c.state.review, review); assert.equal(files.length, 0);
    assert.equal(await c.exportEntryFile("DAT", true, file => files.push(file)), true);
    assert.equal(c.state.input, input); assert.equal(c.state.review, review); assert.equal(c.state.phase, "review");
    assert.deepEqual((await decodePeriodLibraryFile(files[0].text)).document.entries, [input.slots[0].entry]);
    assert.deepEqual(f.store.calls, []);
    assert.equal(await c.exportEntryFile("DAT", true, () => false), false);
    assert.equal(await c.exportEntryFile("DAT", true, () => Promise.reject(Error("PRIVATE"))), false);
    assert.equal(c.state.error, "PERIOD_REPORT_DELIVERY"); assert.equal(c.state.review, review);
  } finally { c.dispose(); }
});

test("cancel and dispose block late prepared files, delivery, and concurrent exports", async () => {
  for (const action of ["cancel", "dispose"]) {
    const gate = deferred(), captured = [], delivered = [], f = await ready({ prepareEntryFile: (...args) => { captured.push(args); return gate.promise; } });
    const c = f.controller, pending = c.exportEntryFile("EMA", true, file => delivered.push(file));
    assert.equal(c.state.busy, true); assert.equal(await c.exportEntryFile("DAT", true, file => delivered.push(file)), false);
    c[action](); assert.equal(captured[0][2].signal.aborted, true); gate.resolve(await preparePeriodReportEntryFile(f.input, "EMA"));
    assert.equal(await pending, false); assert.equal(delivered.length, 0); c.dispose();
  }
});

test("reentrant cancellation before preparation prevents work and invalid dependencies are refused", async () => {
  let c, prepared = 0;
  const f = await ready({ onChange: state => { if (state.phase === "exporting") c.cancel(); }, prepareEntryFile: () => { prepared++; return {}; } }); c = f.controller;
  try { assert.equal(await c.exportEntryFile("DAT", true, () => assert.fail("delivered")), false); assert.equal(prepared, 0); }
  finally { c.dispose(); }
  assert.throws(() => createPeriodReportController({ storage: memoryStorage(emptyPeriodLibrary()).storage, prepareEntryFile: null }));
});
