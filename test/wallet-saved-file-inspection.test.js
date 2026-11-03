import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { inspectWalletSavedText, walletSavedInspectionText, walletSavedInspectionErrorText } from "../src/file-read-status.js";
import { preparePeriodFile } from "../src/period-file.js";
import { preparePeriodLibraryFile } from "../src/period-library-file.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { reportSetHistoryDocument } from "../src/report-set-model.js";
import { periodReportEntryLibrary } from "../src/period-report-model.js";
import { sequenceSet, clone, deferred } from "./helpers/report-set-fixtures.js";

async function sources() {
  const set = clone(sequenceSet()); set.entries[0].note = "PRIVATE_NOTE";
  set.entries[0].report.slots[0].entry.requiresNewPlan = true;
  set.entries[0].report.slots[0].entry.archived = true;
  set.entries[0].archived = true;
  const report = set.entries[0].report, library = periodReportEntryLibrary(report, "DAT");
  return [
    ["period", await preparePeriodFile(report.slots[0].entry.draft), 1, null],
    ["library", await preparePeriodLibraryFile(library), 1, 1],
    ["report", await preparePeriodReportFile(report), 3, 1],
    ["history", await prepareReportHistoryFile(reportSetHistoryDocument(set)), 9, 1],
    ["set", await prepareReportSetFile(set), 9, 1],
  ];
}
test("saved-file inspection validates five original formats and provides a safe destination with exact source bindings", async () => {
  for (const [target, file, count, restricted] of await sources()) {
    const result = await inspectWalletSavedText(file.text);
    assert.equal(result.target, target); assert.equal(result.checksumVerified, true); assert.equal(result.sourceDigest, file.digest);
    assert.equal(result.textDigest, createHash("sha256").update(file.text).digest("hex")); assert.equal(result.byteLength, Buffer.byteLength(file.text));
    assert.equal(result.validation, "validated-original"); assert.equal(result.scope.draftReferences, count);
    assert.equal(result.scope.restrictedEntryReferences, restricted); assert.equal(result.automaticallyImported, false);
    assert.equal(result.liveChainRechecked, false); assert.equal(result.authenticated, false); assert.equal(result.restorable, false);
    const text = JSON.stringify(result) + walletSavedInspectionText(result);
    assert.ok(!text.includes("PRIVATE_NOTE")); assert.ok(!text.includes(sequenceSet().entries[0].report.slots[0].entry.draft.plan.context.account));
    assert.match(result.destinationMessage, /この元のファイル/); assert.doesNotMatch(result.destinationMessage, /検証.*行っていません/);
    assert.ok(Object.isFrozen(result.scope.agents));
  }
});
test("recognized auxiliary declarations never inherit claimed validation, hashes, counts or source contents", async () => {
  for (const schema of ["threecore.report-history-import-inspection.v1", "threecore.report-set-history-coverage.v1", "threecore.saved-file-inspection.v1"]) {
    const result = await inspectWalletSavedText(JSON.stringify({ schema, checksumVerified: true, validation: "validated-original", scope: { reportCount: 999 }, privateText: "PRIVATE" }));
    assert.equal(result.validation, "declared-only"); assert.equal(result.checksumVerified, false); assert.equal(result.sourceDigest, null);
    assert.equal(result.textDigest, null); assert.equal(result.scope, null); assert.equal(result.originalEvidenceValidated, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|999/); assert.match(walletSavedInspectionText(result), /検証していません/);
  }
});
test("checksum failures and invalid JSON never produce a valid-looking original inspection", async () => {
  for (const [, file] of await sources()) {
    const value = JSON.parse(file.text); value.digest = "0".repeat(64);
    await assert.rejects(inspectWalletSavedText(JSON.stringify(value)), error => error.code === "PERIOD_CHECKSUM");
  }
  for (const text of ["{", '{"schema":"threecore.period-file.v1","schema":"threecore.report-set-file.v1"}', '{"__proto__":{}}']) await assert.rejects(inspectWalletSavedText(text), error => error.code === "FILE_INSPECTION_JSON");
  for (const text of ["null", "[]", '{"schema":"PRIVATE_UNKNOWN"}']) await assert.rejects(inspectWalletSavedText(text), error => error.code === "FILE_INSPECTION_UNSUPPORTED");
  assert.ok(!walletSavedInspectionErrorText(new Error("PRIVATE path")).includes("PRIVATE"));
  assert.match(walletSavedInspectionErrorText({ code: "PERIOD_CHECKSUM" }), /チェックサムが一致しません/);
});
test("file inspection cannot publish after abort and does not invoke accessor options", async () => {
  const [, file] = (await sources())[0];
  const abort = new AbortController(); abort.abort();
  await assert.rejects(inspectWalletSavedText(file.text, { signal: abort.signal }), error => error.code === "FILE_CANCELLED");
  let calls = 0; await assert.rejects(inspectWalletSavedText(file.text, { get signal() { calls++; return null; } })); assert.equal(calls, 0);
  await assert.rejects(inspectWalletSavedText(file.text, { signal: { aborted: "no" } }), error => error.code === "FILE_INSPECTION_OPTIONS");
  const gate = deferred(), started = deferred(), late = new AbortController();
  const pending = inspectWalletSavedText(file.text, { signal: late.signal, subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  const rejected = assert.rejects(pending); await started.promise; late.abort(); gate.resolve(); await rejected;
});
