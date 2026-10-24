import { parseSecurityJson } from "./security-json.js";
import { CHECKPOINT_SCHEMA, CHECKPOINT_TOTAL_BYTES, checkpointFail,
  validateCheckpointDocument, mutateCheckpoints, checkpointMetadata } from "./checkpoint-model.js";
import { decodeWorkspaceFile } from "./workspace-file.js";

export const CHECKPOINT_TRANSFER_SCHEMA = "threecore-checkpoint-collection-v1";
export const CHECKPOINT_TRANSFER_LIMIT = 32 * 1024 * 1024;

function canonical(entries) {
  return JSON.stringify({ schema: CHECKPOINT_SCHEMA, revision: 0,
    entries: validateCheckpointDocument({ schema: CHECKPOINT_SCHEMA, revision: 0, entries }).entries });
}

async function digest(text, subtle = globalThis.crypto?.subtle) {
  if (!subtle || typeof subtle.digest !== "function") checkpointFail("CHECKPOINT_CRYPTO");
  try {
    const bytes = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(text)));
    if (bytes.length !== 32) checkpointFail("CHECKPOINT_CRYPTO");
    return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  } catch { checkpointFail("CHECKPOINT_CRYPTO"); }
}

async function verifyEntries(entries, subtle) {
  // Do not release a partial import when a later entry is damaged.
  for (const entry of entries) await decodeWorkspaceFile(new TextEncoder().encode(entry.fileText), { subtle });
}

export async function prepareCheckpointCollection(input, { subtle } = {}) {
  const document = validateCheckpointDocument(input);
  await verifyEntries(document.entries, subtle);
  const payload = canonical(document.entries);
  const checksum = await digest(payload, subtle);
  const text = JSON.stringify({ schema: CHECKPOINT_TRANSFER_SCHEMA, algorithm: "SHA-256",
    digest: checksum, entries: document.entries }, null, 2);
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > CHECKPOINT_TRANSFER_LIMIT) checkpointFail("CHECKPOINT_TRANSFER_SIZE");
  return Object.freeze({ text, byteLength, filename: "ThreeCore-saved-checkpoints.json",
    mimeType: "application/json;charset=utf-8", digest: checksum });
}

export async function decodeCheckpointCollection(text, { subtle } = {}) {
  if (typeof text !== "string" || !text.length || text.length > CHECKPOINT_TRANSFER_LIMIT ||
      new TextEncoder().encode(text).byteLength > CHECKPOINT_TRANSFER_LIMIT) checkpointFail("CHECKPOINT_TRANSFER_SIZE");
  let value;
  try { value = parseSecurityJson(text); } catch { checkpointFail("CHECKPOINT_TRANSFER_JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 4 || !["schema", "algorithm", "digest", "entries"].every(key => Object.hasOwn(value, key)) ||
      value.schema !== CHECKPOINT_TRANSFER_SCHEMA || value.algorithm !== "SHA-256" ||
      typeof value.digest !== "string" || !/^[0-9a-f]{64}$/.test(value.digest)) checkpointFail("CHECKPOINT_TRANSFER_SCHEMA");
  const validated = validateCheckpointDocument({ schema: CHECKPOINT_SCHEMA, revision: 0, entries: value.entries });
  if (checkpointMetadata(validated).totalBytes > CHECKPOINT_TOTAL_BYTES) checkpointFail("CHECKPOINT_CAPACITY");
  if (await digest(canonical(validated.entries), subtle) !== value.digest) checkpointFail("CHECKPOINT_TRANSFER_CHECKSUM");
  await verifyEntries(validated.entries, subtle);
  return Object.freeze({ entries: validated.entries, checksumVerified: true, authenticated: false });
}

export function reviewCheckpointImport(current, incoming) {
  const before = validateCheckpointDocument(current);
  const after = mutateCheckpoints(before, before.revision, { kind: "import", entries: incoming });
  const original = new Set(before.entries.map(entry => entry.id));
  const added = after.entries.filter(entry => !original.has(entry.id));
  const skipped = incoming.filter(entry => original.has(entry.id));
  return Object.freeze({ revision: before.revision, beforeCount: before.entries.length,
    afterCount: after.entries.length, added: checkpointMetadata({ ...after, entries: added }).entries,
    skipped: Object.freeze(skipped.map(entry => entry.id)), removesExisting: false });
}

export function describeCheckpointImport(review) {
  const lines = ["控え一覧への追加予定", "保存件数: " + review.beforeCount + " → " + review.afterCount,
    "同じID・同じ内容の既存控え: " + review.skipped.length + "件（既存の名前・保管状態を保持）"];
  for (const entry of review.added) lines.push(entry.label + " / " + entry.createdAt + " / " +
    (entry.archived ? "保管中" : "使用中"));
  lines.push("既存の控えは上書き・削除しません。ウォレット画面の設定や履歴は変更しません。");
  return lines.join("\n");
}

/** Bounded file read; cancellation also suppresses a late arrayBuffer completion. */
export function createCheckpointCollectionReader({ readBytes = async file => new Uint8Array(await file.arrayBuffer()) } = {}) {
  let generation = 0;
  let disposed = false;
  return Object.freeze({
    async read(file) {
      const token = ++generation;
      if (disposed) checkpointFail("CHECKPOINT_CANCELLED");
      if (!file || typeof file.name !== "string" || !/\.json$/i.test(file.name) ||
          /[\\/\u0000-\u001f]/.test(file.name)) checkpointFail("CHECKPOINT_TRANSFER_FILE");
      if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > CHECKPOINT_TRANSFER_LIMIT) checkpointFail("CHECKPOINT_TRANSFER_SIZE");
      let bytes;
      try { bytes = await readBytes(file); }
      catch { checkpointFail(disposed || token !== generation ? "CHECKPOINT_CANCELLED" : "CHECKPOINT_TRANSFER_READ"); }
      if (disposed || token !== generation) checkpointFail("CHECKPOINT_CANCELLED");
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== file.size) checkpointFail("CHECKPOINT_TRANSFER_SIZE");
      try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { checkpointFail("CHECKPOINT_TRANSFER_ENCODING"); }
    },
    cancel() { generation++; },
    dispose() { generation++; disposed = true; },
  });
}
