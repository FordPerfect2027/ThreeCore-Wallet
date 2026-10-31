import test from "node:test";
import assert from "node:assert/strict";
import { inspectWalletSavedText, compareWalletSavedInspections, walletSavedComparisonText } from "../src/file-read-status.js";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { sampleHistory, clone, historyDocument } from "./helpers/report-history-fixtures.js";

test("saved-file comparison distinguishes identical originals from formatting changes", async () => {
  const source = (await prepareReportHistoryFile(sampleHistory())).text;
  const before = await inspectWalletSavedText(source), identical = compareWalletSavedInspections(before, await inspectWalletSavedText(source));
  assert.equal(identical.kind, "identical"); assert.equal(identical.sameOriginal, true); assert.equal(identical.sameText, true);
  const formatted = JSON.stringify(JSON.parse(source), null, 2) + "\n";
  const difference = compareWalletSavedInspections(before, await inspectWalletSavedText(formatted));
  assert.equal(difference.kind, "format-only"); assert.equal(difference.sameOriginal, true); assert.equal(difference.sameText, false);
  assert.equal(difference.byteDifference, Buffer.byteLength(formatted) - Buffer.byteLength(source)); assert.deepEqual(difference.scopeChanges, []);
  assert.match(walletSavedComparisonText(difference), /書式に違い/);
});
test("changed annotation values still change the original even when every scope count stays the same", async () => {
  const source = sampleHistory(), changed = clone(source); changed.entries[0].note = "PRIVATE changed annotation";
  const before = await inspectWalletSavedText((await prepareReportHistoryFile(source)).text);
  const result = compareWalletSavedInspections(before, await inspectWalletSavedText((await prepareReportHistoryFile(changed)).text));
  assert.equal(result.kind, "changed-original"); assert.equal(result.sameOriginal, false); assert.equal(result.unchangedScopeWithChangedOriginal, true);
  assert.deepEqual(result.scopeChanges, []); assert.doesNotMatch(JSON.stringify(result) + walletSavedComparisonText(result), /PRIVATE|担当メモ/);
  assert.match(walletSavedComparisonText(result), /件数が同じでも/); assert.equal(result.restorable, false); assert.equal(result.liveChainRechecked, false);
});
test("scope differences are exact, bounded and preserve the direction of comparison", async () => {
  const source = sampleHistory(), subset = historyDocument(source.entries.slice(0,2));
  const before = await inspectWalletSavedText((await prepareReportHistoryFile(source)).text), after = await inspectWalletSavedText((await prepareReportHistoryFile(subset)).text);
  const result = compareWalletSavedInspections(before, after), reversed = compareWalletSavedInspections(after, before);
  const count = result.scopeChanges.find(row => row.field === "reportCount"); assert.deepEqual(count, { field: "reportCount", before: 4, after: 2, difference: -2 });
  assert.equal(reversed.scopeChanges.find(row => row.field === "reportCount").difference, 2);
  assert.ok(Object.isFrozen(result.scopeChanges)); assert.ok(Object.isFrozen(count));
});
test("different formats and unverified auxiliary files cannot claim equal or differing original evidence", async () => {
  const original = sampleHistory(), before = await inspectWalletSavedText((await prepareReportHistoryFile(original)).text);
  const report = await inspectWalletSavedText((await preparePeriodReportFile(original.entries[0].report)).text);
  const different = compareWalletSavedInspections(before, report); assert.equal(different.kind, "different-format"); assert.equal(different.sameOriginal, null); assert.deepEqual(different.scopeChanges, []);
  const auxiliary = await inspectWalletSavedText(JSON.stringify({ schema: "threecore.saved-file-comparison.v1", sameOriginal: true, sourceDigest: before.sourceDigest }));
  const result = compareWalletSavedInspections(before, auxiliary); assert.equal(result.kind, "unverified"); assert.equal(result.sameOriginal, null); assert.equal(result.sameText, null);
  assert.match(walletSavedComparisonText(result), /一致を判断していません/);
});
test("a saved or forged inspection receipt cannot substitute for newly inspected originals", async () => {
  const result = await inspectWalletSavedText((await prepareReportHistoryFile(sampleHistory())).text);
  for (const fake of [JSON.parse(JSON.stringify(result)), Object.freeze({ ...result }), null, {}]) assert.throws(() => compareWalletSavedInspections(result, fake), error => error.code === "FILE_INSPECTION_COMPARISON");
  let calls = 0; const hostile = new Proxy({}, { get() { calls++; throw Error("PRIVATE"); } });
  assert.throws(() => compareWalletSavedInspections(hostile, result)); assert.equal(calls, 0);
});
