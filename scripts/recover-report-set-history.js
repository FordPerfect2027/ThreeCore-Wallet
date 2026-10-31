#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportSetFile, REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { prepareReportSetHistoryFile } from "../src/report-set-export.js";
const USAGE = "Usage: node scripts/recover-report-set-history.js source-set.json\n" +
  "Verifies the source checksum and emits its original report-history entries, including notes and archive flags, to stdout.\n" +
  "Contains full unencrypted addresses, balances, history and notes. Entries absent from the set cannot be recovered.\n" +
  "No network, imports or source writes. Exit 0 means recovery, not current-chain verification; exit 1 means invalid input.\n";
export function parseSetHistoryArgs(args) {
  if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== "string" || !args[0] || args[0].startsWith("-") || !/\.json$/i.test(args[0]) || args[0].includes("\0")) throw Error("PERIOD_SET_HISTORY_CLI_ARGUMENTS");
  return Object.freeze({ path: args[0] });
}
export async function runSetHistoryRecovery(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseSetHistoryArgs(args);
    const source = await decodeReportSetFile(await readBoundedVaultPath(request.path, REPORT_SET_FILE_LIMIT));
    const file = await prepareReportSetHistoryFile(source.input);
    stdout.write(file.text); return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "PERIOD_SET_HISTORY_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runSetHistoryRecovery(process.argv.slice(2));
