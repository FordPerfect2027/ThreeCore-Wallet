import { sha256Hex } from "./security-data.js";
import { readFormatFileText, readFormatFileName } from "./security-file.js";
import { parseSecurityJson } from "./security-json.js";
import { periodFail, periodShape } from "./period-plan.js";
import { validatePeriodDraft, PERIOD_DRAFT_LIMIT } from "./period-draft.js";

export const PERIOD_FILE_SCHEMA = "threecore.period-file.v1";
export const PERIOD_FILE_LIMIT = 24 * 1024 * 1024;
const encoder = new TextEncoder();

function bounded(text) {
  if (typeof text !== "string" || !text.length || text.length > PERIOD_FILE_LIMIT ||
      encoder.encode(text).byteLength > PERIOD_FILE_LIMIT) periodFail("PERIOD_FILE_SIZE");
  return text;
}

async function checksum(draft, subtle, options) {
  const bytes = encoder.encode(JSON.stringify(draft));
  if (bytes.byteLength > PERIOD_DRAFT_LIMIT) periodFail("PERIOD_DRAFT_SIZE");
  try { return await sha256Hex(bytes, subtle, options); }
  catch { periodFail("PERIOD_CRYPTO"); }
}

export async function preparePeriodFile(input, { subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  const draft = validatePeriodDraft(input);
  const digest = await checksum(draft, subtle, { signal, timeoutMs });
  const text = bounded(JSON.stringify({ schema: PERIOD_FILE_SCHEMA,
    algorithm: "SHA-256", digest, draft }, null, 2) + "\n");
  return Object.freeze({ text, digest, byteLength: encoder.encode(text).byteLength,
    filename: "ThreeCore-period-" + draft.plan.context.agent + ".json",
    mimeType: "application/json;charset=utf-8", containsPublicAccounts: true, authenticated: false });
}

export async function decodePeriodFile(text, { subtle = globalThis.crypto?.subtle, signal, timeoutMs } = {}) {
  bounded(text);
  let envelope;
  try { envelope = parseSecurityJson(text); }
  catch { periodFail("PERIOD_FILE_JSON"); }
  periodShape(envelope, ["schema", "algorithm", "digest", "draft"]);
  if (envelope.schema !== PERIOD_FILE_SCHEMA || envelope.algorithm !== "SHA-256" ||
      typeof envelope.digest !== "string" || !/^[0-9a-f]{64}$/.test(envelope.digest)) periodFail("PERIOD_FILE_SCHEMA");
  const draft = validatePeriodDraft(envelope.draft);
  const digest = await checksum(draft, subtle, { signal, timeoutMs });
  if (digest !== envelope.digest) periodFail("PERIOD_CHECKSUM");
  return Object.freeze({ draft, digest, checksumVerified: true, authenticated: false });
}

export async function readPeriodFile(file, options) {
  readFormatFileName(file, { maxLength: 180, fail: periodFail, code: "PERIOD_FILENAME" });
  const size = file.size;
  if (!Number.isSafeInteger(size) || size < 1 || size > PERIOD_FILE_LIMIT ||
      typeof file.arrayBuffer !== "function") periodFail("PERIOD_FILE_SIZE");
  const text = await readFormatFileText(file, { maxBytes: PERIOD_FILE_LIMIT, fail: periodFail,
    sizeCode: "PERIOD_FILE_SIZE", readCode: "PERIOD_FILE_READ", encodingCode: "PERIOD_FILE_ENCODING",
    signal: options?.signal, timeoutMs: options?.timeoutMs });
  return decodePeriodFile(text, options);
}
