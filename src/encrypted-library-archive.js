import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";
import { ENCRYPTED_LIBRARY_SCHEMA, validateEncryptedLibrary, verifyEncryptedLibrary,
  libraryFail } from "./encrypted-library-model.js";

export const ENCRYPTED_ARCHIVE_SCHEMA = "threecore-encrypted-library-archive-v1";
export const ENCRYPTED_ARCHIVE_LIMIT = 32 * 1024 * 1024;
export const ENCRYPTED_ARCHIVE_FILENAME = "ThreeCore-encrypted-library.json";

/** A portable set of already encrypted envelopes. No credentials or plaintext workspace. */
export async function decodeEncryptedArchive(text, options) {
  let value;
  try {
    boundedUtf8Length(text, ENCRYPTED_ARCHIVE_LIMIT);
    value = parseSecurityJson(text, { bytes: ENCRYPTED_ARCHIVE_LIMIT, depth: 5, nodes: 128,
      keyCharacters: 32, stringCharacters: 12 * 1024 * 1024, numberCharacters: 16 });
  } catch { libraryFail("LIBRARY_FORMAT"); }
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 2 || value.schema !== ENCRYPTED_ARCHIVE_SCHEMA ||
      !Object.hasOwn(value, "entries")) libraryFail("LIBRARY_FORMAT");
  return verifyEncryptedLibrary({ schema: ENCRYPTED_LIBRARY_SCHEMA,
    revision: 0, entries: value.entries }, options);
}

export async function prepareEncryptedArchive(input, options) {
  const value = await verifyEncryptedLibrary(input, options);
  const text = JSON.stringify({ schema: ENCRYPTED_ARCHIVE_SCHEMA, entries: value.entries });
  boundedUtf8Length(text, ENCRYPTED_ARCHIVE_LIMIT);
  return Object.freeze({ text, byteLength: text.length,
    filename: ENCRYPTED_ARCHIVE_FILENAME, mimeType: "application/json;charset=utf-8" });
}

export function describeLibraryMerge(current, incoming) {
  const before = validateEncryptedLibrary(current), from = validateEncryptedLibrary(incoming);
  let added = 0, duplicates = 0, addedBytes = 0;
  for (const entry of from.entries) {
    const existing = before.entries.find(value => value.id === entry.id);
    if (existing) {
      if (existing.text !== entry.text) libraryFail("LIBRARY_INTEGRITY");
      duplicates++;
    } else { added++; addedBytes += entry.bytes; }
  }
  return Object.freeze({ added, duplicates, addedBytes, total: before.entries.length + added,
    incoming: from.entries.length });
}
