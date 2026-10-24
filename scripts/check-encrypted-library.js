#!/usr/bin/env node
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeEncryptedArchive, ENCRYPTED_ARCHIVE_LIMIT } from "../src/encrypted-library-archive.js";
import { encryptedLibrarySummary, libraryErrorCode } from "../src/encrypted-library-model.js";

/** Offline inspection only. Does not request a password, decrypt, import or modify a file. */
export async function inspectEncryptedLibraryFile(path) {
  let handle;
  try {
    handle = await open(path, "r");
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > ENCRYPTED_ARCHIVE_LIMIT) {
      return { ok: false, code: "LIBRARY_FORMAT" };
    }
    const bytes = new Uint8Array(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (result.bytesRead < 1) return { ok: false, code: "LIBRARY_FORMAT" };
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) {
      return { ok: false, code: "LIBRARY_CONFLICT" };
    }
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
  finally { await handle?.close().catch(() => {}); }
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
