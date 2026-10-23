import test from "node:test";
import assert from "node:assert/strict";
import { comparePeriodReports, periodReportComparisonText } from "../src/period-report-comparison.js";
import { createPeriodReportController } from "../src/period-report-controller.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { reportInput, changedSlot, forkedInput, AGENTS, ACCOUNTS, checkpoint, plan, context,
  selection, OTHER, ACCOUNT, UNIT, memoryStorage, reportLibrary, fileFrom, LATER, clone, hash } from "./helpers/period-report-fixtures.js";

test("identical snapshots have no changed tokens or attention flag", () => {
  const input = reportInput(), result = comparePeriodReports(input, input);
  assert.equal(result.changedTokens, 0);
  assert.equal(result.needsAttention, false);
  assert.equal(result.titleChanged, false);
  assert.equal(result.timestampChanged, false);
  assert.ok(result.slots.every(row => row.kind === "unchanged"));
  assert.ok(result.slots.every(row => row.laterBalanceChangeBaseUnits === "0"));
  assert.equal(result.automaticMerge, false);
  assert.equal(result.provesProfit, false);
  assert.equal(result.liveChainRechecked, false);
  assert.equal(result.independentlyVerified, false);
});

test("a report title or creation time alone does not imply token evidence changes", () => {
  const before = reportInput(), after = reportInput({ title: "Later review", time: "2026-10-24T04:00:00.000Z" });
  const result = comparePeriodReports(before, after);
  assert.equal(result.titleChanged, true);
  assert.equal(result.timestampChanged, true);
  assert.equal(result.changedTokens, 0);
});

for (const agent of AGENTS) {
  test(agent + " addition and removal are explicit", () => {
    const full = reportInput(), missing = changedSlot(full, agent, (_, slot) => { slot.entry = null; });
    const added = comparePeriodReports(missing, full).slots.find(row => row.agent === agent);
    const removed = comparePeriodReports(full, missing).slots.find(row => row.agent === agent);
    assert.equal(added.kind, "added");
    assert.equal(removed.kind, "removed");
    assert.equal(removed.attention, true);
    assert.equal(added.laterBalanceChangeBaseUnits, null);
    assert.equal(removed.laterBalanceChangeBaseUnits, null);
    assert.equal(comparePeriodReports(missing, missing).slots.find(row => row.agent === agent).kind, "unchanged");
  });
  test(agent + " extending acquisition can reduce a previously unexplained difference", () => {
    const counts = AGENTS.map(value => value === agent ? 3 : 5);
    const result = comparePeriodReports(reportInput({ counts }), reportInput());
    const slot = result.slots.find(row => row.agent === agent);
    assert.equal(slot.kind, "continued");
    assert.equal(slot.beforeSteps, 3); assert.equal(slot.afterSteps, 5);
    assert.equal(slot.beforeStatus, "partial"); assert.equal(slot.afterStatus, "arithmetic-agreement");
    assert.equal(slot.laterBalanceChangeBaseUnits, "0");
    assert.equal(slot.unexplainedChangeBaseUnits, (3n * UNIT).toString());
    assert.equal(slot.eventChanges.added, 1);
    assert.equal(slot.eventChanges.removed, 0);
    assert.equal(slot.eventChanges.unchanged, 1);
  });
  test(agent + " moving back to incomplete acquisition requires attention", () => {
    const counts = AGENTS.map(value => value === agent ? 2 : 5);
    const result = comparePeriodReports(reportInput(), reportInput({ counts }));
    const slot = result.slots.find(row => row.agent === agent);
    assert.equal(slot.kind, "regressed");
    assert.equal(slot.attention, true);
    assert.equal(slot.eventChanges.removed, 2);
    assert.equal(result.needsAttention, true);
  });
}

test("different account suppresses numerical deltas even when balances coincide", () => {
  const after = reportInput({ changes: { DAT: { draft: checkpoint(5, plan({}, context("DAT", 84532, OTHER))) } } });
  const result = comparePeriodReports(reportInput(), after).slots[0];
  assert.equal(result.kind, "different-context");
  assert.equal(result.sameContext, false);
  assert.equal(result.comparableAmounts, false);
  assert.equal(result.laterBalanceChangeBaseUnits, null);
  assert.equal(result.eventChanges, null);
  assert.equal(result.attention, true);
});

test("different chain suppresses every amount comparison", () => {
  const result = comparePeriodReports(reportInput({ chainId: 8453 }), reportInput({ chainId: 84532 }));
  assert.ok(result.slots.every(row => row.kind === "different-context"));
  assert.ok(result.slots.every(row => row.unexplainedChangeBaseUnits === null));
  assert.equal(result.changedTokens, 3);
});

test("different economic period does not imply a return calculation", () => {
  const next = reportInput({ changes: { EMA: { draft: checkpoint(5, plan({ laterBlock: "43" }, context("EMA", 84532, OTHER))) } } });
  const row = comparePeriodReports(reportInput(), next).slots[1];
  assert.equal(row.kind, "different-period");
  assert.equal(row.sameContext, true); assert.equal(row.samePeriod, false);
  assert.equal(row.comparableAmounts, false);
  assert.equal(row.laterBalanceChangeBaseUnits, null);
  assert.deepEqual(row.endpointChanges, []);
});

test("same endpoints with different windows is a recollection rather than silent extension", () => {
  const next = reportInput({ changes: { DAT: { draft: checkpoint(3, plan({ windowSize: 12 }, context("DAT", 84532, ACCOUNT))) } } });
  const row = comparePeriodReports(reportInput(), next).slots[0];
  assert.equal(row.kind, "recollected");
  assert.equal(row.samePeriod, true);
  assert.equal(row.comparableAmounts, true);
  assert.equal(row.eventChanges.unchanged, 2);
  assert.equal(row.eventChanges.added, 0);
  assert.equal(row.laterBalanceChangeBaseUnits, "0");
  assert.equal(row.attention, true);
});

test("a changed endpoint amount is exact and describes evidence revision only", () => {
  const after = changedSlot(reportInput(), "DAT", entry => { entry.draft.later.balanceBaseUnits = "107000000000000000001"; });
  const result = comparePeriodReports(reportInput(), after), row = result.slots[0];
  assert.equal(row.kind, "changed-evidence");
  assert.equal(row.laterBalanceChangeBaseUnits, "1");
  assert.equal(row.unexplainedChangeBaseUnits, "1");
  assert.equal(row.earlierBalanceChangeBaseUnits, "0");
  assert.deepEqual(row.endpointChanges[1].fields, ["balanceBaseUnits"]);
  assert.equal(result.provesProfit, false);
});

test("missing endpoint amounts remain unknown instead of becoming zero deltas", () => {
  const before = reportInput({ counts: [0, 5, 5] });
  const row = comparePeriodReports(before, reportInput()).slots[0];
  assert.equal(row.kind, "continued");
  assert.equal(row.earlierBalanceChangeBaseUnits, null);
  assert.equal(row.laterBalanceChangeBaseUnits, null);
  assert.equal(row.unexplainedChangeBaseUnits, null);
  assert.deepEqual(row.endpointChanges.map(value => value.kind), ["added", "added"]);
});

test("endpoint provenance changes are retained even when token amounts match", () => {
  const next = changedSlot(reportInput(), "DAT", entry => { entry.draft.later.connectionEpoch = 2; });
  const row = comparePeriodReports(reportInput(), next).slots[0];
  assert.equal(row.kind, "changed-evidence");
  assert.deepEqual(row.endpointChanges[1].fields, ["connectionEpoch"]);
  assert.equal(row.laterBalanceChangeBaseUnits, "0");
});

test("same-event content changes are distinct from added/removed identities", () => {
  const next = changedSlot(reportInput(), "DAT", entry => { entry.draft.records[0].events[0].amountBaseUnits = "10000000000000000001"; });
  const row = comparePeriodReports(reportInput(), next).slots[0];
  assert.deepEqual(row.eventChanges, { added: 0, removed: 0, changed: 1, unchanged: 1,
    before: 2, after: 2, denotesSavedEvidenceOnly: true });
  assert.equal(row.unexplainedChangeBaseUnits, "-1");
});

test("replaced event identity appears as both added and removed", () => {
  const next = changedSlot(reportInput(), "DAT", entry => { entry.draft.records[0].events[0].transactionHash = hash(9999); });
  const row = comparePeriodReports(reportInput(), next).slots[0];
  assert.equal(row.eventChanges.added, 1);
  assert.equal(row.eventChanges.removed, 1);
  assert.equal(row.eventChanges.changed, 0);
  assert.equal(row.eventChanges.unchanged, 1);
});

test("different block observations suppress deltas despite equal arithmetic", () => {
  const result = comparePeriodReports(reportInput(), forkedInput("DAT"));
  const row = result.slots[0];
  assert.ok(row.anchorChanges.length >= 7);
  assert.equal(row.comparableAmounts, false);
  assert.equal(row.laterBalanceChangeBaseUnits, null);
  assert.equal(row.unexplainedChangeBaseUnits, null);
  assert.equal(row.attention, true);
});

test("hash changes are retained across changed acquisition window sizes", () => {
  const next = reportInput({ changes: { DAT: { draft: checkpoint(3, plan({ windowSize: 12 }, context("DAT", 84532, ACCOUNT))) } } });
  const row = comparePeriodReports(reportInput(), forkedInput("DAT", next)).slots[0];
  assert.equal(row.kind, "recollected");
  assert.ok(row.anchorChanges.some(value => value.number === "30"));
  assert.equal(row.comparableAmounts, false);
});

for (const [name, changes, field] of [
  ["renamed", { label: "Renamed" }, "label"],
  ["new id", { id: "12345678-1234-4234-8234-000000000099" }, "id"],
  ["updated time", { updatedAt: LATER }, "updatedAt"],
]) {
  test("metadata-only " + name + " does not imply new blockchain evidence", () => {
    const next = changedSlot(reportInput(), "DAT", entry => Object.assign(entry, changes));
    const row = comparePeriodReports(reportInput(), next).slots[0];
    assert.equal(row.kind, "metadata-only");
    assert.equal(row.evidenceChanged, false);
    assert.deepEqual(row.metadataChanges, [field]);
    assert.equal(row.laterBalanceChangeBaseUnits, "0");
  });
}

test("quarantine introduction or removal both demand attention and suppress amount comparison", () => {
  const ordinary = reportInput(), blocked = reportInput({ changes: { DAT: { requiresNewPlan: true } } });
  const added = comparePeriodReports(ordinary, blocked).slots[0], removed = comparePeriodReports(blocked, ordinary).slots[0];
  assert.equal(added.kind, "metadata-only");
  assert.equal(added.restrictionChange, "introduced");
  assert.equal(removed.restrictionChange, "removed");
  assert.equal(added.attention, true); assert.equal(removed.attention, true);
  assert.equal(added.comparableAmounts, false); assert.equal(removed.comparableAmounts, false);
  assert.match(periodReportComparisonText(comparePeriodReports(blocked, ordinary)), /妥当性を認証していません/);
});

test("archive transitions do not change evidence but remain visible", () => {
  const ordinary = reportInput(), archived = reportInput({ changes: { EMA: { archived: true } } });
  assert.equal(comparePeriodReports(ordinary, archived).slots[1].archiveChange, "archived");
  assert.equal(comparePeriodReports(archived, ordinary).slots[1].archiveChange, "restored");
  assert.equal(comparePeriodReports(ordinary, archived).slots[1].evidenceChanged, false);
});

test("comparison is deterministic, detached and immutable", () => {
  const before = clone(reportInput()), after = clone(reportInput({ counts: [3, 5, 5] }));
  const beforeText = JSON.stringify(before), afterText = JSON.stringify(after);
  const result = comparePeriodReports(before, after);
  assert.ok(Object.isFrozen(result.slots[0].eventChanges));
  assert.ok(Object.isFrozen(result.slots[0].endpointChanges));
  assert.equal(JSON.stringify(before), beforeText); assert.equal(JSON.stringify(after), afterText);
  assert.deepEqual(result, comparePeriodReports(before, after));
});

test("comparison text discloses saved-evidence limitations and exact change counts", () => {
  const before = reportInput({ counts: [3, 5, 5] }), after = reportInput();
  const text = periodReportComparisonText(comparePeriodReports(before, after));
  assert.match(text, /取得工程が進んでいます/);
  assert.match(text, /追加 1 \/ 除外 0/);
  assert.match(text, /利益や現在の残高変化ではなく/);
  assert.match(text, /自動統合も行いません/);
  assert.equal(periodReportComparisonText(null), "");
});

test("controller import review includes comparison without changing accepted input", async () => {
  const store = memoryStorage(reportLibrary());
  const controller = createPeriodReportController({ storage: store.storage, now: () => LATER });
  await controller.refresh();
  for (const [agent, value] of Object.entries(selection())) controller.select(agent, value);
  controller.prepare("Before"); await controller.applyReview();
  const prior = controller.state.input;
  const next = reportInput({ title: "After", counts: [3, 5, 5] });
  await controller.importFile(fileFrom((await preparePeriodReportFile(next)).text));
  assert.equal(controller.state.input, prior);
  assert.equal(controller.state.review.comparison.slots[0].kind, "regressed");
  assert.equal(controller.state.review.comparison.needsAttention, true);
  await controller.applyReview();
  assert.equal(controller.state.input.title, "After");
  assert.equal(controller.state.review, null);
  assert.deepEqual(store.document, reportLibrary());
  controller.dispose();
});

test("first import has no invented prior report for comparison", async () => {
  const store = memoryStorage(reportLibrary()), controller = createPeriodReportController({ storage: store.storage });
  await controller.importFile(fileFrom((await preparePeriodReportFile(reportInput())).text));
  assert.equal(controller.state.review.comparison, null);
  controller.dispose();
});
