import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareWalletSavedBundle, reviewWalletSavedBundle, walletSavedBundleSourceFile, walletSavedBundleReviewText, WALLET_SAVED_BUNDLE_SOURCE_LIMIT } from "../src/file-read-status.js";
import { prepareReportHistoryFile, decodeReportHistoryFile } from "../src/report-history-file.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { sampleHistory, clone } from "./helpers/report-history-fixtures.js";
const hash = text => createHash("sha256").update(text).digest("hex");
async function originals() {
  const history = sampleHistory(), changed = clone(history); changed.entries[0].note = "PRIVATE 日本語の記録 🐦";
  return [(await prepareReportHistoryFile(history)).text, JSON.stringify(JSON.parse((await prepareReportHistoryFile(changed)).text),null,2)+"\r\n"];
}
test("bundle preserves exact source text, notes and restrictions through a complete checked round trip", async () => {
  const [before, after] = await originals(), file = await prepareWalletSavedBundle(before, after), review = await reviewWalletSavedBundle(file.text);
  assert.equal(file.containsOriginalEvidence, true); assert.equal(file.encrypted, false); assert.equal(file.sourceTextPreserved, true);
  assert.equal(review.comparison.kind, "changed-original"); assert.equal(review.originalsAvailable, true);
  assert.equal(review.bundleTextDigest, hash(file.text)); assert.equal(review.before.textDigest, hash(before)); assert.equal(review.after.textDigest, hash(after));
  for (const [role, text] of [["before",before],["after",after]]) {
    const extracted = walletSavedBundleSourceFile(review, role); assert.equal(extracted.text, text);
    assert.deepEqual((await decodeReportHistoryFile(extracted.text)).document, (await decodeReportHistoryFile(text)).document);
    assert.equal(extracted.automaticallyImported, false); assert.equal(extracted.authorizesExecution, false);
  }
  assert.doesNotMatch(JSON.stringify(review)+walletSavedBundleReviewText(review), /PRIVATE|日本語の記録/);
  assert.equal(review.restorable, false); assert.equal(review.liveChainRechecked, false);
});
test("different supported original formats can be preserved without claiming equal evidence", async () => {
  const history = sampleHistory(), before = (await prepareReportHistoryFile(history)).text, after = (await preparePeriodReportFile(history.entries[0].report)).text;
  const review = await reviewWalletSavedBundle((await prepareWalletSavedBundle(before, after)).text);
  assert.equal(review.originalsAvailable, true); assert.equal(review.comparison.kind, "different-format"); assert.equal(review.comparison.sameOriginal, null);
  assert.equal(walletSavedBundleSourceFile(review,"after").text,after);
});
test("a valid source substituted into a bundle breaks the saved comparison binding and prevents extraction", async () => {
  const [before,after] = await originals(), bundle = JSON.parse((await prepareWalletSavedBundle(before,before)).text);
  bundle.afterFileText = after; const review = await reviewWalletSavedBundle(JSON.stringify(bundle));
  assert.equal(review.originalsValidated,true); assert.equal(review.comparisonMatchesRecomputation,false); assert.equal(review.originalsAvailable,false);
  assert.equal(review.comparisonReview.afterBindingMatches,false);
  for (const role of ["before","after"]) assert.throws(()=>walletSavedBundleSourceFile(review,role),e=>e.code==="FILE_BUNDLE_SOURCE");
});
test("forged or deserialized bundle reviews cannot release originals", async () => {
  const [before,after] = await originals(), review = await reviewWalletSavedBundle((await prepareWalletSavedBundle(before,after)).text);
  for (const value of [clone(review),Object.freeze({...review}),null,{}]) assert.throws(()=>walletSavedBundleSourceFile(value,"before"),e=>e.code==="FILE_BUNDLE_SOURCE");
  assert.throws(()=>walletSavedBundleSourceFile(review,"all"));
});
test("bundle checks nested checksums, false authority flags, exact framing and originals-only inputs", async () => {
  const [before,after] = await originals(), good = JSON.parse((await prepareWalletSavedBundle(before,after)).text);
  const corrupt = JSON.parse(before); corrupt.digest = "0".repeat(64);
  await assert.rejects(reviewWalletSavedBundle(JSON.stringify({...good,beforeFileText:JSON.stringify(corrupt)})),e=>e.code==="PERIOD_CHECKSUM");
  for (const patch of [{authenticated:true},{encrypted:true},{authorizesExecution:true},{unknown:true},{schema:"wrong"}]) {
    await assert.rejects(reviewWalletSavedBundle(JSON.stringify({...good,...patch})),e=>e.code==="FILE_BUNDLE_SCHEMA");
  }
  await assert.rejects(prepareWalletSavedBundle(before,'{"schema":"threecore.saved-file-inspection.v1"}'),e=>e.code==="FILE_BUNDLE_ORIGINALS_REQUIRED");
  for (const text of ["{}","null","\ufeff"+JSON.stringify(good)]) await assert.rejects(reviewWalletSavedBundle(text));
});
test("bundle work has explicit combined bounds and honours cancellation without reading option getters", async () => {
  await assert.rejects(prepareWalletSavedBundle(" ".repeat(WALLET_SAVED_BUNDLE_SOURCE_LIMIT),"{}"),e=>e.code==="FILE_BUNDLE_SIZE");
  await assert.rejects(prepareWalletSavedBundle("{}","{}",{signal:AbortSignal.abort()}),e=>e.code==="FILE_CANCELLED");
  await assert.rejects(reviewWalletSavedBundle("{}",{signal:AbortSignal.abort()}),e=>e.code==="FILE_CANCELLED");
  let accessed=0;const options={get subtle(){accessed++;return undefined;}};
  await assert.rejects(prepareWalletSavedBundle("{}","{}",options),e=>e.code==="FILE_BUNDLE_OPTIONS");assert.equal(accessed,0);
});
