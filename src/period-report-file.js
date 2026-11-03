import { walletSavedFileTargetCode } from "./file-read-status.js";
import { sha256Hex, captureOptionalDataFields } from "./security-data.js";
import { readFormatFileText, readFormatFileName } from "./security-file.js";
import { parseSecurityJson } from "./security-json.js";
import { periodFail, periodShape } from "./period-plan.js";
import { validatePeriodReportInput, periodReportEntryLibrary } from "./period-report-model.js";
import { preparePeriodLibraryFile } from "./period-library-file.js";

export const PERIOD_REPORT_FILE_SCHEMA = "threecore.period-report-file.v1";
export const PERIOD_REPORT_FILE_LIMIT = 64 * 1024 * 1024;
const encoder = new TextEncoder();

function bounded(text) {
  if (typeof text !== "string" || text.length < 1 || text.length > PERIOD_REPORT_FILE_LIMIT ||
      encoder.encode(text).byteLength > PERIOD_REPORT_FILE_LIMIT) periodFail("PERIOD_REPORT_FILE_SIZE");
  return text;
}

async function digest(input, subtle, options) {
  try { return await sha256Hex(encoder.encode(JSON.stringify(input)), subtle, options); }
  catch { periodFail("PERIOD_CRYPTO"); }
}

/** Conclusions are deliberately absent. Reopening recalculates them from source entries. */
export async function preparePeriodReportFile(inputValue, { subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  const input = validatePeriodReportInput(inputValue), checksum = await digest(input, subtle, { signal, timeoutMs });
  const text = bounded(JSON.stringify({ schema: PERIOD_REPORT_FILE_SCHEMA,
    algorithm: "SHA-256", digest: checksum, input }) + "\n");
  return Object.freeze({ filename: "ThreeCore-period-report.json", mimeType: "application/json;charset=utf-8",
    text, byteLength: encoder.encode(text).byteLength, digest: checksum, authenticated: false, encrypted: false });
}

export async function decodePeriodReportFile(text, { subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  bounded(text);
  let value;
  try { value = parseSecurityJson(text); } catch { periodFail("PERIOD_FILE_JSON"); }
  const targetCode = walletSavedFileTargetCode(value?.schema, "report");
  if (targetCode) periodFail(targetCode);
  periodShape(value, ["schema", "algorithm", "digest", "input"]);
  if (value.schema !== PERIOD_REPORT_FILE_SCHEMA || value.algorithm !== "SHA-256" ||
      typeof value.digest !== "string" || !/^[0-9a-f]{64}$/.test(value.digest)) periodFail("PERIOD_REPORT_FILE_SCHEMA");
  const input = validatePeriodReportInput(value.input);
  if (await digest(input, subtle, { signal, timeoutMs }) !== value.digest) periodFail("PERIOD_CHECKSUM");
  return Object.freeze({ input, digest: value.digest, checksumVerified: true, authenticated: false });
}

export async function readPeriodReportFile(file, options) {
  readFormatFileName(file, { maxLength: 180, fail: periodFail, code: "PERIOD_FILENAME" });
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > PERIOD_REPORT_FILE_LIMIT ||
      typeof file.arrayBuffer !== "function") periodFail("PERIOD_REPORT_FILE_SIZE");
  const text = await readFormatFileText(file, { maxBytes: PERIOD_REPORT_FILE_LIMIT, fail: periodFail,
    sizeCode: "PERIOD_REPORT_FILE_SIZE", readCode: "PERIOD_FILE_READ", encodingCode: "PERIOD_FILE_ENCODING",
    signal: options?.signal, timeoutMs: options?.timeoutMs });
  return decodePeriodReportFile(text, options);
}

/** Portable library format retains the complete selected entry and its restrictions. */
export async function preparePeriodReportEntryFile(inputValue, agent, fileOptions = {}) {
  const document = periodReportEntryLibrary(inputValue, agent), entry = document.entries[0];
  let options;
  try { options = captureOptionalDataFields(fileOptions, ["subtle", "signal", "timeoutMs"]); }
  catch { periodFail("PERIOD_REPORT_OPTIONS"); }
  const file = await preparePeriodLibraryFile(document, options);
  return Object.freeze({ ...file, filename: "ThreeCore-period-entry-" + entry.draft.plan.context.agent + ".json",
    agent: entry.draft.plan.context.agent, entryId: entry.id, archived: entry.archived,
    requiresNewPlan: entry.requiresNewPlan, containsOriginalEvidence: true, historicalOnly: true,
    liveChainRechecked: false, authorizesExecution: false });
}
