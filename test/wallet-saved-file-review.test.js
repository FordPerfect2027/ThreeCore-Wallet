import test from "node:test";
import assert from "node:assert/strict";
import { inspectWalletSavedText, compareWalletSavedInspections, reviewWalletSavedComparison, walletSavedComparisonReviewText } from "../src/file-read-status.js";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { sampleHistory, clone } from "./helpers/report-history-fixtures.js";

async function pair() {
  const history = sampleHistory(), changed = clone(history); changed.entries[0].note = "PRIVATE modified note";
  const before = await inspectWalletSavedText((await prepareReportHistoryFile(history)).text);
  const after = await inspectWalletSavedText((await prepareReportHistoryFile(changed)).text);
  return { before, after, comparison: compareWalletSavedInspections(before, after) };
}
test("comparison review faithfully reproduces a changed original without claiming equal contents", async () => {
  const { before, after, comparison } = await pair();
  const reordered = Object.fromEntries(Object.entries(comparison).reverse());
  const review = await reviewWalletSavedComparison(before, after, JSON.stringify(reordered));
  assert.equal(review.matchesRecomputation, true); assert.equal(review.expectedSameOriginal, false);
  assert.equal(review.beforeBindingMatches, true); assert.equal(review.afterBindingMatches, true);
  assert.equal(review.originalPairValidated, true); assert.match(review.comparisonTextDigest, /^[0-9a-f]{64}$/);
  assert.equal(review.liveChainRechecked, false); assert.equal(review.authorizesExecution, false);
  assert.doesNotMatch(JSON.stringify(review) + walletSavedComparisonReviewText(review), /PRIVATE/);
});
test("comparison review detects changed claims, swapped sources and unexpected fields without echoing them", async () => {
  const { before, after, comparison } = await pair(), altered = clone(comparison);
  altered.sameOriginal = true; altered.authorizesExecution = true; altered.PRIVATE = "attacker text";
  const review = await reviewWalletSavedComparison(before, after, JSON.stringify(altered));
  assert.equal(review.matchesRecomputation, false); assert.deepEqual(review.differences, ["sameOriginal", "authorizesExecution"]);
  assert.equal(review.unexpectedFields, 1); assert.doesNotMatch(JSON.stringify(review) + walletSavedComparisonReviewText(review), /PRIVATE|attacker/);
  const swapped = await reviewWalletSavedComparison(after, before, JSON.stringify(comparison));
  assert.equal(swapped.beforeBindingMatches, false); assert.equal(swapped.afterBindingMatches, false);
  assert.ok(swapped.differences.includes("before") && swapped.differences.includes("after"));
});
test("faithfully repeated auxiliary declarations never acquire verified source bindings", async () => {
  const auxiliary = await inspectWalletSavedText('{"schema":"threecore.saved-file-inspection.v1"}');
  const comparison = compareWalletSavedInspections(auxiliary, auxiliary);
  const review = await reviewWalletSavedComparison(auxiliary, auxiliary, JSON.stringify(comparison));
  assert.equal(review.matchesRecomputation, true); assert.equal(review.originalPairValidated, false);
  assert.equal(review.beforeBindingMatches, null); assert.equal(review.afterBindingMatches, null);
  assert.match(walletSavedComparisonReviewText(review), /未検証/);
});
test("comparison review rejects corrupt framing, oversized data, forged inspections and cancelled work", async () => {
  const { before, after, comparison } = await pair();
  for (const text of ["null", "[]", "{}", '{"schema":"threecore.saved-file-comparison.v1","schema":"threecore.saved-file-comparison.v1"}', " ".repeat(256*1024+1)]) {
    await assert.rejects(reviewWalletSavedComparison(before, after, text), e => /^FILE_COMPARISON_REVIEW_/.test(e.code));
  }
  await assert.rejects(reviewWalletSavedComparison(clone(before), after, JSON.stringify(comparison)), e => e.code === "FILE_INSPECTION_COMPARISON");
  await assert.rejects(reviewWalletSavedComparison(before, after, JSON.stringify(comparison), { signal: AbortSignal.abort() }), e => e.code === "FILE_CANCELLED");
  let accessed = 0; const options = { get signal() { accessed++; return undefined; } };
  await assert.rejects(reviewWalletSavedComparison(before, after, JSON.stringify(comparison), options)); assert.equal(accessed, 0);
});
