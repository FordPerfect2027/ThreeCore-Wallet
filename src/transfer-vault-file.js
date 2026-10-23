import { shape, transferFail } from "./transfer-codec.js";
import { VAULT_BUNDLE_BYTES, validateVaultBundle, vaultHasRecords } from "./transfer-vault-model.js";
import { readTransferArchive } from "./transfer-archive-file.js";
import { readTransferFile } from "./transfer-file.js";
import { addTransferArchiveRecord } from "./transfer-archive.js";

export const VAULT_FILE_SCHEMA = "threecore.transfer-vault-file.v1";
export const VAULT_FILE_LIMIT = 20 * 1024 * 1024;
const encoder = new TextEncoder();

function bounded(text) {
  if (typeof text !== "string" || !text.length || text.length > VAULT_FILE_LIMIT ||
      encoder.encode(text).byteLength > VAULT_FILE_LIMIT) transferFail("TRANSFER_VAULT_FILE_SIZE");
  return text;
}

async function checksum(bundle, subtle) {
  if (!subtle || typeof subtle.digest !== "function") transferFail("TRANSFER_CRYPTO_UNAVAILABLE");
  const canonical = encoder.encode(JSON.stringify(bundle));
  if (canonical.byteLength > VAULT_BUNDLE_BYTES) transferFail("TRANSFER_VAULT_SIZE");
  let digest;
  try { digest = await subtle.digest("SHA-256", canonical); }
  catch { transferFail("TRANSFER_CRYPTO_FAILED"); }
  if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) transferFail("TRANSFER_CRYPTO_FAILED");
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareVaultFile(input, { subtle = globalThis.crypto?.subtle } = {}) {
  const bundle = validateVaultBundle(input);
  if (!vaultHasRecords(bundle)) transferFail("TRANSFER_VAULT_EMPTY");
  const digest = await checksum(bundle, subtle);
  const text = bounded(JSON.stringify({ schema: VAULT_FILE_SCHEMA, algorithm: "SHA-256", digest, bundle }, null, 2) + "\n");
  return Object.freeze({ text, digest, byteLength: encoder.encode(text).byteLength,
    filename: "ThreeCore-transfer-vault.json", mimeType: "application/json;charset=utf-8", authenticated: false });
}

export async function decodeVaultFile(text, { subtle = globalThis.crypto?.subtle } = {}) {
  bounded(text);
  let value;
  try { value = JSON.parse(text); }
  catch { transferFail("TRANSFER_FILE_JSON"); }
  shape(value, ["schema", "algorithm", "digest", "bundle"]);
  if (value.schema !== VAULT_FILE_SCHEMA || value.algorithm !== "SHA-256" ||
      typeof value.digest !== "string" || !/^[\da-f]{64}$/.test(value.digest)) transferFail("TRANSFER_VAULT_FILE_SCHEMA");
  const bundle = validateVaultBundle(value.bundle);
  if (!vaultHasRecords(bundle)) transferFail("TRANSFER_VAULT_EMPTY");
  const digest = await checksum(bundle, subtle);
  if (digest !== value.digest) transferFail("TRANSFER_CHECKSUM_MISMATCH");
  return Object.freeze({ bundle, digest, authenticated: false });
}

export async function readVaultFile(file, options) {
  if (!file || typeof file.name !== "string" || file.name.length > 180 ||
      !/\.json$/i.test(file.name) || /[/\\\u0000-\u001f\u007f]/.test(file.name)) transferFail("TRANSFER_FILE_NAME");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > VAULT_FILE_LIMIT ||
      typeof file.arrayBuffer !== "function") transferFail("TRANSFER_VAULT_FILE_SIZE");
  let buffer;
  try { buffer = await file.arrayBuffer(); }
  catch { transferFail("TRANSFER_FILE_READ"); }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size) transferFail("TRANSFER_VAULT_FILE_SIZE");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { transferFail("TRANSFER_FILE_ENCODING"); }
  return decodeVaultFile(text, options);
}

/** Existing per-token formats remain readable with their original strict checks. */
export async function readLegacyVaultInput(file, kind, options) {
  if (kind === "archive") return (await readTransferArchive(file, options)).archive;
  if (kind === "snapshot") return addTransferArchiveRecord(null, (await readTransferFile(file, options)).snapshot);
  transferFail("TRANSFER_VAULT_FILE_KIND");
}
