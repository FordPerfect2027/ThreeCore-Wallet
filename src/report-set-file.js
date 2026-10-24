import { readFormatFileText } from "./security-file.js";
import { parseSecurityJson } from "./security-json.js";
import { periodShape, periodFail } from "./period-plan.js";
import { validateReportSet } from "./report-set-model.js";

export const REPORT_SET_FILE_SCHEMA = "threecore.report-set-file.v1";
export const REPORT_SET_FILE_LIMIT = 96 * 1024 * 1024;
const encoder = new TextEncoder();

async function checksum(input, subtle) {
  if (!subtle || typeof subtle.digest !== "function") periodFail("PERIOD_CRYPTO");
  let result;
  try { result = await subtle.digest("SHA-256", encoder.encode(JSON.stringify(input))); }
  catch { periodFail("PERIOD_CRYPTO"); }
  if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) periodFail("PERIOD_CRYPTO");
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, "0")).join("");
}

function boundedText(text) {
  if (typeof text !== "string" || !text.length || text.length > REPORT_SET_FILE_LIMIT ||
      encoder.encode(text).byteLength > REPORT_SET_FILE_LIMIT) periodFail("PERIOD_SET_FILE_SIZE");
}

export async function prepareReportSetFile(value, { subtle = globalThis.crypto?.subtle } = {}) {
  const input = validateReportSet(value), digest = await checksum(input, subtle);
  const text = JSON.stringify({ schema: REPORT_SET_FILE_SCHEMA, algorithm: "SHA-256", digest, input }) + "\n";
  boundedText(text);
  return Object.freeze({ text, filename: "ThreeCore-report-set.json", mimeType: "application/json;charset=utf-8",
    byteLength: encoder.encode(text).byteLength, digest, encrypted: false, authenticated: false,
    containsOriginalEvidence: true });
}

export async function decodeReportSetFile(text, { subtle = globalThis.crypto?.subtle } = {}) {
  boundedText(text);
  let envelope;
  try { envelope = parseSecurityJson(text); } catch { periodFail("PERIOD_FILE_JSON"); }
  periodShape(envelope, ["schema", "algorithm", "digest", "input"]);
  if (envelope.schema !== REPORT_SET_FILE_SCHEMA || envelope.algorithm !== "SHA-256" ||
      typeof envelope.digest !== "string" || !/^[0-9a-f]{64}$/.test(envelope.digest)) periodFail("PERIOD_SET_FILE_SCHEMA");
  const input = validateReportSet(envelope.input);
  if (await checksum(input, subtle) !== envelope.digest) periodFail("PERIOD_CHECKSUM");
  return Object.freeze({ input, digest: envelope.digest, checksumVerified: true, authenticated: false });
}

export async function readReportSetFile(file, options) {
  if (!file || typeof file.name !== "string" || file.name.length > 180 || !/\.json$/i.test(file.name) ||
      /[/\\\u0000-\u001f\u007f]/.test(file.name)) periodFail("PERIOD_FILENAME");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > REPORT_SET_FILE_LIMIT ||
      typeof file.arrayBuffer !== "function") periodFail("PERIOD_SET_FILE_SIZE");
  const text = await readFormatFileText(file, { maxBytes: REPORT_SET_FILE_LIMIT, fail: periodFail,
    sizeCode: "PERIOD_SET_FILE_SIZE", readCode: "PERIOD_FILE_READ", encodingCode: "PERIOD_FILE_ENCODING",
    signal: options?.signal, timeoutMs: options?.timeoutMs });
  return decodeReportSetFile(text, options);
}
