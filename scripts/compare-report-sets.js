#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportSetFile, REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { prepareReportSetComparisonFile } from "../src/report-set-export.js";
import { setComparisonText } from "../src/report-set-view.js";

const USAGE = "Usage: node scripts/compare-report-sets.js before.json after.json [--json] [--require-same]\n" +
  "Both original checksums are verified. JSON reproduces the screen comparison receipt; text explains saved-evidence changes.\n" +
  "No network, merge or input-file writes. Names may contain public addresses; notes, event evidence and balance values are not copied as fields.\n" +
  "Exit 0 means comparison succeeded; --require-same exits 2 for any recorded set change, including metadata or order. Invalid inputs exit 1 without partial output.\n";
const fail = () => { throw Error("REPORT_SET_COMPARE_CLI_ARGUMENTS"); };
export function parseSetComparisonArgs(args) {
  if (!Array.isArray(args) || args.length < 2 || args.length > 4 || args.some(value => typeof value !== "string") ||
      args.slice(0, 2).some(value => !value || value.startsWith("-") || !/\.json$/i.test(value) || value.includes("\0"))) fail();
  const flags = args.slice(2);
  if (new Set(flags).size !== flags.length || flags.some(flag => !["--json", "--require-same"].includes(flag))) fail();
  return Object.freeze({ before: args[0], after: args[1], json: flags.includes("--json"), requireSame: flags.includes("--require-same") });
}
export async function runSetComparison(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseSetComparisonArgs(args);
    const before = await decodeReportSetFile(await readBoundedVaultPath(request.before, REPORT_SET_FILE_LIMIT));
    const after = await decodeReportSetFile(await readBoundedVaultPath(request.after, REPORT_SET_FILE_LIMIT));
    const file = await prepareReportSetComparisonFile(before.input, after.input), data = JSON.parse(file.text);
    stdout.write(request.json ? file.text : setComparisonText(data.comparison) +
      "\nBefore payload SHA-256: " + data.beforePayloadDigest + "\nAfter payload SHA-256: " + data.afterPayloadDigest +
      "\nOriginal checksums verified; source authenticity and current chain state remain unverified.\n");
    if (request.requireSame && !data.comparison.sameContents) { stderr.write("REPORT_SET_COMPARE_CLI_DIFFERENT\n"); return 2; }
    return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(REPORT_SET_COMPARE_CLI|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code)
      ? code : "REPORT_SET_COMPARE_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runSetComparison(process.argv.slice(2));
