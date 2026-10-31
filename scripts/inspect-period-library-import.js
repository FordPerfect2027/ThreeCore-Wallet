#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodePeriodLibraryFile, PERIOD_LIBRARY_FILE_LIMIT } from "../src/period-library-file.js";
import { inspectPeriodLibraryImport } from "../src/period-library-model.js";
import { libraryImportInspectionText } from "../src/period-library-view.js";
const USAGE = "Usage: node scripts/inspect-period-library-import.js current.json incoming.json [--json]\n" +
  "Checks both file checksums and explains add-only import conflicts and capacity. No network, replacement or writes.\n" +
  "Exit 0: compatible snapshots; 2: conflict or capacity exceeded; 1: invalid input. Not an import or chain verification.\n";
export function parseLibraryInspectionArgs(args) {
  if (!Array.isArray(args) || ![2,3].includes(args.length) || args.some(value => typeof value !== "string") ||
      args.slice(0,2).some(value => !value || value.startsWith("-") || !/\.json$/i.test(value) || value.includes("\0")) ||
      (args.length === 3 && args[2] !== "--json")) throw Error("PERIOD_LIBRARY_CLI_ARGUMENTS");
  return Object.freeze({ before: args[0], incoming: args[1], json: args.length === 3 });
}
export async function runLibraryInspection(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseLibraryInspectionArgs(args);
    const before = await decodePeriodLibraryFile(await readBoundedVaultPath(request.before, PERIOD_LIBRARY_FILE_LIMIT));
    const incoming = await decodePeriodLibraryFile(await readBoundedVaultPath(request.incoming, PERIOD_LIBRARY_FILE_LIMIT));
    const result = inspectPeriodLibraryImport(before.document, incoming.document);
    stdout.write(request.json ? JSON.stringify({ ...result, sourceChecksumsVerified: true,
      beforeDigest: before.digest, incomingDigest: incoming.digest }, null, 2) + "\n" : libraryImportInspectionText(result) + "\n");
    return result.compatible ? 0 : 2;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "PERIOD_LIBRARY_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runLibraryInspection(process.argv.slice(2));
