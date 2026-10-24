import { inspectEncryptedBackup, encodeBackupBase64 } from "./secure-backup-format.js";

export const ENCRYPTED_LIBRARY_SCHEMA = "threecore-encrypted-library-v1";
export const ENCRYPTED_LIBRARY_COUNT = 10;
export const ENCRYPTED_LIBRARY_BYTES = 24 * 1024 * 1024;
// Only objects created and deeply frozen by this module can skip repeated parsing.
// Weak references do not retain cleared ciphertext or trust caller-frozen input.
const validatedEntries = new WeakSet();
const validatedDocuments = new WeakSet();
export const ENCRYPTED_LIBRARY_CODES = Object.freeze([
  "LIBRARY_FORMAT", "LIBRARY_CAPACITY", "LIBRARY_CONFLICT", "LIBRARY_SELECTION",
  "LIBRARY_CRYPTO", "LIBRARY_INTEGRITY", "LIBRARY_UNAVAILABLE", "LIBRARY_QUOTA",
  "LIBRARY_BLOCKED", "LIBRARY_TIMEOUT", "LIBRARY_CLOSED", "LIBRARY_CANCELLED",
  "LIBRARY_STORAGE", "LIBRARY_REVIEW", "LIBRARY_BUSY", "LIBRARY_CONFIRM",
  "LIBRARY_EXPORT", "LIBRARY_STAGE", "LIBRARY_INTERNAL",
]);

export class EncryptedLibraryError extends Error {
  constructor(code) {
    const safe = ENCRYPTED_LIBRARY_CODES.includes(code) ? code : "LIBRARY_INTERNAL";
    super(safe);
    this.name = "EncryptedLibraryError";
    this.code = safe;
  }
}
export function libraryFail(code) { throw new EncryptedLibraryError(code); }
export function libraryErrorCode(error) {
  return error instanceof EncryptedLibraryError ? error.code : "LIBRARY_INTERNAL";
}

function object(value, fields) {
  if (!value || typeof value !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).length !== fields.length) libraryFail("LIBRARY_FORMAT");
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) libraryFail("LIBRARY_FORMAT");
  }
}
function integer(value, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) libraryFail("LIBRARY_FORMAT");
}
export function libraryId(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) libraryFail("LIBRARY_SELECTION");
  return value;
}

/** Canonical envelope only: plaintext files and arbitrary extra fields are refused. */
export function canonicalLibraryText(text) {
  let inspected;
  try {
    inspected = inspectEncryptedBackup(text);
    return JSON.stringify({ ...inspected.header, ciphertext: encodeBackupBase64(inspected.ciphertext) });
  } catch { libraryFail("LIBRARY_FORMAT"); }
  finally {
    inspected?.salt.fill(0);
    inspected?.iv.fill(0);
    inspected?.ciphertext.fill(0);
    inspected?.additionalData.fill(0);
  }
}

export function validateLibraryEntry(input) {
  if (validatedEntries.has(input)) return input;
  object(input, ["id", "savedAt", "bytes", "text"]);
  libraryId(input.id);
  integer(input.savedAt, 1);
  // Time is descriptive local metadata, not an authenticated creation time.
  if (input.savedAt > 8640000000000000) libraryFail("LIBRARY_FORMAT");
  integer(input.bytes, 1);
  const text = canonicalLibraryText(input.text);
  if (text !== input.text || input.bytes !== text.length) libraryFail("LIBRARY_FORMAT");
  const result = Object.freeze({ id: input.id, savedAt: input.savedAt, bytes: input.bytes, text });
  validatedEntries.add(result);
  return result;
}

export function emptyEncryptedLibrary() {
  const result = Object.freeze({ schema: ENCRYPTED_LIBRARY_SCHEMA, revision: 0, entries: Object.freeze([]) });
  validatedDocuments.add(result);
  return result;
}

export function validateEncryptedLibrary(input) {
  if (validatedDocuments.has(input)) return input;
  object(input, ["schema", "revision", "entries"]);
  if (input.schema !== ENCRYPTED_LIBRARY_SCHEMA) libraryFail("LIBRARY_FORMAT");
  integer(input.revision);
  const values = input.entries;
  if (!Array.isArray(values) || values.length > ENCRYPTED_LIBRARY_COUNT ||
      Reflect.ownKeys(values).length !== values.length + 1) libraryFail("LIBRARY_CAPACITY");
  const entries = [], ids = new Set();
  let bytes = 0;
  for (let i = 0; i < values.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(values, String(i));
    if (!descriptor || !("value" in descriptor)) libraryFail("LIBRARY_FORMAT");
    const entry = validateLibraryEntry(descriptor.value);
    if (ids.has(entry.id)) libraryFail("LIBRARY_FORMAT");
    ids.add(entry.id);
    bytes += entry.bytes;
    if (bytes > ENCRYPTED_LIBRARY_BYTES) libraryFail("LIBRARY_CAPACITY");
    entries.push(entry);
  }
  const result = Object.freeze({ schema: ENCRYPTED_LIBRARY_SCHEMA, revision: input.revision,
    entries: Object.freeze(entries) });
  validatedDocuments.add(result);
  return result;
}

/** Exact comparison also detects content edits with an unchanged revision. */
export function sameEncryptedLibrary(left, right) {
  const a = validateEncryptedLibrary(left), b = validateEncryptedLibrary(right);
  return a.revision === b.revision && a.entries.length === b.entries.length &&
    a.entries.every((entry, i) => {
      const other = b.entries[i];
      return entry.id === other.id && entry.savedAt === other.savedAt &&
        entry.bytes === other.bytes && entry.text === other.text;
    });
}

/** Invoked synchronously inside the database read/write transaction. No crypto awaits. */
export function mutateEncryptedLibrary(input, expected, operation) {
  const current = validateEncryptedLibrary(input);
  if (!sameEncryptedLibrary(current, expected)) libraryFail("LIBRARY_CONFLICT");
  const kind = operation && Object.getOwnPropertyDescriptor(operation, "kind")?.value;
  object(operation, kind === "add" ? ["kind", "entry"] : kind === "merge" ? ["kind", "entries"] : ["kind", "id"]);
  let entries;
  if (operation.kind === "add") {
    const entry = validateLibraryEntry(operation.entry);
    const existing = current.entries.find(value => value.id === entry.id);
    if (existing) {
      if (existing.text !== entry.text) libraryFail("LIBRARY_INTEGRITY");
      return current; // Same ciphertext is never stored twice or silently replaced.
    }
    entries = [...current.entries, entry];
  } else if (operation.kind === "merge") {
    const incoming = validateEncryptedLibrary({ schema: ENCRYPTED_LIBRARY_SCHEMA,
      revision: 0, entries: operation.entries });
    entries = [...current.entries];
    for (const entry of incoming.entries) {
      const existing = entries.find(value => value.id === entry.id);
      if (existing && existing.text !== entry.text) libraryFail("LIBRARY_INTEGRITY");
      if (!existing) entries.push(entry);
    }
    if (entries.length === current.entries.length) return current;
  } else if (operation.kind === "remove") {
    const id = libraryId(operation.id);
    if (!current.entries.some(entry => entry.id === id)) libraryFail("LIBRARY_SELECTION");
    entries = current.entries.filter(entry => entry.id !== id);
  } else libraryFail("LIBRARY_FORMAT");
  if (current.revision === Number.MAX_SAFE_INTEGER) libraryFail("LIBRARY_CAPACITY");
  return validateEncryptedLibrary({ schema: ENCRYPTED_LIBRARY_SCHEMA,
    revision: current.revision + 1, entries });
}

export function encryptedLibrarySummary(input) {
  const document = validateEncryptedLibrary(input);
  return Object.freeze({ revision: document.revision, count: document.entries.length,
    bytes: document.entries.reduce((sum, value) => sum + value.bytes, 0),
    maxCount: ENCRYPTED_LIBRARY_COUNT, maxBytes: ENCRYPTED_LIBRARY_BYTES,
    entries: Object.freeze(document.entries.map(({ id, savedAt, bytes }) =>
      Object.freeze({ id, savedAt, bytes }))) });
}

export async function encryptedTextDigest(text, { crypto = globalThis.crypto } = {}) {
  const canonical = canonicalLibraryText(text);
  const bytes = new TextEncoder().encode(canonical);
  try {
    if (typeof crypto?.subtle?.digest !== "function") libraryFail("LIBRARY_CRYPTO");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) libraryFail("LIBRARY_CRYPTO");
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  } catch { libraryFail("LIBRARY_CRYPTO"); }
  finally { bytes.fill(0); }
}

export async function prepareLibraryEntry(text, { now = Date.now, crypto = globalThis.crypto } = {}) {
  const canonical = canonicalLibraryText(text);
  const savedAt = now();
  integer(savedAt, 1);
  const id = await encryptedTextDigest(canonical, { crypto });
  return validateLibraryEntry({ id, savedAt, bytes: canonical.length, text: canonical });
}

export async function verifyLibraryEntry(input, options) {
  const entry = validateLibraryEntry(input);
  if (await encryptedTextDigest(entry.text, options) !== entry.id) libraryFail("LIBRARY_INTEGRITY");
  return entry;
}

/** Digest detects local damage, not a malicious writer able to replace both fields. */
export async function verifyEncryptedLibrary(input, { crypto = globalThis.crypto, guard = () => true } = {}) {
  const document = validateEncryptedLibrary(input);
  for (const entry of document.entries) {
    if (guard() !== true) libraryFail("LIBRARY_CANCELLED");
    await verifyLibraryEntry(entry, { crypto });
    if (guard() !== true) libraryFail("LIBRARY_CANCELLED");
  }
  return document;
}
