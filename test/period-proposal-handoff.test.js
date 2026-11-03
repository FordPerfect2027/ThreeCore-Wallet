import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodController } from "../src/period-controller.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { buildMissingHistoryDraft, buildEventRecheckDraft, prepareMissingHistoryDraftFile, prepareReportSetEventRecheckFile } from "../src/report-set-export.js";
import { decodePeriodFile } from "../src/period-file.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { sequenceSet, sequenceHistory, historyMemory, id, fileFrom, deferred } from "./helpers/report-set-fixtures.js";
import { checkpoint, plan, context, clone } from "./helpers/period-fixtures.js";
const query = () => ({ beforeId: id(101), afterId: id(102), agent: "DAT" });
const source = () => sequenceSet(sequenceHistory([0n, 0n], (report, index) => { if (index === 1) report.slots[0].entry.draft.records[0].events[0].amountBaseUnits = "1"; }));
function target(options = {}) {
  let contexts = 0, reads = 0;
  const controller = createPeriodController({ getContext(agent) { contexts++; return context(agent); }, read() { reads++; throw Error("UNEXPECTED_READ"); }, ...options });
  return { controller, get contexts() { return contexts; }, get reads() { return reads; } };
}
test("proposed empty draft stages and applies without looking up a connection or starting a read", async () => {
  const f = target();
  try {
    const proposal = buildEventRecheckDraft(source(), query(), "e:1");
    assert.equal(f.controller.stageProposed(proposal.draft), true); assert.equal(f.controller.state.draft, null);
    assert.equal(f.controller.state.review.source, "proposal"); assert.equal(f.controller.state.review.candidate.records.length, 0);
    assert.equal(f.controller.apply(), true); assert.equal(f.controller.state.origin, "new");
    assert.equal(f.controller.state.draft.plan.earlierBlock, "34"); assert.equal(f.contexts, 0); assert.equal(f.reads, 0);
  } finally { f.controller.dispose(); }
});
test("a proposed plan cannot replace collected evidence without the existing explicit replacement acknowledgement", () => {
  const f = target();
  try {
    f.controller.stageSaved(checkpoint(3), { requiresNewPlan: false }); f.controller.apply(); const before = f.controller.state.draft;
    f.controller.stageProposed(checkpoint(0, plan({ earlierBlock: "34", laterBlock: "35", windowSize: 1 })));
    assert.equal(f.controller.state.review.requiresReplacement, true); assert.equal(f.controller.apply(false), false); assert.equal(f.controller.state.draft, before);
    assert.equal(f.controller.apply(true), true); assert.equal(f.controller.state.draft.records.length, 0); assert.equal(f.reads, 0); assert.equal(f.contexts, 0);
  } finally { f.controller.dispose(); }
});
test("nonempty or invalid proposals preserve an existing review and collected draft", () => {
  const f = target();
  try {
    f.controller.stageSaved(checkpoint(3), { requiresNewPlan: false }); f.controller.apply();
    f.controller.stageProposed(checkpoint(0)); const pending = f.controller.state.review, before = f.controller.state.draft;
    assert.equal(f.controller.stageProposed(checkpoint(1)), false); assert.equal(f.controller.state.error, "PERIOD_PROPOSAL_NOT_EMPTY");
    assert.equal(f.controller.state.review, pending); assert.equal(f.controller.state.draft, before);
    assert.equal(f.controller.stageProposed({}), false); assert.equal(f.controller.state.review, pending); assert.equal(f.controller.state.draft, before);
  } finally { f.controller.dispose(); }
});
test("connection context is checked when explicitly starting an applied offline proposal", async () => {
  let reads = 0;
  const c = createPeriodController({ getContext: () => ({ ...context(), account: "0x" + "9".repeat(40) }), read() { reads++; } });
  try {
    c.stageProposed(checkpoint(0)); c.apply(); assert.equal(await c.start(), false);
    assert.equal(c.state.error, "PERIOD_CONTEXT_MISMATCH"); assert.equal(reads, 0);
  } finally { c.dispose(); }
});
test("busy or disposed destinations refuse handoff without interrupting an in-flight read", async () => {
  const gate = deferred(), f = target({ read: () => gate.promise });
  f.controller.stageProposed(checkpoint(0)); f.controller.apply(); const pending = f.controller.start();
  assert.equal(f.controller.stageProposed(checkpoint(0)), false); assert.equal(f.controller.state.phase, "reading");
  assert.equal(f.controller.state.error, "PERIOD_BUSY"); f.controller.cancel(); gate.resolve(checkpoint(5)); await pending;
  f.controller.dispose(); assert.equal(f.controller.stageProposed(checkpoint(0)), false);
});
test("synchronous draft builders exactly match existing saved-draft formats", async () => {
  const input = source(), recheck = buildEventRecheckDraft(input, query(), "e:1");
  assert.deepEqual(recheck.draft, (await decodePeriodFile((await prepareReportSetEventRecheckFile(input, query(), "e:1")).text)).draft);
  const partial = sequenceSet(sequenceHistory([0n], report => { report.slots[0].entry.draft.records = report.slots[0].entry.draft.records.slice(0, 1); }));
  const q = { groupId: "DAT-1", windowSize: 2, page: "0" }, missing = buildMissingHistoryDraft(partial, q, "page");
  assert.deepEqual(missing.draft, (await decodePeriodFile((await prepareMissingHistoryDraftFile(partial, q, "page")).text)).draft);
  assert.ok(Object.isFrozen(missing.draft)); assert.equal(missing.draft.records.length, 0);
});
test("report controller hands off pinned empty proposals while retaining source and candidate", async () => {
  const store = historyMemory(), c = createReportSetController({ storage: store.storage }), f = target();
  try {
    await c.importFile(fileFrom((await prepareReportSetFile(source())).text)); await c.applyReview();
    await c.importFile(fileFrom((await prepareReportSetFile(sequenceSet())).text)); const before = c.state.input, pending = c.state.review;
    assert.equal(await c.stagePeriodProposal("discrepancy", query(), "e:1", draft => f.controller.stageProposed(draft)), true);
    assert.equal(c.state.input, before); assert.equal(c.state.review, pending); assert.equal(c.state.phase, "review");
    assert.equal(f.controller.state.review.candidate.plan.laterBlock, "35"); assert.equal(f.controller.state.draft, null);
    assert.equal(store.calls.length, 0); assert.equal(f.reads, 0); assert.equal(f.contexts, 0);
    for (const receiver of [null, () => false, () => undefined, () => Promise.reject(Error("PRIVATE")), () => { throw Error("PRIVATE"); }])
      assert.equal(await c.stagePeriodProposal("discrepancy", query(), "e:1", receiver), false);
    assert.equal(c.state.input, before); assert.equal(c.state.review, pending);
  } finally { c.dispose(); f.controller.dispose(); }
});
test("source or destination cancellation during notification does not publish a successful handoff", async () => {
  for (const stop of ["cancel", "dispose"]) {
    let c, armed = false, delivered = 0;
    c = createReportSetController({ storage: historyMemory().storage, onChange(state) { if (armed && state.phase === "exporting") c[stop](); } });
    await c.importFile(fileFrom((await prepareReportSetFile(source())).text)); await c.applyReview(); armed = true;
    assert.equal(await c.stagePeriodProposal("discrepancy", query(), "e:1", () => { delivered++; return true; }), false); assert.equal(delivered, 0); c.dispose();
    let destination;
    destination = createPeriodController({ getContext: () => context(), read() {}, onChange(state) { if (state.review?.source === "proposal") destination[stop](); } });
    assert.equal(destination.stageProposed(checkpoint(0)), false); assert.equal(destination.state.review, null); destination.dispose();
  }
});
