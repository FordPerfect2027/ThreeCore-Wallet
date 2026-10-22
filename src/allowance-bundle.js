import { allowanceObject, allowanceFail } from "./allowance-targets.js";
import { validateAllowanceObservation } from "./allowance-observation.js";
import { prepareAllowanceFile, decodeAllowanceFile } from "./allowance-file.js";
import { describeAllowanceOverview } from "./allowance-overview.js";

export const ALLOWANCE_BUNDLE_SCHEMA = "threecore-allowance-bundle-v1";
export const ALLOWANCE_BUNDLE_LIMIT = 196608;
const agents = ["DAT", "EMA", "CAWELON"];
export function validateAllowanceBundle(input) {
  allowanceObject(input, ["schema", "records", "readOnly", "atomicSnapshot"]);
  if (input.schema !== ALLOWANCE_BUNDLE_SCHEMA || input.readOnly !== true || input.atomicSnapshot !== false) {
    allowanceFail("ALLOWANCE_BUNDLE_SCHEMA");
  }
  if (!Array.isArray(input.records) || input.records.length !== 3 || Reflect.ownKeys(input.records).length !== 4) {
    allowanceFail("ALLOWANCE_BUNDLE_RECORDS");
  }
  for (let i = 0; i < 3; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input.records, String(i));
    if (!descriptor || !("value" in descriptor)) allowanceFail("ALLOWANCE_BUNDLE_RECORDS");
  }
  const records = input.records.map(validateAllowanceObservation);
  if (new Set(records.map(record => record.identity.agent)).size !== 3) allowanceFail("ALLOWANCE_BUNDLE_RECORDS");
  records.sort((a, b) => agents.indexOf(a.identity.agent) - agents.indexOf(b.identity.agent));
  return Object.freeze({
    schema: ALLOWANCE_BUNDLE_SCHEMA, records: Object.freeze(records),
    readOnly: true, atomicSnapshot: false,
  });
}
export function captureAllowanceBundle(records) {
  return validateAllowanceBundle({
    schema: ALLOWANCE_BUNDLE_SCHEMA, records, readOnly: true, atomicSnapshot: false,
  });
}
export function allowanceBundleKey(input) {
  return JSON.stringify(validateAllowanceBundle(input));
}
export function describeAllowanceBundle(input) {
  const bundle = validateAllowanceBundle(input);
  const summary = describeAllowanceOverview(bundle.records.map(record => ({
    agent: record.identity.agent, observation: record, provenance: "imported",
  })));
  return "3トークンの保存記録\n\n" + summary +
    "\n\n3件は別々の時点の観測です。同時刻・同一ブロックの資産一覧ではありません。" +
    "\n読込みは表示だけです。接続設定や現在のカードの記録を置き換えません。";
}
async function sha256(text, subtle) {
  if (typeof subtle?.digest !== "function") allowanceFail("ALLOWANCE_CRYPTO");
  let digest;
  try { digest = await subtle.digest("SHA-256", new TextEncoder().encode(text)); }
  catch { allowanceFail("ALLOWANCE_CRYPTO"); }
  if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) allowanceFail("ALLOWANCE_CRYPTO");
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}
const signature = files => JSON.stringify({ schema: ALLOWANCE_BUNDLE_SCHEMA, files }, null, 2);
export async function prepareAllowanceBundle(input, { subtle = globalThis.crypto?.subtle } = {}) {
  const bundle = validateAllowanceBundle(input);
  const files = [];
  for (const record of bundle.records) {
    const prepared = await prepareAllowanceFile("observation", record, { subtle });
    files.push(JSON.parse(prepared.text));
  }
  const digest = await sha256(signature(files), subtle);
  const text = JSON.stringify({
    schema: ALLOWANCE_BUNDLE_SCHEMA, algorithm: "SHA-256", digest, files,
  }, null, 2);
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > ALLOWANCE_BUNDLE_LIMIT) allowanceFail("ALLOWANCE_FILE_SIZE");
  return Object.freeze({
    text, byteLength, digest, authenticated: false,
    filename: "ThreeCore-DAT-EMA-CAWELON-allowances.json",
    mimeType: "application/json;charset=utf-8",
  });
}
export async function decodeAllowanceBundle(bytes, { subtle = globalThis.crypto?.subtle } = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > ALLOWANCE_BUNDLE_LIMIT) allowanceFail("ALLOWANCE_FILE_SIZE");
  let text, wrapper;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice()); }
  catch { allowanceFail("ALLOWANCE_FILE_ENCODING"); }
  try { wrapper = JSON.parse(text); }
  catch { allowanceFail("ALLOWANCE_FILE_JSON"); }
  allowanceObject(wrapper, ["schema", "algorithm", "digest", "files"]);
  if (wrapper.schema !== ALLOWANCE_BUNDLE_SCHEMA || wrapper.algorithm !== "SHA-256" ||
      typeof wrapper.digest !== "string" || !/^[0-9a-f]{64}$/.test(wrapper.digest)) allowanceFail("ALLOWANCE_BUNDLE_SCHEMA");
  if (!Array.isArray(wrapper.files) || wrapper.files.length !== 3) allowanceFail("ALLOWANCE_BUNDLE_RECORDS");
  const records = [];
  const canonicalFiles = [];
  for (const file of wrapper.files) {
    const decoded = await decodeAllowanceFile(new TextEncoder().encode(JSON.stringify(file)), { subtle });
    if (decoded.kind !== "observation") allowanceFail("ALLOWANCE_BUNDLE_RECORDS");
    records.push(decoded.payload);
    canonicalFiles.push({ schema: file.schema, kind: decoded.kind, algorithm: "SHA-256",
      digest: decoded.digest, payload: decoded.payload });
  }
  const digest = await sha256(signature(canonicalFiles), subtle);
  if (digest !== wrapper.digest) allowanceFail("ALLOWANCE_CHECKSUM");
  return Object.freeze({
    bundle: captureAllowanceBundle(records), digest,
    checksumVerified: true, authenticated: false,
  });
}
export async function readAllowanceBundle(file, options) {
  if (!file || typeof file.name !== "string" || file.name.length > 240 ||
      !/\.json$/i.test(file.name) || /[\\/\u0000-\u001f\u007f]/.test(file.name)) allowanceFail("ALLOWANCE_FILENAME");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > ALLOWANCE_BUNDLE_LIMIT) allowanceFail("ALLOWANCE_FILE_SIZE");
  const size = file.size;
  let bytes;
  try { bytes = await file.arrayBuffer(); }
  catch { allowanceFail("ALLOWANCE_FILE_READ"); }
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== size) allowanceFail("ALLOWANCE_FILE_SIZE");
  return decodeAllowanceBundle(new Uint8Array(bytes), options);
}
