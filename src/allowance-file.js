import { allowanceObject, allowanceFail, validateAllowanceTargets } from "./allowance-targets.js";
import { validateAllowanceObservation } from "./allowance-observation.js";

export const ALLOWANCE_FILE_SCHEMA = "threecore-allowance-file-v1";
export const ALLOWANCE_FILE_LIMIT = 65536;

function payloadFor(kind, value) {
  if (kind === "targets") return validateAllowanceTargets(value);
  if (kind === "observation") return validateAllowanceObservation(value);
  allowanceFail("ALLOWANCE_FILE_KIND");
}
function encode(text) {
  if (typeof text !== "string" || !text.length || text.length > ALLOWANCE_FILE_LIMIT) allowanceFail("ALLOWANCE_FILE_SIZE");
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > ALLOWANCE_FILE_LIMIT) allowanceFail("ALLOWANCE_FILE_SIZE");
  return bytes;
}
async function digest(text, subtle) {
  if (typeof subtle?.digest !== "function") allowanceFail("ALLOWANCE_CRYPTO");
  let result;
  try { result = await subtle.digest("SHA-256", encode(text)); }
  catch { allowanceFail("ALLOWANCE_CRYPTO"); }
  if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) allowanceFail("ALLOWANCE_CRYPTO");
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
const canonical = (kind, payload) => JSON.stringify({ kind, payload }, null, 2);

export async function prepareAllowanceFile(kind, value, { subtle = globalThis.crypto?.subtle } = {}) {
  const payload = payloadFor(kind, value);
  const checksum = await digest(canonical(kind, payload), subtle);
  const text = JSON.stringify({ schema: ALLOWANCE_FILE_SCHEMA, kind, algorithm: "SHA-256",
    digest: checksum, payload }, null, 2);
  const bytes = encode(text);
  const agent = kind === "targets" ? payload.agent : payload.identity.agent;
  const suffix = kind === "targets" ? "targets" : payload.identity.blockNumber;
  return Object.freeze({
    text, byteLength: bytes.length, digest: checksum,
    filename: "ThreeCore-" + agent + "-allowances-" + suffix + ".json",
    mimeType: "application/json;charset=utf-8", kind, authenticated: false,
  });
}
export async function decodeAllowanceFile(input, { subtle = globalThis.crypto?.subtle } = {}) {
  if (!(input instanceof Uint8Array) || !input.length || input.length > ALLOWANCE_FILE_LIMIT) allowanceFail("ALLOWANCE_FILE_SIZE");
  const bytes = input.slice();
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { allowanceFail("ALLOWANCE_FILE_ENCODING"); }
  let record;
  try { record = JSON.parse(text); }
  catch { allowanceFail("ALLOWANCE_FILE_JSON"); }
  allowanceObject(record, ["schema", "kind", "algorithm", "digest", "payload"]);
  if (record.schema !== ALLOWANCE_FILE_SCHEMA || record.algorithm !== "SHA-256" ||
      typeof record.digest !== "string" || !/^[0-9a-f]{64}$/.test(record.digest)) allowanceFail("ALLOWANCE_FILE_SCHEMA");
  const payload = payloadFor(record.kind, record.payload);
  const checksum = await digest(canonical(record.kind, payload), subtle);
  if (checksum !== record.digest) allowanceFail("ALLOWANCE_CHECKSUM");
  return Object.freeze({ kind: record.kind, payload, digest: checksum, checksumVerified: true, authenticated: false });
}
export async function readAllowanceFile(file, options) {
  if (!file || typeof file.name !== "string" || !file.name.length || file.name.length > 240 ||
      !/\.json$/i.test(file.name) || /[\\/\u0000-\u001f\u007f]/.test(file.name)) allowanceFail("ALLOWANCE_FILENAME");
  const size = file.size;
  if (!Number.isSafeInteger(size) || size < 1 || size > ALLOWANCE_FILE_LIMIT) allowanceFail("ALLOWANCE_FILE_SIZE");
  let bytes;
  try { bytes = await file.arrayBuffer(); }
  catch { allowanceFail("ALLOWANCE_FILE_READ"); }
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== size) allowanceFail("ALLOWANCE_FILE_SIZE");
  return decodeAllowanceFile(new Uint8Array(bytes), options);
}
