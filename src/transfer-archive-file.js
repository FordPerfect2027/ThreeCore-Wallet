import { readFormatFileText } from "./security-file.js";
import { parseSecurityJson } from "./security-json.js";
import { shape, transferFail } from "./transfer-codec.js";
import { validateTransferArchive } from "./transfer-archive.js";

export const TRANSFER_ARCHIVE_FILE_LIMIT = 6 * 1024 * 1024;
const FILE_SCHEMA = "threecore.transfer-archive-file.v1";
const encoder = new TextEncoder();

async function digestArchive(payload, subtle) {
  if (!subtle || typeof subtle.digest !== "function") transferFail("TRANSFER_CRYPTO_UNAVAILABLE");
  let result;
  try { result = await subtle.digest("SHA-256", encoder.encode(JSON.stringify(payload))); }
  catch { transferFail("TRANSFER_CRYPTO_FAILED"); }
  if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) transferFail("TRANSFER_CRYPTO_FAILED");
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareTransferArchive(input, { subtle = globalThis.crypto?.subtle } = {}) {
  const payload = validateTransferArchive(input);
  const digest = await digestArchive(payload, subtle);
  const text = JSON.stringify({ schema: FILE_SCHEMA, algorithm: "SHA-256", digest, payload }, null, 2) + "\n";
  const byteLength = encoder.encode(text).length;
  if (byteLength > TRANSFER_ARCHIVE_FILE_LIMIT) transferFail("TRANSFER_ARCHIVE_FILE_SIZE");
  const selected = payload.records[0].context;
  return Object.freeze({
    text, byteLength, digest, authenticated: false,
    filename: `ThreeCore-${selected.agent}-${selected.chainId}-${selected.account.slice(2, 10)}-transfer-archive.json`,
    mimeType: "application/json;charset=utf-8",
  });
}

export async function readTransferArchive(file, { subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  if (!file || typeof file.name !== "string" || !/\.json$/i.test(file.name) || file.name.length > 180 ||
      /[/\\\u0000-\u001f\u007f]/.test(file.name)) transferFail("TRANSFER_FILE_NAME");
  const text = await readFormatFileText(file, { maxBytes: TRANSFER_ARCHIVE_FILE_LIMIT, fail: transferFail,
    sizeCode: "TRANSFER_ARCHIVE_FILE_SIZE", readCode: "TRANSFER_FILE_READ",
    encodingCode: "TRANSFER_FILE_ENCODING", signal, timeoutMs });
  let envelope;
  try { envelope = parseSecurityJson(text); }
  catch { transferFail("TRANSFER_FILE_JSON"); }
  shape(envelope, ["schema", "algorithm", "digest", "payload"]);
  if (envelope.schema !== FILE_SCHEMA || envelope.algorithm !== "SHA-256" ||
      typeof envelope.digest !== "string" || !/^[\da-f]{64}$/.test(envelope.digest)) transferFail("TRANSFER_ARCHIVE_SCHEMA");
  const archive = validateTransferArchive(envelope.payload);
  const digest = await digestArchive(archive, subtle);
  if (digest !== envelope.digest) transferFail("TRANSFER_CHECKSUM_MISMATCH");
  return Object.freeze({ archive, digest, authenticated: false });
}
