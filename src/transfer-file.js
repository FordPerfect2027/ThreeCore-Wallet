import { shape, transferFail, validateTransferSnapshot } from "./transfer-codec.js";
import { transferCsv, transferSummaryText } from "./transfer-view.js";

export const TRANSFER_FILE_SCHEMA = "threecore.transfer-file.v1";
export const TRANSFER_FILE_LIMIT = 524288;
const encoder = new TextEncoder();

async function checksum(text, subtle) {
  if (!subtle || typeof subtle.digest !== "function") transferFail("TRANSFER_CRYPTO_UNAVAILABLE");
  let buffer;
  try { buffer = await subtle.digest("SHA-256", encoder.encode(text)); }
  catch { transferFail("TRANSFER_CRYPTO_FAILED"); }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== 32) transferFail("TRANSFER_CRYPTO_FAILED");
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function boundedText(text) {
  if (typeof text !== "string" || text.length < 1 || text.length > TRANSFER_FILE_LIMIT ||
      encoder.encode(text).length > TRANSFER_FILE_LIMIT) transferFail("TRANSFER_FILE_SIZE");
  return text;
}

export async function encodeTransferFile(input, { subtle = globalThis.crypto?.subtle } = {}) {
  const snapshot = validateTransferSnapshot(input);
  const digest = await checksum(JSON.stringify(snapshot), subtle);
  const envelope = {
    schema: TRANSFER_FILE_SCHEMA,
    algorithm: "SHA-256",
    digest,
    payload: snapshot,
  };
  return boundedText(JSON.stringify(envelope, null, 2) + "\n");
}

export async function decodeTransferFile(text, { subtle = globalThis.crypto?.subtle } = {}) {
  boundedText(text);
  let raw;
  try { raw = JSON.parse(text); }
  catch { transferFail("TRANSFER_FILE_JSON"); }
  shape(raw, ["schema", "algorithm", "digest", "payload"]);
  if (raw.schema !== TRANSFER_FILE_SCHEMA || raw.algorithm !== "SHA-256" ||
      typeof raw.digest !== "string" || !/^[\da-f]{64}$/.test(raw.digest)) transferFail("TRANSFER_FILE_SCHEMA");
  const snapshot = validateTransferSnapshot(raw.payload);
  const digest = await checksum(JSON.stringify(snapshot), subtle);
  if (digest !== raw.digest) transferFail("TRANSFER_CHECKSUM_MISMATCH");
  // A checksum detects accidental changes. Anyone can recompute it.
  return Object.freeze({ snapshot, digest, authenticated: false });
}

export async function readTransferFile(file, options) {
  if (!file || typeof file.name !== "string" || file.name.length > 180 ||
      !/\.json$/i.test(file.name) || /[/\\\u0000-\u001f\u007f]/.test(file.name)) transferFail("TRANSFER_FILE_NAME");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > TRANSFER_FILE_LIMIT ||
      typeof file.arrayBuffer !== "function") transferFail("TRANSFER_FILE_SIZE");
  let buffer;
  try { buffer = await file.arrayBuffer(); }
  catch { transferFail("TRANSFER_FILE_READ"); }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size) transferFail("TRANSFER_FILE_SIZE");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { transferFail("TRANSFER_FILE_ENCODING"); }
  return decodeTransferFile(text, options);
}

export async function prepareTransferDownload(input, kind = "json", options) {
  const snapshot = validateTransferSnapshot(input);
  if (!["json", "csv", "txt"].includes(kind)) transferFail("TRANSFER_FILE_KIND");
  const text = kind === "json" ? await encodeTransferFile(snapshot, options) :
    kind === "csv" ? transferCsv(snapshot) : transferSummaryText(snapshot, "imported") + "\n";
  const prefix = ["ThreeCore", snapshot.context.agent, snapshot.context.chainId,
    snapshot.context.account.slice(2, 10), "transfers", snapshot.range.fromBlock, snapshot.range.toBlock].join("-");
  return Object.freeze({
    filename: prefix + "." + kind,
    text,
    mimeType: ({ json: "application/json", csv: "text/csv", txt: "text/plain" })[kind] + ";charset=utf-8",
    byteLength: encoder.encode(text).length,
    authenticated: false,
  });
}
