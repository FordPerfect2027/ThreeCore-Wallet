import { sha256Hex } from "./security-data.js";
import { readFormatFileText, readFormatFileName } from "./security-file.js";
import { parseSecurityJson } from "./security-json.js";
import { periodShape, periodFail } from "./period-plan.js";
import { validateReportHistory } from "./report-history-model.js";

export const REPORT_HISTORY_FILE_SCHEMA = "threecore.report-history-file.v1";
export const REPORT_HISTORY_FILE_LIMIT = 96 * 1024 * 1024;
const encoder = new TextEncoder();

function portable(input) {
  const document = validateReportHistory(input);
  return validateReportHistory({ ...document, revision: 0 });
}

function bounded(text) {
  if (typeof text !== "string" || !text.length || text.length > REPORT_HISTORY_FILE_LIMIT ||
      encoder.encode(text).byteLength > REPORT_HISTORY_FILE_LIMIT) periodFail("PERIOD_HISTORY_FILE_SIZE");
  return text;
}

async function digest(document, subtle, options) {
  try { return await sha256Hex(encoder.encode(JSON.stringify(document)), subtle, options); }
  catch { periodFail("PERIOD_CRYPTO"); }
}

export async function prepareReportHistoryFile(input, { subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  const document = portable(input), hash = await digest(document, subtle, { signal, timeoutMs });
  const text = bounded(JSON.stringify({ schema: REPORT_HISTORY_FILE_SCHEMA, algorithm: "SHA-256", digest: hash, document }) + "\n");
  return Object.freeze({ text, digest: hash, byteLength: encoder.encode(text).byteLength,
    filename: "ThreeCore-report-history.json", mimeType: "application/json;charset=utf-8",
    encrypted: false, authenticated: false });
}

export async function decodeReportHistoryFile(text, { subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  bounded(text);
  let envelope;
  try { envelope = parseSecurityJson(text); } catch { periodFail("PERIOD_FILE_JSON"); }
  periodShape(envelope, ["schema", "algorithm", "digest", "document"]);
  if (envelope.schema !== REPORT_HISTORY_FILE_SCHEMA || envelope.algorithm !== "SHA-256" ||
      typeof envelope.digest !== "string" || !/^[0-9a-f]{64}$/.test(envelope.digest)) periodFail("PERIOD_HISTORY_FILE_SCHEMA");
  const document = portable(envelope.document);
  if (envelope.document.revision !== 0) periodFail("PERIOD_HISTORY_FILE_SCHEMA");
  if (await digest(document, subtle, { signal, timeoutMs }) !== envelope.digest) periodFail("PERIOD_CHECKSUM");
  return Object.freeze({ document, digest: envelope.digest, checksumVerified: true, authenticated: false });
}

export async function readReportHistoryFile(file, options) {
  readFormatFileName(file, { maxLength: 180, fail: periodFail, code: "PERIOD_FILENAME" });
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > REPORT_HISTORY_FILE_LIMIT ||
      typeof file.arrayBuffer !== "function") periodFail("PERIOD_HISTORY_FILE_SIZE");
  const text = await readFormatFileText(file, { maxBytes: REPORT_HISTORY_FILE_LIMIT, fail: periodFail,
    sizeCode: "PERIOD_HISTORY_FILE_SIZE", readCode: "PERIOD_FILE_READ", encodingCode: "PERIOD_FILE_ENCODING",
    signal: options?.signal, timeoutMs: options?.timeoutMs });
  return decodeReportHistoryFile(text, options);
}
