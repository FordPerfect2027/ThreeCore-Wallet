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

async function digest(document, subtle) {
  if (!subtle || typeof subtle.digest !== "function") periodFail("PERIOD_CRYPTO");
  let buffer;
  try { buffer = await subtle.digest("SHA-256", encoder.encode(JSON.stringify(document))); }
  catch { periodFail("PERIOD_CRYPTO"); }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== 32) periodFail("PERIOD_CRYPTO");
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareReportHistoryFile(input, { subtle = globalThis.crypto?.subtle } = {}) {
  const document = portable(input), hash = await digest(document, subtle);
  const text = bounded(JSON.stringify({ schema: REPORT_HISTORY_FILE_SCHEMA, algorithm: "SHA-256", digest: hash, document }) + "\n");
  return Object.freeze({ text, digest: hash, byteLength: encoder.encode(text).byteLength,
    filename: "ThreeCore-report-history.json", mimeType: "application/json;charset=utf-8",
    encrypted: false, authenticated: false });
}

export async function decodeReportHistoryFile(text, { subtle = globalThis.crypto?.subtle } = {}) {
  bounded(text);
  let envelope;
  try { envelope = JSON.parse(text); } catch { periodFail("PERIOD_FILE_JSON"); }
  periodShape(envelope, ["schema", "algorithm", "digest", "document"]);
  if (envelope.schema !== REPORT_HISTORY_FILE_SCHEMA || envelope.algorithm !== "SHA-256" ||
      typeof envelope.digest !== "string" || !/^[0-9a-f]{64}$/.test(envelope.digest)) periodFail("PERIOD_HISTORY_FILE_SCHEMA");
  const document = portable(envelope.document);
  if (envelope.document.revision !== 0) periodFail("PERIOD_HISTORY_FILE_SCHEMA");
  if (await digest(document, subtle) !== envelope.digest) periodFail("PERIOD_CHECKSUM");
  return Object.freeze({ document, digest: envelope.digest, checksumVerified: true, authenticated: false });
}

export async function readReportHistoryFile(file, options) {
  if (!file || typeof file.name !== "string" || file.name.length > 180 || !/\.json$/i.test(file.name) ||
      /[/\\\u0000-\u001f\u007f]/.test(file.name)) periodFail("PERIOD_FILENAME");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > REPORT_HISTORY_FILE_LIMIT ||
      typeof file.arrayBuffer !== "function") periodFail("PERIOD_HISTORY_FILE_SIZE");
  let buffer;
  try { buffer = await file.arrayBuffer(); } catch { periodFail("PERIOD_FILE_READ"); }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size) periodFail("PERIOD_HISTORY_FILE_SIZE");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { periodFail("PERIOD_FILE_ENCODING"); }
  return decodeReportHistoryFile(text, options);
}
