#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportSetFile, REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { prepareReportSetTokenLibraryFile } from "../src/report-set-export.js";
const USAGE = "Usage: node scripts/recover-report-set-token-library.js source-set.json --agent DAT|EMA|CAWELON\n" +
  "Verifies the set checksum, keeps original entries and restriction flags, and emits a period-library JSON to stdout.\n" +
  "Contains all original addresses and events for that token. Conflicting IDs or excess capacity refuse the entire export.\n" +
  "No network, imports or writes. Exit 0 means extraction, not complete history; exit 1 means invalid or unrecoverable input.\n";
export function parseSetLibraryArgs(args) {
  if (!Array.isArray(args) || args.length !== 3 || args.some(value => typeof value !== "string") ||
      !args[0] || args[0].startsWith("-") || !/\.json$/i.test(args[0]) || args[0].includes("\0") ||
      args[1] !== "--agent" || !["DAT", "EMA", "CAWELON"].includes(args[2])) throw Error("PERIOD_SET_LIBRARY_CLI_ARGUMENTS");
  return Object.freeze({ path: args[0], agent: args[2] });
}
export async function runSetLibraryRecovery(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseSetLibraryArgs(args);
    const source = await decodeReportSetFile(await readBoundedVaultPath(request.path, REPORT_SET_FILE_LIMIT));
    const file = await prepareReportSetTokenLibraryFile(source.input, request.agent), info = file.recovery;
    stdout.write(file.text);
    stderr.write("Recovered " + info.entryCount + " original " + info.agent + " entries; " + info.missingReports + " reports lacked this token; " + info.duplicateReferences + " identical references collapsed. No import performed.\n");
    return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "PERIOD_SET_LIBRARY_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runSetLibraryRecovery(process.argv.slice(2));
