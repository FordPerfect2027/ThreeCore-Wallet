import { readFormatFileBytes } from "./security-file.js";
import { parseSecurityJson } from "./security-json.js";
import { identityObject, identityFail } from "./token-identity-codec.js";
import { validateTokenObservation } from "./token-identity-model.js";

export const IDENTITY_FILE_SCHEMA = "threecore-token-observation-file-v1";
export const IDENTITY_FILE_LIMIT = 32768;

function bytesFor(text) {
  if (typeof text !== "string" || !text.length || text.length > IDENTITY_FILE_LIMIT) {
    identityFail("IDENTITY_FILE_SIZE");
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > IDENTITY_FILE_LIMIT) identityFail("IDENTITY_FILE_SIZE");
  return bytes;
}

async function checksum(text, subtle) {
  if (!subtle || typeof subtle.digest !== "function") identityFail("IDENTITY_CRYPTO");
  let value;
  try { value = await subtle.digest("SHA-256", bytesFor(text)); }
  catch { identityFail("IDENTITY_CRYPTO"); }
  if (!(value instanceof ArrayBuffer) || value.byteLength !== 32) identityFail("IDENTITY_CRYPTO");
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export function encodeTokenObservation(input) {
  return JSON.stringify(validateTokenObservation(input), null, 2);
}

export function decodeTokenObservation(text) {
  bytesFor(text);
  let input;
  try { input = parseSecurityJson(text); }
  catch { identityFail("IDENTITY_FILE_JSON"); }
  return validateTokenObservation(input);
}

/** A checksum proves local consistency, never authorship or chain provenance. */
export async function prepareTokenIdentityFile(input, { subtle = globalThis.crypto?.subtle } = {}) {
  const observation = validateTokenObservation(input);
  const canonical = encodeTokenObservation(observation);
  const digest = await checksum(canonical, subtle);
  const text = JSON.stringify({
    schema: IDENTITY_FILE_SCHEMA,
    algorithm: "SHA-256",
    digest,
    observation,
  }, null, 2);
  const bytes = bytesFor(text);
  return Object.freeze({
    text,
    byteLength: bytes.byteLength,
    digest,
    filename: "ThreeCore-" + observation.agent + "-identity-" + observation.blockNumber + ".json",
    mimeType: "application/json;charset=utf-8",
    containsPublicAccount: true,
    authenticated: false,
  });
}

export async function decodeTokenIdentityFile(input, { subtle = globalThis.crypto?.subtle } = {}) {
  if (!(input instanceof Uint8Array) || !input.byteLength || input.byteLength > IDENTITY_FILE_LIMIT) {
    identityFail("IDENTITY_FILE_SIZE");
  }
  // Copy before any asynchronous digest: a caller cannot replace the bytes.
  const bytes = input.slice();
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { identityFail("IDENTITY_FILE_ENCODING"); }
  let document;
  try { document = parseSecurityJson(text); }
  catch { identityFail("IDENTITY_FILE_JSON"); }
  identityObject(document, ["schema", "algorithm", "digest", "observation"]);
  if (document.schema !== IDENTITY_FILE_SCHEMA || document.algorithm !== "SHA-256" ||
      typeof document.digest !== "string" || !/^[0-9a-f]{64}$/.test(document.digest)) {
    identityFail("IDENTITY_FILE_SCHEMA");
  }
  const observation = validateTokenObservation(document.observation);
  const actual = await checksum(encodeTokenObservation(observation), subtle);
  if (actual !== document.digest) identityFail("IDENTITY_CHECKSUM");
  return Object.freeze({ observation, digest: actual, checksumVerified: true, authenticated: false });
}

export async function readTokenIdentityFile(file, options) {
  if (!file || typeof file.name !== "string" || !file.name.length || file.name.length > 240 ||
      !/\.json$/i.test(file.name) || /[\\/\u0000-\u001f\u007f]/.test(file.name)) identityFail("IDENTITY_FILENAME");
  const bytes = await readFormatFileBytes(file, { maxBytes: IDENTITY_FILE_LIMIT, fail: identityFail,
    sizeCode: "IDENTITY_FILE_SIZE", readCode: "IDENTITY_FILE_READ", signal: options?.signal, timeoutMs: options?.timeoutMs });
  return decodeTokenIdentityFile(bytes, options);
}
