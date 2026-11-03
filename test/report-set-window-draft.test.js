import test from "node:test";
import assert from "node:assert/strict";
import { prepareMissingHistoryDraftFile } from "../src/report-set-export.js";
import { decodePeriodFile } from "../src/period-file.js";
import { periodWindows } from "../src/period-plan.js";
import { periodDraftProgress } from "../src/period-draft.js";
import { createPeriodController } from "../src/period-controller.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { sequenceSet, sequenceHistory, historyMemory, clone, deferred, fileFrom } from "./helpers/report-set-fixtures.js";

function partial() { return sequenceSet(sequenceHistory([0n], report => { report.slots[0].entry.draft.records = report.slots[0].entry.draft.records.slice(0, 1); })); }
const query = { groupId: "DAT-1", windowSize: 3 };
test("a selected missing interval becomes one exact, empty, reloadable period draft", async () => {
  const input = partial(), before = JSON.stringify(input);
  const file = await prepareMissingHistoryDraftFile(input, query, "3"), decoded = await decodePeriodFile(file.text);
  assert.deepEqual(periodWindows(decoded.draft.plan), [{ index: 0, fromBlock: "36", toBlock: "36", blocks: "1" }]);
  assert.equal(decoded.draft.plan.earlierBlock, "35"); assert.equal(decoded.draft.plan.context.account, input.entries[0].report.slots[0].entry.draft.plan.context.account);
  assert.equal(decoded.draft.earlier, null); assert.equal(decoded.draft.later, null); assert.deepEqual(decoded.draft.records, []);
  assert.equal(periodDraftProgress(decoded.draft).completed, 0); assert.equal(decoded.checksumVerified, true);
  assert.equal(file.containsOriginalEvidence, false); assert.equal(file.newEmptyDraft, true); assert.equal(file.encrypted, false);
  assert.equal(file.filename, "ThreeCore-unread-period-DAT.json"); assert.equal(JSON.stringify(input), before);
});
test("a contiguous ten-window page becomes one empty twenty-thousand-block draft", async () => {
  const input = sequenceSet(sequenceHistory([0n], report => {
    const draft = report.slots[0].entry.draft; draft.plan.laterBlock = "24030"; draft.plan.windowSize = 2000;
    draft.earlier = null; draft.later = null; draft.records = [];
  }));
  const first = await decodePeriodFile((await prepareMissingHistoryDraftFile(input, { groupId: "DAT-1" }, "page")).text);
  const windows = periodWindows(first.draft.plan);
  assert.equal(windows.length, 10); assert.equal(windows[0].fromBlock, "4031"); assert.equal(windows.at(-1).toBlock, "24030");
  assert.ok(windows.every(row => row.blocks === "2000")); assert.equal(periodDraftProgress(first.draft).completed, 0);
  const second = await decodePeriodFile((await prepareMissingHistoryDraftFile(input, { groupId: "DAT-1", page: "1" }, "page")).text);
  assert.equal(periodWindows(second.draft.plan).length, 2); assert.equal(second.draft.plan.earlierBlock, "30"); assert.equal(second.draft.plan.laterBlock, "4030");
});
test("whole-page draft partitions from the earlier endpoint while preserving the exact missing union", async () => {
  const decoded = await decodePeriodFile((await prepareMissingHistoryDraftFile(partial(), query, "page")).text);
  assert.deepEqual(periodWindows(decoded.draft.plan).map(row => [row.fromBlock, row.toBlock]), [["36", "38"], ["39", "41"], ["42", "42"]]);
  assert.equal(decoded.draft.plan.earlierBlock, "35"); assert.equal(decoded.draft.plan.laterBlock, "42");
});
test("disjoint pages cannot silently create a plan that reads the omitted gap", async () => {
  const input = sequenceSet(sequenceHistory([0n, 24n], report => {
    const draft = report.slots[0].entry.draft; draft.earlier = null; draft.later = null; draft.records = [];
  }));
  await assert.rejects(prepareMissingHistoryDraftFile(input, { groupId: "DAT-1" }, "page"), { code: "PERIOD_SET_QUEUE_DISJOINT" });
  const one = await decodePeriodFile((await prepareMissingHistoryDraftFile(input, { groupId: "DAT-1" }, "1")).text);
  assert.equal(one.draft.plan.earlierBlock, "54"); assert.equal(one.draft.plan.laterBlock, "66");
});
test("existing period import and review do not start a provider read", async () => {
  const file = await prepareMissingHistoryDraftFile(partial(), query, "1"), decoded = await decodePeriodFile(file.text);
  let reads = 0;
  const controller = createPeriodController({ getContext: () => decoded.draft.plan.context, read: async () => { reads++; throw Error("Unexpected read"); } });
  try {
    assert.equal(await controller.importFile(fileFrom(file.text)), true); assert.equal(controller.state.draft, null); assert.equal(reads, 0);
    assert.equal(controller.apply(false), true); assert.equal(reads, 0);
    assert.deepEqual(controller.state.draft, decoded.draft); assert.equal(controller.state.checkedThisSession, false);
  } finally { controller.dispose(); }
});
test("only a window on the requested proposal page can become a draft", async () => {
  let touched = 0;
  for (const number of ["0", "4", "01", 1, { toString() { touched++; return "1"; } }]) {
    await assert.rejects(prepareMissingHistoryDraftFile(partial(), query, number), { code: "PERIOD_SET_QUEUE_WINDOW" });
  }
  await assert.rejects(prepareMissingHistoryDraftFile(sequenceSet(), query, "1"), { code: "PERIOD_SET_QUEUE_WINDOW" });
  assert.equal(touched, 0);
});
test("empty-draft evidence is captured before delayed hashing and remains detached", async () => {
  const input = clone(partial()), options = { ...query }, started = deferred(), gate = deferred();
  const promise = prepareMissingHistoryDraftFile(input, options, "1", { subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; input.entries[0].report.slots[0].entry.draft.plan.laterBlock = "999"; options.windowSize = 1; gate.resolve();
  const decoded = await decodePeriodFile((await promise).text);
  assert.deepEqual(periodWindows(decoded.draft.plan).map(row => [row.fromBlock, row.toBlock]), [["40", "42"]]);
});
async function ready() {
  const store = historyMemory(), controller = createReportSetController({ storage: store.storage });
  assert.equal(await controller.importFile(fileFrom((await prepareReportSetFile(partial())).text)), true); assert.equal(await controller.applyReview(), true);
  return { store, controller };
}
test("draft delivery requires acknowledgement, handles refusal, and leaves accepted evidence/storage untouched", async () => {
  const { store, controller } = await ready(), files = [], before = controller.state.input, history = JSON.stringify(store.document);
  try {
    assert.equal(await controller.exportMissingDraft(query, "1", false, file => files.push(file)), false);
    assert.equal(await controller.exportMissingDraft(query, "1", true, () => false), false);
    assert.equal(await controller.exportMissingDraft(query, "1", true, () => Promise.reject(Error("PRIVATE"))), false);
    assert.equal(controller.state.error, "PERIOD_ASYNC_DELIVERY");
    assert.equal(await controller.exportMissingDraft(query, "1", true, file => files.push(file)), true);
    assert.equal(files.length, 1); assert.equal(controller.state.input, before); assert.equal(JSON.stringify(store.document), history);
    assert.ok(store.calls.every(row => row[0] === "read")); assert.equal((await decodePeriodFile(files[0].text)).draft.records.length, 0);
  } finally { controller.dispose(); }
});
test("cancelled and disposed draft preparations cannot deliver a late file", async () => {
  const { controller } = await ready(), files = [];
  try {
    const first = controller.exportMissingDraft(query, "1", true, file => files.push(file)); controller.cancel();
    assert.equal(await first, false); assert.equal(files.length, 0);
    const second = controller.exportMissingDraft(query, "1", true, file => files.push(file)); controller.dispose();
    assert.equal(await second, false); assert.equal(files.length, 0);
  } finally { controller.dispose(); }
});
