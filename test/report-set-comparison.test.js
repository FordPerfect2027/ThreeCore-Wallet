import test from "node:test";
import assert from "node:assert/strict";
import { compareReportSets } from "../src/report-set-engine.js";
import { setComparisonText } from "../src/report-set-view.js";
import { prepareReportSetComparisonFile } from "../src/report-set-export.js";
import { prepareReportSetFile, decodeReportSetFile } from "../src/report-set-file.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { sequenceSet, sequenceHistory, demoSetHistory, reportInput, forkedInput, historyMemory, clone, id, fileFrom, deferred } from "./helpers/report-set-fixtures.js";

test("set comparison separates added/removed membership and never claims storage deletion", () => {
  const before = sequenceSet(), after = sequenceSet(demoSetHistory(), [id(101), id(102), id(104)]);
  const saved = [JSON.stringify(before), JSON.stringify(after)], result = compareReportSets(before, after);
  assert.deepEqual(result.counts, { added: 1, removed: 1, changed: 0, "metadata-only": 0, unchanged: 2 });
  assert.equal(result.rows.find(row => row.id === id(103)).kind, "removed");
  assert.equal(result.deletesStoredReports, false); assert.equal(result.automaticMerge, false);
  assert.equal(result.liveChainRechecked, false); assert.equal(result.sameContents, false);
  assert.deepEqual([JSON.stringify(before), JSON.stringify(after)], saved);
  assert.match(setComparisonText(result), /PC内の保存履歴を削除しません/);
});
test("identical sources stay equal while title, revision and order changes remain explicit", () => {
  const before = sequenceSet(); assert.equal(compareReportSets(before, clone(before)).sameContents, true);
  const after = clone(before); after.title = "Different set"; after.sourceRevision++;
  after.entries.reverse(); const result = compareReportSets(before, after);
  assert.equal(result.counts.unchanged, 3); assert.equal(result.sameContents, false); assert.equal(result.orderChanged, true);
  assert.deepEqual(result.metadataChanges, ["title", "sourceRevision"]); assert.equal(result.needsAttention, false);
  assert.ok(Object.isFrozen(result.rows[0].tokenChanges));
});
test("metadata-only changes list fields without copying note or tag contents", async () => {
  const before = sequenceSet(), after = clone(before);
  after.entries[0].note = "PRIVATE_NOTE_CONTENT"; after.entries[0].tags = ["private-tag"]; after.entries[0].label = "<img src=x>";
  after.entries[0].report.title = "Different report name";
  const result = compareReportSets(before, after);
  assert.equal(result.counts["metadata-only"], 1); assert.equal(result.counts.changed, 0);
  assert.deepEqual(result.rows[0].metadataChanges, ["label", "note", "tags"]);
  assert.deepEqual(result.rows[0].reportMetadataChanges, ["title"]);
  const file = await prepareReportSetComparisonFile(before, after);
  assert.doesNotMatch(file.text, /PRIVATE_NOTE_CONTENT|private-tag/);
  assert.match(setComparisonText(result), /<img src=x>/);
});
test("removed saved records are evidence regression rather than on-chain transaction removal", () => {
  const before = sequenceSet(), after = clone(before);
  after.entries[0].report.slots[0].entry.draft.records = after.entries[0].report.slots[0].entry.draft.records.slice(0, 1);
  const result = compareReportSets(before, after), row = result.rows[0], dat = row.tokenChanges[0];
  assert.equal(row.kind, "changed"); assert.equal(dat.kind, "regressed"); assert.equal(dat.beforeSteps, 5); assert.equal(dat.afterSteps, 3);
  assert.equal(dat.eventChanges.removed, 1); assert.equal(row.needsAttention, true);
  assert.equal(result.afterSummary.allContinuous, false); assert.match(setComparisonText(result), /保存履歴の差/);
});
test("context changes and altered block observations remain explicit without presenting amount deltas", () => {
  const before = sequenceSet(), context = clone(before);
  context.entries[0].report.slots[0].entry = reportInput({ chainId: 8453 }).slots[0].entry;
  const changed = compareReportSets(before, context).rows[0].tokenChanges[0];
  assert.equal(changed.kind, "different-context"); assert.equal(changed.sameContext, false);
  assert.equal(Object.hasOwn(changed, "laterBalanceChangeBaseUnits"), false);
  const fork = clone(before); fork.entries[0].report = forkedInput("EMA", fork.entries[0].report);
  const result = compareReportSets(before, fork); assert.ok(result.rows[0].tokenChanges[1].changedAnchorCount > 0);
  assert.ok(result.afterSummary.issues.includes("HASH_CONFLICTS"));
});
test("restriction removal is disclosed even when evidence bytes otherwise stay the same", () => {
  const before = clone(sequenceSet()); before.entries[0].report.slots[0].entry.requiresNewPlan = true;
  const after = clone(before); after.entries[0].report.slots[0].entry.requiresNewPlan = false;
  const result = compareReportSets(before, after);
  assert.equal(result.rows[0].kind, "metadata-only"); assert.equal(result.rows[0].needsAttention, true);
  assert.match(setComparisonText(result), /印が外れます/); assert.match(setComparisonText(result), /妥当性を認証したものではありません/);
});
test("comparison receipt binds both canonical payload digests and is not a restorable source", async () => {
  const before = sequenceSet(), after = sequenceSet(demoSetHistory()), file = await prepareReportSetComparisonFile(before, after), data = JSON.parse(file.text);
  assert.equal(data.beforePayloadDigest, (await prepareReportSetFile(before)).digest);
  assert.equal(data.afterPayloadDigest, (await prepareReportSetFile(after)).digest);
  assert.deepEqual(data.comparison, compareReportSets(before, after));
  assert.equal(data.authenticated, false); assert.equal(data.restorable, false); assert.equal(file.containsOriginalEvidence, false);
  await assert.rejects(decodeReportSetFile(file.text));
});
test("both sources are captured before hashing and cancelled hashing cannot produce a receipt", async () => {
  const before = clone(sequenceSet()), after = clone(sequenceSet(demoSetHistory())), expected = compareReportSets(before, after), gate = deferred(), started = deferred();
  const promise = prepareReportSetComparisonFile(before, after, { subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; before.title = "later before"; after.entries[0].label = "later after"; gate.resolve();
  assert.deepEqual(JSON.parse((await promise).text).comparison, expected);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(prepareReportSetComparisonFile(sequenceSet(), sequenceSet(), { signal: abort.signal }));
});
async function ready() {
  const store = historyMemory(sequenceHistory()), controller = createReportSetController({ storage: store.storage });
  await controller.importFile(fileFrom((await prepareReportSetFile(sequenceSet())).text)); await controller.applyReview();
  return { store, controller };
}
test("pending file comparisons save without applying, preserve review, and require acknowledgement", async () => {
  const { store, controller } = await ready(), before = controller.state.input, files = [], saved = JSON.stringify(store.document);
  try {
    assert.equal(await controller.exportReviewComparison(true, file => files.push(file)), false);
    await controller.importFile(fileFrom((await prepareReportSetFile(sequenceSet(demoSetHistory()))).text));
    assert.equal(controller.state.input, before); assert.ok(controller.state.review.comparison);
    assert.equal(await controller.exportReviewComparison(false, file => files.push(file)), false);
    assert.equal(await controller.exportReviewComparison(true, () => false), false);
    assert.equal(await controller.exportReviewComparison(true, file => files.push(file)), true);
    assert.equal(controller.state.phase, "review"); assert.equal(controller.state.input, before); assert.equal(files.length, 1);
    assert.equal(JSON.stringify(store.document), saved); assert.ok(store.calls.every(row => row[0] === "read"));
    assert.equal(await controller.applyReview(), true); assert.equal(controller.state.input.entries.length, 7);
  } finally { controller.dispose(); }
});
test("history selection gets the same comparison and cancelled or asynchronous delivery cannot succeed", async () => {
  const { controller } = await ready(), files = [];
  try {
    await controller.refresh(); controller.select([id(101), id(102)]); controller.prepare("Fewer reports");
    assert.equal(controller.state.review.comparison.counts.removed, 1);
    assert.equal(await controller.exportReviewComparison(true, () => Promise.reject(Error("PRIVATE"))), false);
    assert.equal(controller.state.error, "PERIOD_ASYNC_DELIVERY");
    const pending = controller.exportReviewComparison(true, file => files.push(file)); controller.cancel();
    assert.equal(await pending, false); assert.equal(files.length, 0); assert.equal(controller.state.review, null);
    assert.equal(controller.state.input.entries.length, 3);
  } finally { controller.dispose(); }
});
