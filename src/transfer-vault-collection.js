import { shape, transferFail } from "./transfer-codec.js";
import { VAULT_DOCUMENT_SCHEMA, validateVaultDocument, mutateVaultDocument, vaultMetadata } from "./transfer-vault-model.js";

export const VAULT_COLLECTION_SCHEMA = "threecore.transfer-vault-collection.v1";
export const VAULT_COLLECTION_LIMIT = 40 * 1024 * 1024;
const encoder = new TextEncoder();

function portable(input) {
  const document = validateVaultDocument(input);
  return validateVaultDocument({ schema: VAULT_DOCUMENT_SCHEMA, revision: 0, entries: document.entries });
}
function checkSize(text) {
  if (typeof text !== "string" || !text.length || text.length > VAULT_COLLECTION_LIMIT ||
      encoder.encode(text).byteLength > VAULT_COLLECTION_LIMIT) transferFail("TRANSFER_VAULT_COLLECTION_SIZE");
}
async function checksum(document, subtle) {
  if (!subtle || typeof subtle.digest !== "function") transferFail("TRANSFER_CRYPTO_UNAVAILABLE");
  let result;
  try { result = await subtle.digest("SHA-256", encoder.encode(JSON.stringify(document))); }
  catch { transferFail("TRANSFER_CRYPTO_FAILED"); }
  if (!(result instanceof ArrayBuffer) || result.byteLength !== 32) transferFail("TRANSFER_CRYPTO_FAILED");
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Includes archived records. Browser revision is intentionally not portable. */
export async function prepareVaultCollection(input, { subtle = globalThis.crypto?.subtle } = {}) {
  const document = portable(input);
  if (!document.entries.length) transferFail("TRANSFER_VAULT_EMPTY");
  const digest = await checksum(document, subtle);
  const text = JSON.stringify({ schema: VAULT_COLLECTION_SCHEMA, algorithm: "SHA-256", digest, document }, null, 2) + "\n";
  checkSize(text);
  return Object.freeze({ text, digest, byteLength: encoder.encode(text).byteLength, authenticated: false,
    filename: "ThreeCore-transfer-vault-collection.json", mimeType: "application/json;charset=utf-8" });
}

export async function decodeVaultCollection(text, { subtle = globalThis.crypto?.subtle } = {}) {
  checkSize(text);
  let envelope;
  try { envelope = JSON.parse(text); }
  catch { transferFail("TRANSFER_FILE_JSON"); }
  shape(envelope, ["schema", "algorithm", "digest", "document"]);
  if (envelope.schema !== VAULT_COLLECTION_SCHEMA || envelope.algorithm !== "SHA-256" ||
      typeof envelope.digest !== "string" || !/^[a-f0-9]{64}$/.test(envelope.digest)) transferFail("TRANSFER_VAULT_COLLECTION_SCHEMA");
  const document = portable(envelope.document);
  if (envelope.document.revision !== 0 || !document.entries.length) transferFail("TRANSFER_VAULT_COLLECTION_SCHEMA");
  if (await checksum(document, subtle) !== envelope.digest) transferFail("TRANSFER_CHECKSUM_MISMATCH");
  return Object.freeze({ document, digest: envelope.digest, authenticated: false });
}

export async function readVaultCollection(file, options) {
  if (!file || typeof file.name !== "string" || file.name.length > 180 || !/\.json$/i.test(file.name) ||
      /[/\\\u0000-\u001f\u007f]/.test(file.name)) transferFail("TRANSFER_FILE_NAME");
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > VAULT_COLLECTION_LIMIT ||
      typeof file.arrayBuffer !== "function") transferFail("TRANSFER_VAULT_COLLECTION_SIZE");
  let buffer;
  try { buffer = await file.arrayBuffer(); }
  catch { transferFail("TRANSFER_FILE_READ"); }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== file.size) transferFail("TRANSFER_VAULT_COLLECTION_SIZE");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch { transferFail("TRANSFER_FILE_ENCODING"); }
  return decodeVaultCollection(text, options);
}

export function reviewVaultCollection(current, incoming) {
  const before = validateVaultDocument(current), source = portable(incoming);
  const after = mutateVaultDocument(before, before.revision, { kind: "import", entries: source.entries });
  const added = source.entries.filter(row => !before.entries.some(existing => existing.id === row.id));
  return Object.freeze({ expectedRevision: before.revision, entries: source.entries,
    additions: added.length, duplicates: source.entries.length - added.length,
    archivedAdditions: added.filter(row => row.archived).length, after: vaultMetadata(after) });
}

export function vaultCollectionReviewText(review) {
  if (!review) return "";
  return [`保存一覧への追加: ${review.additions}件（うち非表示保管${review.archivedAdditions}件）`,
    `完全に一致する既存の記録: ${review.duplicates}件（重複追加しません）`,
    `追加後: ${review.after.count} / 5件、${review.after.bytes} bytes`,
    "既存の記録は上書きしません。同じ保存番号の内容が異なる場合は取り込めません。",
    "この操作はPC内の保存一覧を変更します。現在の作業用コピーとWalletの設定は変更しません。"].join("\n");
}
