import test from "node:test";
import assert from "node:assert/strict";
import { reportSetEventRecheckRange } from "../src/report-set-engine.js";
import { prepareReportSetEventRecheckFile } from "../src/report-set-export.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { decodePeriodFile } from "../src/period-file.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { sequenceSet, sequenceHistory, clone, id, hash, historyMemory, fileFrom, deferred } from "./helpers/report-set-fixtures.js";
import { checkpoint, plan } from "./helpers/period-fixtures.js";
const query = () => ({ beforeId: id(101), afterId: id(102), agent: "DAT" });
const changedPair = () => sequenceSet(sequenceHistory([0n, 0n], (report, index) => { if (index === 1) report.slots[0].entry.draft.records[0].events[0].amountBaseUnits = "1"; }));
test("a selected event difference creates an exact one-block unread draft without copying evidence", async () => {
  const source = changedPair(), file = await prepareReportSetEventRecheckFile(source, query(), "e:1"), decoded = await decodePeriodFile(file.text);
  assert.equal(decoded.draft.plan.earlierBlock, "34"); assert.equal(decoded.draft.plan.laterBlock, "35"); assert.equal(decoded.draft.plan.windowSize, 1);
  assert.equal(decoded.draft.earlier, null); assert.equal(decoded.draft.later, null); assert.equal(decoded.draft.records.length, 0);
  assert.equal(file.newEmptyDraft, true); assert.equal(file.executed, false); assert.equal(file.containsOriginalEvidence, false);
  assert.equal(file.selectedRange.transactionHash, source.entries[0].report.slots[0].entry.draft.records[0].events[0].transactionHash);
  assert.doesNotMatch(file.text, /transactionHash|amountBaseUnits|PRIVATE/);
});
test("moved event observations include both positions and intervening blocks with bounded query windows", async () => {
  const source = sequenceSet(sequenceHistory([0n, 0n], (report, index) => {
    const draft = clone(checkpoint(5, plan({ laterBlock: "6030", windowSize: 2000 })));
    if (index === 1) {
      const moved = draft.records[0].events.shift(); moved.blockNumber = "6030"; moved.blockHash = hash(6030);
      draft.records[2].events.push(moved);
    }
    report.slots[0].entry.draft = draft;
  }));
  const range = reportSetEventRecheckRange(source, query(), "e:1");
  assert.equal(range.fromBlock, "35"); assert.equal(range.toBlock, "6030"); assert.equal(range.blocks, "5996");
  assert.equal(range.windowSize, 2000); assert.equal(range.includesInterveningBlocks, true);
  const decoded = await decodePeriodFile((await prepareReportSetEventRecheckFile(source, query(), "e:1")).text);
  assert.equal(decoded.draft.plan.earlierBlock, "34"); assert.equal(decoded.draft.plan.laterBlock, "6030"); assert.equal(decoded.draft.records.length, 0);
});
test("a common block-hash disagreement can produce a new scope even when both event lists are empty", async () => {
  const source = sequenceSet(sequenceHistory([0n, 0n], (report, index) => {
    const draft = report.slots[0].entry.draft; for (const record of draft.records) record.events = [];
    if (index === 1) {
      for (const endpoint of [draft.earlier, draft.later]) endpoint.blockHash = hash(BigInt(endpoint.blockNumber) + 900n);
      for (const record of draft.records) { record.fromBlockHash = hash(BigInt(record.range.fromBlock) + 900n); record.toBlockHash = hash(BigInt(record.range.toBlock) + 900n); }
    }
  }));
  const range = reportSetEventRecheckRange(source, query(), "b:1"); assert.equal(range.reason, "block-hash-disagreement");
  assert.equal(range.fromBlock, "31"); assert.equal(range.toBlock, "31"); assert.equal(range.transactionHash, null);
  const decoded = await decodePeriodFile((await prepareReportSetEventRecheckFile(source, query(), "b:1")).text);
  assert.equal(decoded.draft.plan.earlierBlock, "30"); assert.equal(decoded.draft.plan.laterBlock, "31");
});
test("malformed or absent discrepancy references cannot silently choose a different range", () => {
  const source = changedPair(); let touched = 0;
  for (const value of [null, {}, { toString() { touched++; return "e:1"; } }, "e:0", "e:01", "e:2", "b:1", "event:1", "e:100000", "e:1\n"])
    assert.throws(() => reportSetEventRecheckRange(source, query(), value), error => error.code === "PERIOD_SET_EVENT_RECHECK_SELECTION");
  assert.equal(touched, 0);
  assert.throws(() => reportSetEventRecheckRange(sequenceSet(sequenceHistory([0n, 0n])), query(), "e:1"), error => error.code === "PERIOD_SET_EVENT_RECHECK_SELECTION");
});
test("draft export pins source and choice before hashing and honours caller cancellation", async () => {
  const source = clone(changedPair()), q = query(), gate = deferred(), started = deferred();
  const pending = prepareReportSetEventRecheckFile(source, q, "e:1", { subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; q.agent = "EMA"; source.entries[0].report.slots[0].entry.draft.records[0].events[0].amountBaseUnits = "1"; gate.resolve();
  const decoded = await decodePeriodFile((await pending).text); assert.equal(decoded.draft.plan.context.agent, "DAT"); assert.equal(decoded.draft.plan.laterBlock, "35");
  const abort = new AbortController(); abort.abort(); await assert.rejects(prepareReportSetEventRecheckFile(changedPair(), query(), "e:1", { signal: abort.signal }));
  let touched = 0; await assert.rejects(prepareReportSetEventRecheckFile(changedPair(), query(), "e:1", { get signal() { touched++; } }), error => error.code === "PERIOD_SET_OPTIONS"); assert.equal(touched, 0);
});
test("controller recheck export requires acknowledgement and retains accepted/pending sources", async () => {
  const store = historyMemory(), c = createReportSetController({ storage: store.storage }), files = [];
  try {
    await c.importFile(fileFrom((await prepareReportSetFile(changedPair())).text)); await c.applyReview();
    await c.importFile(fileFrom((await prepareReportSetFile(sequenceSet())).text)); const input = c.state.input, pending = c.state.review;
    assert.equal(await c.exportEventRecheck(query(), "e:1", false, file => files.push(file)), false);
    assert.equal(await c.exportEventRecheck(query(), "e:1", true, () => false), false);
    assert.equal(await c.exportEventRecheck(query(), "e:1", true, () => Promise.reject(Error("PRIVATE"))), false);
    assert.equal(await c.exportEventRecheck(query(), "e:1", true, file => files.push(file)), true);
    assert.equal(files.length, 1); assert.equal(c.state.input, input); assert.equal(c.state.review, pending); assert.equal(c.state.phase, "review"); assert.equal(store.calls.length, 0);
  } finally { c.dispose(); }
});
test("cancel or disposal at the export announcement suppresses the new-draft delivery", async () => {
  for (const stop of ["cancel", "dispose"]) {
    let c, armed = false, delivered = 0;
    c = createReportSetController({ storage: historyMemory().storage, onChange(state) { if (armed && state.phase === "exporting") c[stop](); } });
    await c.importFile(fileFrom((await prepareReportSetFile(changedPair())).text)); await c.applyReview(); armed = true;
    assert.equal(await c.exportEventRecheck(query(), "e:1", true, () => delivered++), false); assert.equal(delivered, 0); c.dispose();
  }
});
