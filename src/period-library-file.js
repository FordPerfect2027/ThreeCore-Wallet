import { readFormatFileText } from "./security-file.js";
import { parseSecurityJson } from "./security-json.js";
import { periodShape, periodFail } from "./period-plan.js";
import { PERIOD_LIBRARY_SCHEMA, validatePeriodLibrary, mutatePeriodLibrary, libraryMetadata } from "./period-library-model.js";

export const PERIOD_LIBRARY_FILE_SCHEMA = "threecore.period-library-file.v1";
export const PERIOD_LIBRARY_FILE_LIMIT = 64 * 1024 * 1024;
const encoder = new TextEncoder();

function portable(input) {
  const document = validatePeriodLibrary(input);
  return validatePeriodLibrary({ schema: PERIOD_LIBRARY_SCHEMA, revision: 0, entries: document.entries });
}
function bounded(text) {
  if (typeof text !== "string" || !text.length || text.length > PERIOD_LIBRARY_FILE_LIMIT ||
      encoder.encode(text).byteLength > PERIOD_LIBRARY_FILE_LIMIT) periodFail("PERIOD_LIBRARY_FILE_SIZE");
  return text;
}
async function checksum(document, subtle) {
  if (!subtle || typeof subtle.digest !== "function") periodFail("PERIOD_CRYPTO");
  let result;
  try { result = await subtle.digest("SHA-256", encoder.encode(JSON.stringify(document))); }
  catch { periodFail("PERIOD_CRYPTO"); }
  if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) periodFail("PERIOD_CRYPTO");
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Include archived entries and conflict markers; local storage revision is not portable. */
export async function preparePeriodLibraryFile(input, { subtle = globalThis.crypto?.subtle } = {}) {
  const document = portable(input);
  const digest = await checksum(document, subtle);
  // Compact JSON avoids multiplying the size of large, already bounded event arrays.
  const text = bounded(JSON.stringify({ schema: PERIOD_LIBRARY_FILE_SCHEMA, algorithm: "SHA-256", digest, document }) + "\n");
  return Object.freeze({ text, digest, filename: "ThreeCore-period-library.json", mimeType: "application/json;charset=utf-8",
    byteLength: encoder.encode(text).byteLength, authenticated: false, encrypted: false });
}

export async function decodePeriodLibraryFile(text, { subtle = globalThis.crypto?.subtle } = {}) {
  bounded(text);
  let envelope;
  try { envelope = parseSecurityJson(text); } catch { periodFail("PERIOD_FILE_JSON"); }
  periodShape(envelope, ["schema", "algorithm", "digest", "document"]);
  if (envelope.schema !== PERIOD_LIBRARY_FILE_SCHEMA || envelope.algorithm !== "SHA-256" ||
      typeof envelope.digest !== "string" || !/^[0-9a-f]{64}$/.test(envelope.digest)) periodFail("PERIOD_LIBRARY_FILE_SCHEMA");
  const document = portable(envelope.document);
  if (envelope.document.revision !== 0) periodFail("PERIOD_LIBRARY_FILE_SCHEMA");
  if (await checksum(document, subtle) !== envelope.digest) periodFail("PERIOD_CHECKSUM");
  return Object.freeze({ document, digest: envelope.digest, checksumVerified: true, authenticated: false });
}

export async function readPeriodLibraryFile(file, options) {
  if (!file || typeof file.name !== "string" || file.name.length > 180 || !/\.json$/i.test(file.name) ||
      /[/\\\u0000-\u001f\u007f]/.test(file.name)) periodFail("PERIOD_FILENAME");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > PERIOD_LIBRARY_FILE_LIMIT ||
      typeof file.arrayBuffer !== "function") periodFail("PERIOD_LIBRARY_FILE_SIZE");
  const text = await readFormatFileText(file, { maxBytes: PERIOD_LIBRARY_FILE_LIMIT, fail: periodFail,
    sizeCode: "PERIOD_LIBRARY_FILE_SIZE", readCode: "PERIOD_FILE_READ", encodingCode: "PERIOD_FILE_ENCODING",
    signal: options?.signal, timeoutMs: options?.timeoutMs });
  return decodePeriodLibraryFile(text, options);
}

export function reviewPeriodLibraryImport(current, incoming) {
  const before = validatePeriodLibrary(current), source = portable(incoming);
  const after = mutatePeriodLibrary(before, before.revision, { kind: "import", entries: source.entries });
  const added = source.entries.filter(entry => !before.entries.some(row => row.id === entry.id));
  return Object.freeze({ expectedRevision: before.revision, entries: source.entries,
    additions: added.length, duplicates: source.entries.length - added.length,
    blockedAdditions: added.filter(row => row.requiresNewPlan).length,
    archivedAdditions: added.filter(row => row.archived).length, after: libraryMetadata(after) });
}
