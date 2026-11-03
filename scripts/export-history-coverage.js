#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportSetFile, REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { prepareReportSetCoverageFile } from "../src/report-set-export.js";

const USAGE = "Usage: node scripts/export-history-coverage.js source.json [--format json|csv] [--full-addresses] [--require-continuous]\n" +
  "Verifies the source checksum and exports every account/chain/token group, including pending and unplanned spans. No network or input-file writes.\n" +
  "Block ranges are inclusive. Record indices are zero-based; each event count belongs to the original query window, not a split cell.\n" +
  "CSV separates source-summary, group-summary and range rows. Do not sum summaries with ranges, or combine different token/account/chain groups.\n" +
  "Structured addresses are shortened by default; labels may contain addresses. No note bodies, balances or event bodies are copied.\n" +
  "Output describes saved query presence, not complete chain history or a restorable backup. Exit 0: exported; 2: --require-continuous failed; 1: invalid input.\n";
const fail = () => { throw Error("HISTORY_COVERAGE_CLI_ARGUMENTS"); };
export function parseCoverageExportArgs(args) {
  if (!Array.isArray(args) || args.length < 1 || args.length > 5 || args.some(value => typeof value !== "string") ||
      !args[0] || args[0].startsWith("-") || !/\.json$/i.test(args[0]) || args[0].includes("\0")) fail();
  const flags = new Map();
  for (let i = 1; i < args.length;) {
    const flag = args[i++];
    if (!["--format", "--full-addresses", "--require-continuous"].includes(flag) || flags.has(flag)) fail();
    if (flag === "--format") { if (i === args.length) fail(); flags.set(flag, args[i++]); }
    else flags.set(flag, true);
  }
  const format = flags.get("--format") ?? "json";
  if (!["json", "csv"].includes(format)) fail();
  return Object.freeze({ path: args[0], format, options: Object.freeze({ shortAddresses: !flags.has("--full-addresses") }),
    requireContinuous: flags.has("--require-continuous") });
}
export async function runCoverageExport(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseCoverageExportArgs(args);
    const source = await decodeReportSetFile(await readBoundedVaultPath(request.path, REPORT_SET_FILE_LIMIT));
    const file = await prepareReportSetCoverageFile(source.input, request.format, request.options);
    stdout.write(file.text);
    if (request.requireContinuous && !file.allContinuous) { stderr.write("HISTORY_COVERAGE_CLI_NOT_CONTINUOUS\n"); return 2; }
    return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(HISTORY_COVERAGE_CLI|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code)
      ? code : "HISTORY_COVERAGE_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runCoverageExport(process.argv.slice(2));
