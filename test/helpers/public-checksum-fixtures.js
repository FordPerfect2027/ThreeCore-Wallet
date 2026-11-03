import { encodeTransferFile, decodeTransferFile } from "../../src/transfer-file.js";
import { prepareTransferArchive, readTransferArchive } from "../../src/transfer-archive-file.js";
import { prepareVaultFile, decodeVaultFile } from "../../src/transfer-vault-file.js";
import { prepareVaultCollection, decodeVaultCollection } from "../../src/transfer-vault-collection.js";
import { emptyVaultDocument, mutateVaultDocument } from "../../src/transfer-vault-model.js";
import { preparePeriodFile, decodePeriodFile } from "../../src/period-file.js";
import { preparePeriodLibraryFile, decodePeriodLibraryFile } from "../../src/period-library-file.js";
import { emptyPeriodLibrary } from "../../src/period-library-model.js";
import { preparePeriodReportFile, decodePeriodReportFile } from "../../src/period-report-file.js";
import { prepareReportHistoryFile, decodeReportHistoryFile } from "../../src/report-history-file.js";
import { emptyReportHistory } from "../../src/report-history-model.js";
import { prepareReportSetFile, decodeReportSetFile } from "../../src/report-set-file.js";
import { prepareReconciliationFile, decodeReconciliationFile } from "../../src/reconciliation-file.js";
import { prepareWorkspaceFile, decodeWorkspaceFile } from "../../src/workspace-file.js";
import { prepareCheckpointCollection, decodeCheckpointCollection } from "../../src/checkpoint-transfer.js";
import { emptyCheckpointDocument } from "../../src/checkpoint-model.js";
import { prepareAllowanceFile, decodeAllowanceFile } from "../../src/allowance-file.js";
import { prepareAllowanceBundle, decodeAllowanceBundle, captureAllowanceBundle } from "../../src/allowance-bundle.js";
import { prepareTokenIdentityFile, decodeTokenIdentityFile } from "../../src/token-identity-report.js";
import { reviewRehearsalReport } from "../../src/operation-rehearsal-report-review.js";
import { snapshot } from "./transfer-fixtures.js";
import { archiveFor, bundleFor, saveOperation } from "./vault-fixtures.js";
import { checkpoint } from "./period-fixtures.js";
import { reportInput } from "./period-report-fixtures.js";
import { sequenceSet } from "./report-set-fixtures.js";
import { workspace } from "./reconciliation-fixtures.js";
import { bundle } from "./workspace-fixtures.js";
import { record } from "./allowance-fixtures.js";
import { observation } from "./identity-fixtures.js";
import { newReportFixtures } from "./rehearsal-report-fixtures.js";

export const checksumFormats = [
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

const bytes = text => new TextEncoder().encode(text);
export const checksumReaders = {
  transfer: decodeTransferFile,
  archive: (text, options) => { const value=bytes(text); return readTransferArchive({name:'synthetic.json',size:value.length,arrayBuffer:async()=>value.buffer},options); },
  vault: decodeVaultFile,
  'vault collection': decodeVaultCollection,
  period: decodePeriodFile,
  library: decodePeriodLibraryFile,
  report: decodePeriodReportFile,
  history: decodeReportHistoryFile,
  'report set': decodeReportSetFile,
  reconciliation: decodeReconciliationFile,
  workspace: (text,options)=>decodeWorkspaceFile(bytes(text),options),
  checkpoints: decodeCheckpointCollection,
  allowance: (text,options)=>decodeAllowanceFile(bytes(text),options),
  'allowance bundle': (text,options)=>decodeAllowanceBundle(bytes(text),options),
  identity: (text,options)=>decodeTokenIdentityFile(bytes(text),options),
};
