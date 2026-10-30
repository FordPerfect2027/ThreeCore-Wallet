import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { encodeTransferFile } from "../src/transfer-file.js";
import { prepareTransferArchive } from "../src/transfer-archive-file.js";
import { prepareVaultFile } from "../src/transfer-vault-file.js";
import { prepareVaultCollection } from "../src/transfer-vault-collection.js";
import { emptyVaultDocument, mutateVaultDocument } from "../src/transfer-vault-model.js";
import { preparePeriodFile } from "../src/period-file.js";
import { preparePeriodLibraryFile } from "../src/period-library-file.js";
import { emptyPeriodLibrary } from "../src/period-library-model.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { emptyReportHistory } from "../src/report-history-model.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { prepareReconciliationFile } from "../src/reconciliation-file.js";
import { prepareWorkspaceFile } from "../src/workspace-file.js";
import { prepareCheckpointCollection } from "../src/checkpoint-transfer.js";
import { emptyCheckpointDocument } from "../src/checkpoint-model.js";
import { prepareAllowanceFile } from "../src/allowance-file.js";
import { prepareAllowanceBundle, captureAllowanceBundle } from "../src/allowance-bundle.js";
import { prepareTokenIdentityFile } from "../src/token-identity-report.js";
import { reviewRehearsalReport } from "../src/operation-rehearsal-report-review.js";
import { snapshot } from "./helpers/transfer-fixtures.js";
import { archiveFor, bundleFor, saveOperation } from "./helpers/vault-fixtures.js";
import { checkpoint } from "./helpers/period-fixtures.js";
import { reportInput } from "./helpers/period-report-fixtures.js";
import { sequenceSet } from "./helpers/report-set-fixtures.js";
import { workspace } from "./helpers/reconciliation-fixtures.js";
import { bundle } from "./helpers/workspace-fixtures.js";
import { record } from "./helpers/allowance-fixtures.js";
import { observation } from "./helpers/identity-fixtures.js";
import { newReportFixtures } from "./helpers/rehearsal-report-fixtures.js";

const formats = [
  ["transfer", options => encodeTransferFile(snapshot(), options), "TRANSFER_CRYPTO_FAILED"],
  ["archive", options => prepareTransferArchive(archiveFor(), options), "TRANSFER_CRYPTO_FAILED"],
  ["vault", options => prepareVaultFile(bundleFor(), options), "TRANSFER_CRYPTO_FAILED"],
  ["vault collection", options => prepareVaultCollection(mutateVaultDocument(emptyVaultDocument(), 0, saveOperation()), options), "TRANSFER_CRYPTO_FAILED"],
  ["period", options => preparePeriodFile(checkpoint(), options), "PERIOD_CRYPTO"],
  ["library", options => preparePeriodLibraryFile(emptyPeriodLibrary(), options), "PERIOD_CRYPTO"],
  ["report", options => preparePeriodReportFile(reportInput(), options), "PERIOD_CRYPTO"],
  ["history", options => prepareReportHistoryFile(emptyReportHistory(), options), "PERIOD_CRYPTO"],
  ["report set", options => prepareReportSetFile(sequenceSet(), options), "PERIOD_CRYPTO"],
  ["reconciliation", options => prepareReconciliationFile(workspace(), options), "RECONCILIATION_CRYPTO"],
  ["workspace", options => prepareWorkspaceFile(bundle(), options), "WORKSPACE_CRYPTO"],
  ["checkpoints", options => prepareCheckpointCollection(emptyCheckpointDocument(), options), "CHECKPOINT_CRYPTO"],
  ["allowance", options => prepareAllowanceFile("observation", record(), options), "ALLOWANCE_CRYPTO"],
  ["allowance bundle", options => prepareAllowanceBundle(captureAllowanceBundle(["DAT", "EMA", "CAWELON"].map(agent => record({}, agent))), options), "ALLOWANCE_CRYPTO"],
  ["identity", options => prepareTokenIdentityFile(observation(), options), "IDENTITY_CRYPTO"],
  ["rehearsal review", options => reviewRehearsalReport(JSON.stringify(newReportFixtures().matching), options), "REVIEW_HASH_UNAVAILABLE"],
];
for (const [name, prepare, code] of formats) {
  test(`${name}: digest accessor failure is sanitized`, async () => {
    const subtle = { get digest() { throw Error("synthetic adapter detail"); } };
    const expected = code === "TRANSFER_CRYPTO_FAILED" ? "TRANSFER_CRYPTO_UNAVAILABLE" : code;
    await assert.rejects(prepare({ subtle }), error => error.code === expected && !error.message.includes("synthetic adapter"));
  });
  test(`${name}: capture each digest method once and retain its receiver`, async () => {
    let reads = 0, calls = 0;
    const subtle = { get digest() { reads++; return function(...args) {
      calls++; assert.equal(this, subtle); return webcrypto.subtle.digest(...args);
    }; } };
    await prepare({ subtle }); assert.ok(calls > 0); assert.equal(reads, calls);
  });
  test(`${name}: reject a fake digest length`, async () => {
    const value = new ArrayBuffer(31);
    Object.defineProperty(value, "byteLength", { value: 32 });
    await assert.rejects(prepare({ subtle: { digest: async () => value } }), error => error.code === code);
  });
  test(`${name}: reject array-like digest results`, async () => {
    await assert.rejects(prepare({ subtle: { digest: async () => ({ length: 32 }) } }), error => error.code === code);
  });
}
