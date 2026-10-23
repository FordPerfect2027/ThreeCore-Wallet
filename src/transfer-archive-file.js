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

export async function readTransferArchive(file, { subtle = globalThis.crypto?.subtle } = {}) {
  if (!file || typeof file.name !== "string" || !/\.json$/i.test(file.name) || file.name.length > 180 ||
      /[/\\\u0000-\u001f\u007f]/.test(file.name)) transferFail("TRANSFER_FILE_NAME");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > TRANSFER_ARCHIVE_FILE_LIMIT ||
      typeof file.arrayBuffer !== "function") transferFail("TRANSFER_ARCHIVE_FILE_SIZE");
  let buffer;
  try { buffer = await file.arrayBuffer(); }
  catch { transferFail("TRANSFER_FILE_READ"); }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size) transferFail("TRANSFER_ARCHIVE_FILE_SIZE");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { transferFail("TRANSFER_FILE_ENCODING"); }
  let envelope;
  try { envelope = JSON.parse(text); }
  catch { transferFail("TRANSFER_FILE_JSON"); }
  shape(envelope, ["schema", "algorithm", "digest", "payload"]);
  if (envelope.schema !== FILE_SCHEMA || envelope.algorithm !== "SHA-256" ||
      typeof envelope.digest !== "string" || !/^[\da-f]{64}$/.test(envelope.digest)) transferFail("TRANSFER_ARCHIVE_SCHEMA");
  const archive = validateTransferArchive(envelope.payload);
  const digest = await digestArchive(archive, subtle);
  if (digest !== envelope.digest) transferFail("TRANSFER_CHECKSUM_MISMATCH");
  return Object.freeze({ archive, digest, authenticated: false });
}
