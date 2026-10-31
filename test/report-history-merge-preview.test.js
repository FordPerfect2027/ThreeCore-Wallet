import test from "node:test";
import assert from "node:assert/strict";
import { planHistoryMerge, mutateReportHistory } from "../src/report-history-model.js";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { historyReviewText } from "../src/report-history-view.js";
import { historyDocument, historyRecord, historyMemory, fileFrom } from "./helpers/report-history-fixtures.js";

test("history merge preview counts the actual next revision bytes", () => {
  const incoming = historyDocument([historyRecord(2)]);
  for (const revision of [9, 99, Number.MAX_SAFE_INTEGER - 1]) {
    const before = historyDocument([historyRecord(1)], revision), plan = planHistoryMerge(before, incoming);
    const after = mutateReportHistory(before, revision, { kind: "merge", document: incoming, skipConflicts: false });
    assert.equal(plan.resultingRevision, after.revision); assert.equal(plan.resultingBytes, new TextEncoder().encode(JSON.stringify(after)).byteLength);
    assert.equal(plan.revisionLimited, false); assert.equal(plan.capacityExceeded, false);
  }
});

test("an exhausted revision blocks new history entries while unchanged duplicates remain valid", () => {
  const before = historyDocument([historyRecord(1)], Number.MAX_SAFE_INTEGER), incoming = historyDocument([historyRecord(2)]), plan = planHistoryMerge(before, incoming);
  assert.equal(plan.revisionLimited, true); assert.equal(plan.resultingBytes, null); assert.equal(plan.resultingRevision, null);
  assert.match(historyReviewText({ kind: "merge", plan, skipConflicts: false }), /更新番号が上限/);
  assert.throws(() => mutateReportHistory(before, before.revision, { kind: "merge", document: incoming, skipConflicts: false }), error => error.code === "PERIOD_HISTORY_REVISION_LIMIT");
  const same = historyDocument([historyRecord(1)]), duplicate = planHistoryMerge(before, same);
  assert.equal(duplicate.revisionLimited, false); assert.equal(duplicate.resultingRevision, before.revision);
  assert.equal(mutateReportHistory(before, before.revision, { kind: "merge", document: same, skipConflicts: false }), before);
});

test("controller refuses an impossible revision before attempting a storage change", async () => {
  const before = historyDocument([historyRecord(1)], Number.MAX_SAFE_INTEGER), store = historyMemory(before);
  const c = createReportHistoryController({ storage: store.storage, getReport: () => null, stageReport: () => assert.fail("no delivery") });
  try {
    await c.refresh(); await c.importFile(fileFrom((await prepareReportHistoryFile(historyDocument([historyRecord(2)]))).text));
    const review = c.state.review; assert.equal(review.plan.revisionLimited, true);
    assert.equal(await c.applyReview(), false); assert.equal(c.state.error, "PERIOD_HISTORY_REVISION_LIMIT");
    assert.equal(c.state.review, review); assert.equal(store.calls.filter(call => call[0] === "change").length, 0); assert.deepEqual(store.document, before);
  } finally { c.dispose(); }
});
