#!/usr/bin/env node
import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeEncryptedArchive, ENCRYPTED_ARCHIVE_LIMIT } from "../src/encrypted-library-archive.js";
import { encryptedLibrarySummary, libraryErrorCode, EncryptedLibraryError } from "../src/encrypted-library-model.js";

/** Offline inspection only. Does not request a password, decrypt, import or modify a file. */
export async function inspectEncryptedLibraryFile(path) {
  try {
    const bytes = await readBoundedLocalBytes(path, ENCRYPTED_ARCHIVE_LIMIT, {
      fail: code => { throw new EncryptedLibraryError(code); }, sizeCode: "LIBRARY_FORMAT", changedCode: "LIBRARY_CONFLICT",
    });
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return { ok: false, code: "LIBRARY_FORMAT" }; }
    finally { bytes.fill(0); }
    const value = await decodeEncryptedArchive(text);
    const summary = encryptedLibrarySummary(value);
    return { ok: true, encryptedFiles: summary.count, encryptedBytes: summary.bytes,
      passwordChecked: false, workspaceDecrypted: false, imported: false,
      note: "Envelope structure and ciphertext digests verified; password authentication has not been performed." };
  } catch (error) { return { ok: false, code: libraryErrorCode(error) }; }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0].startsWith("-")) {
    process.stderr.write("Usage: node scripts/check-encrypted-library.js <archive.json>\n");
    process.exitCode = 2;
  } else {
    const result = await inspectEncryptedLibraryFile(args[0]);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = result.ok ? 0 : 1;
  }
}
