import test from "node:test";
import assert from "node:assert/strict";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { prepareReportHistoryFile, decodeReportHistoryFile } from "../src/report-history-file.js";
import { decodePeriodReportFile } from "../src/period-report-file.js";
import { historyErrorCode } from "../src/report-history-view.js";
import { historyMemory, historyDocument, historyRecord, saveHistory, annotateHistory, reportInput,
  sampleHistory, id, LATER, clone, deferred, fileFrom, tick, forkedInput } from "./helpers/report-history-fixtures.js";

function fixture({ initial = historyDocument(), hooks = {}, ...options } = {}) {
  const store = historyMemory(initial, hooks), deliveries = [], updates = [];
  let source = reportInput(), counter = 200;
  const controller = createReportHistoryController({ storage: store.storage,
    getReport: () => source, stageReport: input => { deliveries.push(input); return true; },
    now: () => LATER, createId: () => id(counter++), onChange: state => updates.push(state), ...options });
  return { controller, store, deliveries, updates,
    setSource(input) { source = input; },
    async load() { assert.equal(await controller.refresh(), true); },
    prepare() { return controller.prepareSave({ label: "手元の報告", note: "確認済み", tags: ["daily"] }); },
    async save() { await this.load(); assert.equal(this.prepare(), true); assert.equal(await controller.applyReview(), true); },
    dispose() { controller.dispose(); },
  };
}

test("history controller mounts without storage or source reads", () => {
  let sources = 0;
  const f = fixture({ getReport: () => { sources++; return reportInput(); } });
  assert.equal(f.controller.state.loaded, false);
  assert.deepEqual(f.store.calls, []); assert.equal(sources, 0);
  f.dispose();
});
for (const key of ["getReport", "stageReport", "onChange", "now", "createId", "readFile", "prepareFile"]) {
  test("invalid controller dependency " + key + " fails at construction", () => {
    assert.throws(() => fixture({ [key]: null }));
  });
}
test("save is reviewed and does not persist until explicitly applied", async () => {
  const f = fixture(); await f.load();
  assert.equal(f.prepare(), true);
  assert.equal(f.controller.state.review.kind, "save");
  assert.equal(f.store.document.entries.length, 0);
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.store.document.entries.length, 1);
  assert.equal(f.controller.state.selectedId, id(200));
  assert.equal(f.controller.state.review, null);
  assert.equal(f.deliveries.length, 0);
  f.dispose();
});
test("editing form content invalidates an earlier save review", async () => {
  const f = fixture(); await f.load(); f.prepare(); f.controller.invalidateReview();
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "PERIOD_HISTORY_REVIEW");
  assert.equal(f.store.document.entries.length, 0); f.dispose();
});
test("current report changing after review cannot be silently saved", async () => {
  const f = fixture(); await f.load(); f.prepare(); f.setSource(reportInput({ title: "changed" }));
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "PERIOD_HISTORY_SOURCE_CHANGED");
  assert.equal(f.store.document.entries.length, 0); f.dispose();
});
test("source disappearing while native save is pending cancels the commit", async () => {
  const gate = deferred(), f = fixture({ hooks: { beforeChange: () => gate.promise } });
  await f.load(); f.prepare(); const saving = f.controller.applyReview();
  f.setSource(null); gate.resolve(); assert.equal(await saving, false);
  assert.equal(f.store.document.entries.length, 0);
  assert.equal(f.controller.state.loaded, false); f.dispose();
});
test("competing save refuses stale revision without replacing either report", async () => {
  const f = fixture(); await f.load(); f.prepare(); f.store.external(saveHistory(9));
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "PERIOD_HISTORY_STALE");
  assert.equal(f.controller.state.loaded, false);
  assert.equal(f.store.document.entries[0].id, id(109));
  await f.load(); assert.equal(f.controller.state.document.entries.length, 1); f.dispose();
});
test("a repeat save is rejected before creating an applicable preview", async () => {
  const f = fixture(); await f.save();
  assert.equal(f.prepare(), false);
  assert.equal(f.controller.state.error, "PERIOD_HISTORY_DUPLICATE_REPORT");
  assert.equal(f.controller.state.review, null); assert.equal(f.store.document.entries.length, 1); f.dispose();
});
test("save without displayed report has a useful failure and no writes", async () => {
  const f = fixture(); await f.load(); f.setSource(null);
  assert.equal(f.prepare(), false); assert.equal(f.controller.state.error, "PERIOD_HISTORY_NO_SOURCE");
  assert.equal(f.store.calls.filter(row => row[0] === "change").length, 0); f.dispose();
});

test("open review compares current report but does not deliver it before application", async () => {
  const f = fixture({ initial: sampleHistory() }); await f.load(); f.controller.select(id(102));
  assert.equal(f.controller.prepareOpen(), true);
  assert.match(f.controller.state.review.comparisonText, /ハッシュ変更/);
  assert.equal(f.deliveries.length, 0);
  assert.equal(await f.controller.applyReview(), true);
  assert.deepEqual(f.deliveries[0], f.store.document.entries[1].report);
  assert.equal(f.store.calls.filter(row => row[0] === "change").length, 0); f.dispose();
});
test("opening may stage a report when no current report exists", async () => {
  const f = fixture({ initial: sampleHistory() }); f.setSource(null); await f.load();
  f.controller.select(id(104)); assert.equal(f.controller.prepareOpen(), true);
  assert.equal(f.controller.state.review.entry.archived, true);
  assert.equal(await f.controller.applyReview(), true); assert.equal(f.deliveries.length, 1); f.dispose();
});
test("an entry changed in another tab cannot be opened from an old review", async () => {
  const f = fixture({ initial: sampleHistory() }); await f.load(); f.controller.select(id(101)); f.controller.prepareOpen();
  f.store.external(annotateHistory(1, { note: "new note" }));
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "PERIOD_HISTORY_STALE");
  assert.equal(f.deliveries.length, 0); f.dispose();
});
test("unrelated writes do not invalidate the exact reviewed report being opened", async () => {
  const f = fixture({ initial: sampleHistory() }); await f.load(); f.controller.select(id(101)); f.controller.prepareOpen();
  f.store.external(saveHistory(8));
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.controller.state.document.entries.length, 5); f.dispose();
});
test("current report changed during opening is preserved", async () => {
  const gate = deferred(); let block = false;
  const f = fixture({ initial: sampleHistory(), hooks: { beforeRead: () => block ? gate.promise : undefined } });
  await f.load(); f.controller.select(id(101)); f.controller.prepareOpen(); block = true;
  const opening = f.controller.applyReview(); f.setSource(reportInput({ title: "new current" })); gate.resolve();
  assert.equal(await opening, false); assert.equal(f.deliveries.length, 0);
  assert.equal(f.controller.state.error, "PERIOD_HISTORY_SOURCE_CHANGED"); f.dispose();
});
for (const stageReport of [() => false, () => undefined, () => { throw Error("secret"); }, async () => true]) {
  test("failed or asynchronous staging is not reported as a successful open", async () => {
    const f = fixture({ initial: sampleHistory(), stageReport }); await f.load();
    f.controller.select(id(101)); f.controller.prepareOpen();
    assert.equal(await f.controller.applyReview(), false);
    assert.equal(f.store.document.entries.length, 4); f.dispose();
  });
}

test("annotations, archive and restore are scoped to the selected report", async () => {
  const f = fixture({ initial: sampleHistory() }); await f.load(); f.controller.select(id(101));
  const originals = clone(f.store.document);
  assert.equal(await f.controller.annotate({ label: "new label", note: "new note", tags: ["weekly", "daily"] }), true);
  assert.deepEqual(f.store.document.entries[0].tags, ["daily", "weekly"]);
  assert.deepEqual(f.store.document.entries[0].report, originals.entries[0].report);
  assert.equal(await f.controller.archive(true), true);
  assert.equal(f.store.document.entries[0].archived, true);
  assert.equal(await f.controller.archive(false), true);
  assert.deepEqual(f.store.document.entries.slice(1), originals.entries.slice(1)); f.dispose();
});
test("invalid annotation leaves the current evidence and cached revision usable", async () => {
  const f = fixture({ initial: sampleHistory() }); await f.load(); f.controller.select(id(101));
  assert.equal(await f.controller.annotate({ label: "new", note: "x".repeat(501), tags: [] }), false);
  assert.equal(f.controller.state.error, "PERIOD_HISTORY_NOTE");
  assert.equal(f.controller.state.loaded, true); assert.equal(f.store.document.revision, 4); f.dispose();
});
test("storage quota failures invalidate cached writes without claiming success", async () => {
  const f = fixture({ hooks: { beforeChange: () => { throw Object.assign(Error(), { code: "CHECKPOINT_QUOTA" }); } } });
  await f.load(); f.prepare(); assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "CHECKPOINT_QUOTA");
  assert.equal(f.controller.state.loaded, false); assert.equal(f.store.document.entries.length, 0); f.dispose();
});

test("backup import stays additive and waits for reviewed application", async () => {
  const f = fixture({ initial: historyDocument([historyRecord()]) }); await f.load();
  const file = await prepareReportHistoryFile(historyDocument([historyRecord(), historyRecord(2)]));
  assert.equal(await f.controller.importFile(fileFrom(file.text)), true);
  assert.equal(f.store.document.entries.length, 1);
  assert.equal(f.controller.state.review.plan.additions.length, 1);
  assert.equal(f.controller.state.review.plan.duplicates.length, 1);
  assert.equal(await f.controller.applyReview(), true); assert.equal(f.store.document.entries.length, 2); f.dispose();
});
test("conflicts cannot be applied until explicit exclusion is checked", async () => {
  const f = fixture({ initial: historyDocument([historyRecord()]) }); await f.load();
  const file = await prepareReportHistoryFile(historyDocument([historyRecord(1, { report: forkedInput() }), historyRecord(2)]));
  await f.controller.importFile(fileFrom(file.text));
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "PERIOD_HISTORY_CONFLICT");
  assert.equal(f.store.document.entries.length, 1);
  assert.equal(f.controller.setSkipConflicts(true), true);
  assert.equal(await f.controller.applyReview(), true);
  assert.deepEqual(f.store.document.entries[0], historyRecord());
  assert.equal(f.store.document.entries.length, 2); f.dispose();
});
test("conflict-exclusion choice is reset for every newly imported file", async () => {
  const f = fixture(); await f.load();
  const file = await prepareReportHistoryFile(historyDocument([historyRecord()]));
  await f.controller.importFile(fileFrom(file.text)); f.controller.setSkipConflicts(true);
  await f.controller.importFile(fileFrom(file.text));
  assert.equal(f.controller.state.review.skipConflicts, false); f.dispose();
});
test("invalid new import discards the old pending review without touching persisted reports", async () => {
  const f = fixture(); await f.load(); f.prepare();
  assert.equal(await f.controller.importFile(fileFrom("bad json")), false);
  assert.equal(f.controller.state.review, null); assert.equal(f.store.document.entries.length, 0); f.dispose();
});
test("capacity-exceeding backup remains reviewable but cannot save", async () => {
  const f = fixture({ initial: historyDocument(Array.from({ length: 12 }, (_, i) => historyRecord(i + 1))) }); await f.load();
  const file = await prepareReportHistoryFile(historyDocument([historyRecord(20)]));
  assert.equal(await f.controller.importFile(fileFrom(file.text)), true);
  assert.equal(f.controller.state.review.plan.capacityExceeded, true);
  assert.equal(await f.controller.applyReview(), false); assert.equal(f.store.document.entries.length, 12); f.dispose();
});

test("comparing two saved reports never changes the currently displayed report", async () => {
  let sourceReads = 0;
  const f = fixture({ initial: sampleHistory(), getReport: () => { sourceReads++; return reportInput(); } }); await f.load();
  f.controller.select(id(101), true); f.controller.select(id(102));
  assert.equal(f.controller.compare(), true);
  assert.equal(f.controller.state.comparison.changedTokens, 1);
  assert.equal(f.controller.state.comparison.slots.find(slot => slot.agent === "EMA").anchorChanges.length > 0, true);
  assert.equal(f.deliveries.length, 0); assert.equal(sourceReads, 0);
  assert.equal(f.store.calls.filter(row => row[0] === "change").length, 0);
  f.controller.select(id(103)); assert.equal(f.controller.state.comparison, null); f.dispose();
});
test("comparison needs two distinct saved reports", async () => {
  const f = fixture({ initial: sampleHistory() }); await f.load();
  assert.equal(f.controller.compare(), false);
  f.controller.select(id(101)); f.controller.select(id(101), true);
  assert.equal(f.controller.compare(), false); assert.equal(f.controller.state.error, "PERIOD_HISTORY_COMPARE"); f.dispose();
});

for (const format of ["backup", "selected", "csv"]) {
  test("explicit " + format + " export reads fresh data and requires acknowledgment", async () => {
    const f = fixture({ initial: sampleHistory() }), files = []; await f.load(); f.controller.select(id(101));
    assert.equal(await f.controller.exportFile(format, false, file => files.push(file)), false);
    assert.equal(files.length, 0); assert.equal(f.controller.state.error, "PERIOD_HISTORY_ACK");
    assert.equal(await f.controller.exportFile(format, true, file => files.push(file)), true);
    assert.equal(files.length, 1);
    if (format === "backup") assert.equal((await decodeReportHistoryFile(files[0].text)).document.entries.length, 4);
    if (format === "selected") assert.deepEqual((await decodePeriodReportFile(files[0].text)).input, historyRecord().report);
    if (format === "csv") assert.equal(files[0].rows, 3);
    f.dispose();
  });
}
test("whole backup ignores filters and includes reports written after the last refresh", async () => {
  const f = fixture({ initial: sampleHistory() }), files = []; await f.load(); f.store.external(saveHistory(8));
  await f.controller.exportFile("backup", true, file => files.push(file), { search: "does not exist" });
  assert.equal((await decodeReportHistoryFile(files[0].text)).document.entries.length, 5); f.dispose();
});
test("single-report export refuses changed selection metadata instead of exporting an unseen update", async () => {
  const f = fixture({ initial: sampleHistory() }), files = []; await f.load(); f.controller.select(id(101));
  f.store.external(annotateHistory());
  assert.equal(await f.controller.exportFile("selected", true, file => files.push(file)), false);
  assert.equal(files.length, 0); f.dispose();
});
test("download failures and asynchronous initiation do not claim completed delivery", async () => {
  const f = fixture({ initial: sampleHistory() }); await f.load();
  assert.equal(await f.controller.exportFile("backup", true, () => { throw Error("private"); }), false);
  assert.equal(await f.controller.exportFile("backup", true, async () => {}), false);
  assert.equal(f.controller.state.error, "PERIOD_ASYNC_DELIVERY"); f.dispose();
});

test("cancel during write prevents a precommit save", async () => {
  const gate = deferred(), f = fixture({ hooks: { beforeChange: () => gate.promise } });
  await f.load(); f.prepare(); const saving = f.controller.applyReview(); f.controller.cancel(); gate.resolve();
  assert.equal(await saving, false); assert.equal(f.store.document.entries.length, 0);
  assert.equal(f.controller.state.loaded, false); f.dispose();
});
test("cancel after commit but before completion requires reload and never claims rollback", async () => {
  const gate = deferred(), f = fixture({ hooks: { afterChange: () => gate.promise } });
  await f.load(); f.prepare(); const saving = f.controller.applyReview(); await tick();
  assert.equal(f.store.document.entries.length, 1); f.controller.cancel(); gate.resolve(); await saving;
  assert.equal(f.controller.state.loaded, false); assert.match(f.controller.state.message, /再読み込み/);
  await f.load(); assert.equal(f.controller.state.document.entries.length, 1); f.dispose();
});
test("late cancelled import cannot replace a newer review", async () => {
  const gate = deferred(), f = fixture({ readFile: () => gate.promise }); await f.load();
  const importing = f.controller.importFile({}); f.controller.cancel(); f.prepare();
  gate.resolve({ document: sampleHistory() }); assert.equal(await importing, false);
  assert.equal(f.controller.state.review.kind, "save"); f.dispose();
});
test("cancel during checksum preparation prevents a late download", async () => {
  const gate = deferred(), f = fixture({ prepareFile: () => gate.promise }), files = []; await f.load();
  const exporting = f.controller.exportFile("backup", true, file => files.push(file)); await tick();
  f.controller.cancel(); gate.resolve({ text: "should not download" });
  assert.equal(await exporting, false); assert.equal(files.length, 0); f.dispose();
});
test("busy save rejects repeated actions without causing another transaction", async () => {
  const gate = deferred(), f = fixture({ hooks: { beforeChange: () => gate.promise } }); await f.load(); f.prepare();
  const saving = f.controller.applyReview();
  assert.equal(await f.controller.applyReview(), false); assert.equal(f.prepare(), false);
  assert.equal(await f.controller.refresh(), false); assert.equal(f.controller.select(null), false);
  gate.resolve(); assert.equal(await saving, true);
  assert.equal(f.store.calls.filter(row => row[0] === "change").length, 1); f.dispose();
});
test("dispose closes storage and suppresses late callbacks", async () => {
  const gate = deferred(), f = fixture({ hooks: { beforeRead: () => gate.promise } });
  const loading = f.controller.refresh(); f.dispose(); const count = f.updates.length;
  gate.resolve(); assert.equal(await loading, false);
  assert.equal(f.updates.length, count); assert.equal(f.store.closed, true);
  assert.equal(await f.controller.refresh(), false); f.dispose();
});
test("observer errors cannot turn a committed save into a failure", async () => {
  const f = fixture({ onChange: () => { throw Error("render failed"); } }); await f.save();
  assert.equal(f.store.document.entries.length, 1); f.dispose();
});
test("malformed refresh blocks use of previously cached revision", async () => {
  let malformed = false;
  const backing = historyMemory(sampleHistory());
  const f = fixture({ storage: { ...backing.storage, read: async () => malformed ? { schema: "wrong" } : backing.storage.read() } });
  await f.load(); malformed = true;
  assert.equal(await f.controller.refresh(), false);
  assert.equal(f.controller.state.loaded, false); f.dispose();
});
test("error classification hides provider messages and hostile code getters", () => {
  assert.equal(historyErrorCode(Error("wallet address and private details")), "PERIOD_HISTORY_FAILED");
  assert.equal(historyErrorCode({ get code() { throw Error("no"); } }), "PERIOD_HISTORY_FAILED");
  assert.equal(historyErrorCode({ code: "PERIOD_HISTORY_STALE" }), "PERIOD_HISTORY_STALE");
});
