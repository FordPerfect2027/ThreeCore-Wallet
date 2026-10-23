import {
  RECONCILIATION_LIMIT, validateReconciliationWorkspace, reconciliationFail, reconciliationShape,
  replaceReconciliationPart, reconciliationAgent,
} from "./reconciliation-model.js";
import { readTokenIdentityFile } from "./token-identity-report.js";
import { readTransferArchive } from "./transfer-archive-file.js";
import { readTransferFile } from "./transfer-file.js";
import { readVaultFile } from "./transfer-vault-file.js";
import { addTransferArchiveRecord } from "./transfer-archive.js";

export const RECONCILIATION_FILE_SCHEMA = "threecore.reconciliation-file.v1";
export const RECONCILIATION_FILE_LIMIT = 24 * 1024 * 1024;
export const RECONCILIATION_IMPORT_KINDS = Object.freeze([
  "workspace", "earlier", "later", "archive", "snapshot", "vault",
]);
const encoder = new TextEncoder();

function boundedText(text) {
  if (typeof text !== "string" || !text.length || text.length > RECONCILIATION_FILE_LIMIT ||
      encoder.encode(text).byteLength > RECONCILIATION_FILE_LIMIT) reconciliationFail("RECONCILIATION_FILE_SIZE");
  return text;
}

async function checksum(workspace, subtle) {
  if (!subtle || typeof subtle.digest !== "function") reconciliationFail("RECONCILIATION_CRYPTO");
  const bytes = encoder.encode(JSON.stringify(workspace));
  if (bytes.byteLength > RECONCILIATION_LIMIT) reconciliationFail("RECONCILIATION_SIZE");
  let buffer;
  try { buffer = await subtle.digest("SHA-256", bytes); }
  catch { reconciliationFail("RECONCILIATION_CRYPTO"); }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== 32) reconciliationFail("RECONCILIATION_CRYPTO");
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, "0")).join("");
}

export async function prepareReconciliationFile(input, { subtle = globalThis.crypto?.subtle } = {}) {
  const workspace = validateReconciliationWorkspace(input);
  const digest = await checksum(workspace, subtle);
  const text = boundedText(JSON.stringify({
    schema: RECONCILIATION_FILE_SCHEMA,
    algorithm: "SHA-256",
    digest,
    workspace,
  }, null, 2) + "\n");
  return Object.freeze({
    text,
    digest,
    byteLength: encoder.encode(text).byteLength,
    filename: "ThreeCore-balance-reconciliation.json",
    mimeType: "application/json;charset=utf-8",
    containsPublicAccounts: true,
    authenticated: false,
  });
}

export async function decodeReconciliationFile(text, { subtle = globalThis.crypto?.subtle } = {}) {
  boundedText(text);
  let envelope;
  try { envelope = JSON.parse(text); }
  catch { reconciliationFail("RECONCILIATION_FILE_JSON"); }
  reconciliationShape(envelope, ["schema", "algorithm", "digest", "workspace"]);
  if (envelope.schema !== RECONCILIATION_FILE_SCHEMA || envelope.algorithm !== "SHA-256" ||
      typeof envelope.digest !== "string" || !/^[0-9a-f]{64}$/.test(envelope.digest)) {
    reconciliationFail("RECONCILIATION_FILE_SCHEMA");
  }
  const workspace = validateReconciliationWorkspace(envelope.workspace);
  const digest = await checksum(workspace, subtle);
  if (digest !== envelope.digest) reconciliationFail("RECONCILIATION_CHECKSUM");
  return Object.freeze({ workspace, digest, checksumVerified: true, authenticated: false });
}

export async function readReconciliationFile(file, options) {
  if (!file || typeof file.name !== "string" || file.name.length > 180 ||
      !/\.json$/i.test(file.name) || /[/\\\u0000-\u001f\u007f]/.test(file.name)) {
    reconciliationFail("RECONCILIATION_FILENAME");
  }
  const size = file.size;
  if (!Number.isSafeInteger(size) || size < 1 || size > RECONCILIATION_FILE_LIMIT ||
      typeof file.arrayBuffer !== "function") reconciliationFail("RECONCILIATION_FILE_SIZE");
  let buffer;
  try { buffer = await file.arrayBuffer(); }
  catch { reconciliationFail("RECONCILIATION_FILE_READ"); }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== size) reconciliationFail("RECONCILIATION_FILE_SIZE");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { reconciliationFail("RECONCILIATION_FILE_ENCODING"); }
  return decodeReconciliationFile(text, options);
}

/** All legacy files keep their original checksum and context validation. */
export async function readReconciliationInput(file, kind, agent, beforeInput, options) {
  const before = validateReconciliationWorkspace(beforeInput);
  reconciliationAgent(agent);
  if (!RECONCILIATION_IMPORT_KINDS.includes(kind)) reconciliationFail("RECONCILIATION_FILE_KIND");
  if (kind === "workspace") return (await readReconciliationFile(file, options)).workspace;
  if (kind === "earlier" || kind === "later") {
    return replaceReconciliationPart(before, agent, kind, (await readTokenIdentityFile(file, options)).observation);
  }
  if (kind === "archive") {
    return replaceReconciliationPart(before, agent, "archive", (await readTransferArchive(file, options)).archive);
  }
  if (kind === "snapshot") {
    const archive = addTransferArchiveRecord(null, (await readTransferFile(file, options)).snapshot);
    return replaceReconciliationPart(before, agent, "archive", archive);
  }
  const { bundle } = await readVaultFile(file, options);
  // Vault import supplies all three archive slots, including explicit empty slots.
  return validateReconciliationWorkspace({
    ...before,
    slots: before.slots.map((slot, index) => ({ ...slot, archive: bundle.slots[index].archive })),
  });
}
