import { periodFail, periodShape } from "./period-plan.js";
import { validatePeriodReportInput } from "./period-report-model.js";

export const PERIOD_REPORT_FILE_SCHEMA = "threecore.period-report-file.v1";
export const PERIOD_REPORT_FILE_LIMIT = 64 * 1024 * 1024;
const encoder = new TextEncoder();

function bounded(text) {
  if (typeof text !== "string" || text.length < 1 || text.length > PERIOD_REPORT_FILE_LIMIT ||
      encoder.encode(text).byteLength > PERIOD_REPORT_FILE_LIMIT) periodFail("PERIOD_REPORT_FILE_SIZE");
  return text;
}

async function digest(input, subtle) {
  if (!subtle || typeof subtle.digest !== "function") periodFail("PERIOD_CRYPTO");
  let bytes;
  try { bytes = await subtle.digest("SHA-256", encoder.encode(JSON.stringify(input))); }
  catch { periodFail("PERIOD_CRYPTO"); }
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== 32) periodFail("PERIOD_CRYPTO");
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
}

/** Conclusions are deliberately absent. Reopening recalculates them from source entries. */
export async function preparePeriodReportFile(inputValue, { subtle = globalThis.crypto?.subtle } = {}) {
  const input = validatePeriodReportInput(inputValue), checksum = await digest(input, subtle);
  const text = bounded(JSON.stringify({ schema: PERIOD_REPORT_FILE_SCHEMA,
    algorithm: "SHA-256", digest: checksum, input }) + "\n");
  return Object.freeze({ filename: "ThreeCore-period-report.json", mimeType: "application/json;charset=utf-8",
    text, byteLength: encoder.encode(text).byteLength, digest: checksum, authenticated: false, encrypted: false });
}

export async function decodePeriodReportFile(text, { subtle = globalThis.crypto?.subtle } = {}) {
  bounded(text);
  let value;
  try { value = JSON.parse(text); } catch { periodFail("PERIOD_FILE_JSON"); }
  periodShape(value, ["schema", "algorithm", "digest", "input"]);
  if (value.schema !== PERIOD_REPORT_FILE_SCHEMA || value.algorithm !== "SHA-256" ||
      typeof value.digest !== "string" || !/^[0-9a-f]{64}$/.test(value.digest)) periodFail("PERIOD_REPORT_FILE_SCHEMA");
  const input = validatePeriodReportInput(value.input);
  if (await digest(input, subtle) !== value.digest) periodFail("PERIOD_CHECKSUM");
  return Object.freeze({ input, digest: value.digest, checksumVerified: true, authenticated: false });
}

export async function readPeriodReportFile(file, options) {
  if (!file || typeof file.name !== "string" || file.name.length > 180 || !/\.json$/i.test(file.name) ||
      /[/\\\u0000-\u001f\u007f]/.test(file.name)) periodFail("PERIOD_FILENAME");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > PERIOD_REPORT_FILE_LIMIT ||
      typeof file.arrayBuffer !== "function") periodFail("PERIOD_REPORT_FILE_SIZE");
  let bytes;
  try { bytes = await file.arrayBuffer(); } catch { periodFail("PERIOD_FILE_READ"); }
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size) periodFail("PERIOD_REPORT_FILE_SIZE");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { periodFail("PERIOD_FILE_ENCODING"); }
  return decodePeriodReportFile(text, options);
}
