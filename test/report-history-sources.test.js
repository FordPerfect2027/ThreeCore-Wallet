import test from "node:test";
import assert from "node:assert/strict";
import { inspectReportSources, reportSourcesText } from "../src/report-history-sources.js";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { validatePeriodLibrary } from "../src/period-library-model.js";
import { historyMemory, historyDocument, historyRecord, reportInput, reportLibrary, changedSlot,
  id, LATER, AFTER, clone, deferred, tick, sampleHistory, annotateHistory } from "./helpers/report-history-fixtures.js";

function withEntry(input, agent, transform) {
  const library = clone(input);
  transform(library.entries.find(entry => entry.draft.plan.context.agent === agent), library);
  return validatePeriodLibrary(library);
}
test("source inspection finds all three exact records without changing either document", () => {
  const library = reportLibrary(), report = reportInput({ library });
  const before = JSON.stringify([library, report]);
  const result = inspectReportSources(report, library, AFTER);
  assert.equal(result.matched, 3); assert.equal(result.warnings, 0);
  assert.deepEqual(result.slots.map(slot => slot.status), ["exact", "exact", "exact"]);
  assert.equal(result.historicalReportUnchanged, true); assert.equal(result.liveChainRechecked, false);
  assert.equal(JSON.stringify([library, report]), before);
});
test("source labels and archive changes are separated from evidence changes", () => {
  const original = reportLibrary(), changed = withEntry(original, "DAT", entry => {
    entry.label = "renamed"; entry.archived = true; entry.updatedAt = AFTER;
  });
  const result = inspectReportSources(reportInput({ library: original }), changed, AFTER);
  assert.equal(result.slots[0].status, "metadata"); assert.equal(result.slots[0].evidenceChange, null);
  assert.equal(result.slots[0].currentArchived, true); assert.equal(result.warnings, 0);
});
test("new quarantine flags warn without rewriting the saved report", () => {
  const original = reportLibrary(), report = reportInput({ library: original });
  const changed = withEntry(original, "EMA", entry => { entry.requiresNewPlan = true; });
  const result = inspectReportSources(report, changed, AFTER);
  assert.equal(result.slots[1].status, "restricted"); assert.equal(result.warnings, 1);
  assert.equal(report.slots[1].entry.requiresNewPlan, false);
});
test("removed quarantine does not certify validity", () => {
  const restricted = reportLibrary({ changes: { EMA: { requiresNewPlan: true } } });
  const result = inspectReportSources(reportInput({ library: restricted }), reportLibrary(), AFTER);
  assert.equal(result.slots[1].status, "restriction-removed"); assert.equal(result.slots[1].warning, true);
  assert.match(reportSourcesText(result), /安全性や正確さを認証しません/);
});
test("shortened or extended evidence is disclosed independently of report analysis", () => {
  const report = reportInput({ counts: [3, 5, 5] });
  const result = inspectReportSources(report, reportLibrary(), AFTER);
  assert.equal(result.slots[0].status, "changed"); assert.equal(result.slots[0].evidenceChange.kind, "extension");
  assert.match(reportSourcesText(result), /取得工程が増えています/);
});
test("unselected token is not falsely reported as a missing source", () => {
  const report = changedSlot(reportInput(), "DAT", (_entry, slot) => { slot.entry = null; });
  const result = inspectReportSources(report, reportLibrary(), AFTER);
  assert.equal(result.slots[0].status, "unselected"); assert.equal(result.slots[0].warning, false);
});
test("missing original IDs remain missing without silently choosing another source", () => {
  const report = reportInput(), library = clone(reportLibrary()); library.entries = [];
  const result = inspectReportSources(report, library, AFTER);
  assert.deepEqual(result.slots.map(row => row.status), ["missing", "missing", "missing"]);
  assert.equal(result.automaticallyReplaced, false);
  assert.match(reportSourcesText(result), /見つかりません/);
});
test("one equivalent copy is offered as a reference without replacing stored IDs", () => {
  const report = reportInput(), changed = withEntry(reportLibrary(), "DAT", entry => { entry.id = id(20); entry.label = "copy"; });
  const result = inspectReportSources(report, changed, AFTER), dat = result.slots[0];
  assert.equal(dat.status, "equivalent-copy"); assert.equal(dat.currentId, null);
  assert.equal(dat.candidates[0].id, id(20)); assert.equal(report.slots[0].entry.id, id(1));
});
test("multiple equivalent copies are ambiguous and never automatically selected", () => {
  const report = reportInput(), changed = clone(reportLibrary());
  const dat = changed.entries.shift();
  changed.entries.push({ ...dat, id: id(20) }, { ...dat, id: id(21), archived: true });
  const result = inspectReportSources(report, changed, AFTER);
  assert.equal(result.slots[0].status, "multiple-copies"); assert.equal(result.slots[0].candidates.length, 2);
});
test("a matching draft with a different quarantine flag is not called equivalent", () => {
  const changed = withEntry(reportLibrary(), "DAT", entry => { entry.id = id(20); entry.requiresNewPlan = true; });
  assert.equal(inspectReportSources(reportInput(), changed, AFTER).slots[0].status, "missing");
});
test("same ID holding another context is changed evidence, not a trusted substitute", () => {
  const report = reportInput(), changed = clone(reportLibrary());
  const datId = changed.entries[0].id;
  changed.entries[0] = { ...changed.entries[1], id: datId };
  const result = inspectReportSources(report, changed, AFTER);
  assert.equal(result.slots[0].status, "changed"); assert.equal(result.slots[0].evidenceChange.kind, "different-plan");
});
test("source report flags and malicious extra fields still pass through strict validators", () => {
  assert.throws(() => inspectReportSources({ ...reportInput(), live: true }, reportLibrary(), AFTER));
  assert.throws(() => inspectReportSources(reportInput(), { ...reportLibrary(), secret: "hidden" }, AFTER));
  assert.throws(() => inspectReportSources(reportInput(), reportLibrary(), "invalid"));
});
test("inspection results are immutable and omit raw event payloads", () => {
  const result = inspectReportSources(reportInput(), reportLibrary(), AFTER);
  assert.ok(Object.isFrozen(result.slots[0].candidates));
  assert.equal(JSON.stringify(result).includes("amountBaseUnits"), false);
  assert.equal(reportSourcesText(null), "");
});

function controllerFixture(options = {}) {
  const store = historyMemory(historyDocument([historyRecord()])); let reads = 0;
  const controller = createReportHistoryController({ storage: store.storage, getReport: () => null, stageReport: () => true,
    readSources: async () => { reads++; return reportLibrary(); }, now: () => AFTER, ...options });
  return { store, controller, get reads() { return reads; },
    async select() { await controller.refresh(); controller.select(id(101)); },
    dispose() { controller.dispose(); } };
}
test("source inspection is explicit and uses no writes", async () => {
  const f = controllerFixture(); await f.select(); assert.equal(f.reads, 0);
  assert.equal(await f.controller.inspectSources(), true); assert.equal(f.reads, 1);
  assert.equal(f.controller.state.sourceInspection.matched, 3);
  assert.equal(f.store.calls.filter(row => row[0] === "change").length, 0); f.dispose();
});
test("changing history selection clears previously inspected source status", async () => {
  const f = controllerFixture(); await f.select(); await f.controller.inspectSources();
  f.controller.select(null); assert.equal(f.controller.state.sourceInspection, null); f.dispose();
});
test("source read failure preserves saved historical evidence", async () => {
  const f = controllerFixture({ readSources: async () => { throw Error("device problem"); } });
  await f.select(); assert.equal(await f.controller.inspectSources(), false);
  assert.equal(f.controller.state.sourceInspection, null); assert.equal(f.store.document.entries.length, 1); f.dispose();
});
test("source inspection is unavailable when no adapter was supplied", async () => {
  const f = controllerFixture({ readSources: null }); await f.select();
  assert.equal(f.controller.state.canInspectSources, false);
  assert.equal(await f.controller.inspectSources(), false);
  assert.equal(f.controller.state.error, "PERIOD_HISTORY_SOURCES_UNAVAILABLE"); f.dispose();
});
test("cancelled source inspection never displays a late result", async () => {
  const gate = deferred(), f = controllerFixture({ readSources: () => gate.promise }); await f.select();
  const pending = f.controller.inspectSources(); await tick(); f.controller.cancel(); gate.resolve(reportLibrary());
  assert.equal(await pending, false); assert.equal(f.controller.state.sourceInspection, null); f.dispose();
});
test("changed selected report is detected before inspecting its source library", async () => {
  const f = controllerFixture(); await f.select(); f.store.external(annotateHistory());
  assert.equal(await f.controller.inspectSources(), false); assert.equal(f.reads, 0);
  assert.equal(f.controller.state.error, "PERIOD_HISTORY_STALE"); f.dispose();
});
