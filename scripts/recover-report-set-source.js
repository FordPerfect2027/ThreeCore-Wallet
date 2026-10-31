#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { reviewReportSetComparisonEvidence, prepareComparisonEvidenceSourceFile,
  REPORT_SET_COMPARISON_EVIDENCE_LIMIT } from "../src/report-set-export.js";

const USAGE = "Usage: node scripts/recover-report-set-source.js evidence.json --source before|after\n" +
  "Verifies the entire bundle, then writes the selected original JSON to stdout. No network, imports or input writes.\n" +
  "Output includes full unencrypted original addresses, balances, history and notes. Redirect it only to an intended local file.\n" +
  "Exit 0: original recovered and comparison matches; 2: original recovered but comparison differs; 1: invalid input with no original output.\n";
export function parseRecoverSetSourceArgs(args) {
  if (!Array.isArray(args) || args.length !== 3 || args.some(value => typeof value !== "string") ||
      !args[0] || args[0].startsWith("-") || !/\.json$/i.test(args[0]) || args[0].includes("\0") ||
      args[1] !== "--source" || !["before", "after"].includes(args[2])) throw Error("SET_SOURCE_CLI_ARGUMENTS");
  return Object.freeze({ path: args[0], role: args[2] });
}
export async function runRecoverSetSource(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseRecoverSetSourceArgs(args);
    const text = await readBoundedVaultPath(request.path, REPORT_SET_COMPARISON_EVIDENCE_LIMIT);
    const review = await reviewReportSetComparisonEvidence(text);
    const file = prepareComparisonEvidenceSourceFile(review, request.role);
    stdout.write(file.text);
    if (!file.comparisonMatchesRecomputation) {
      stderr.write("SET_SOURCE_CLI_COMPARISON_DIFFERS: selected original recovered; recorded comparison still differs.\n");
      return 2;
    }
    return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(SET_SOURCE_CLI|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code)
      ? code : "SET_SOURCE_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runRecoverSetSource(process.argv.slice(2));
