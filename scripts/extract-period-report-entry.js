#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodePeriodReportFile, preparePeriodReportEntryFile, PERIOD_REPORT_FILE_LIMIT } from "../src/period-report-file.js";
const USAGE = "Usage: node extract-period-report-entry.js report.json --agent DAT|EMA|CAWELON\n" +
  "Verifies the report checksum and writes one complete original entry in period-library JSON to stdout.\n" +
  "Includes unencrypted addresses, balances, events and archive/replan markers. No network, imports or input writes.\n" +
  "Exit 0 means extraction succeeded, not that the record is complete, unrestricted or verified on chain.\n";
export function parseExtractPeriodEntryArgs(args) {
  if (!Array.isArray(args) || args.length !== 3 || args.some(value => typeof value !== "string") ||
      !args[0] || args[0].startsWith("-") || !/\.json$/i.test(args[0]) || args[0].includes("\0") ||
      args[1] !== "--agent" || !["DAT", "EMA", "CAWELON"].includes(args[2])) throw Error("PERIOD_ENTRY_CLI_ARGUMENTS");
  return Object.freeze({ path: args[0], agent: args[2] });
}
export async function runExtractPeriodEntry(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseExtractPeriodEntryArgs(args);
    const source = await decodePeriodReportFile(await readBoundedVaultPath(request.path, PERIOD_REPORT_FILE_LIMIT));
    const file = await preparePeriodReportEntryFile(source.input, request.agent);
    stdout.write(file.text); return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "PERIOD_ENTRY_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runExtractPeriodEntry(process.argv.slice(2));
