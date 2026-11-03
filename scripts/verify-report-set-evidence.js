#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { reviewReportSetComparisonEvidence, REPORT_SET_COMPARISON_EVIDENCE_LIMIT } from "../src/report-set-export.js";
import { setComparisonEvidenceReviewText } from "../src/report-set-view.js";

const USAGE = "Usage: node scripts/verify-report-set-evidence.js evidence.json [--json]\n" +
  "Checks both embedded original checksums and recomputes the saved comparison. No external source files, network, imports or input writes.\n" +
  "Input contains full unencrypted original evidence. The returned review omits original notes, balances and events.\n" +
  "Exit 0: comparison matches; 2: comparison differs; 1: invalid input/read failure. Matching does not authenticate the source or recheck the chain.\n";
export function parseSetEvidenceArgs(args) {
  if (!Array.isArray(args) || ![1, 2].includes(args.length) || args.some(value => typeof value !== "string") ||
      !args[0] || args[0].startsWith("-") || !/\.json$/i.test(args[0]) || args[0].includes("\0") ||
      (args.length === 2 && args[1] !== "--json")) throw Error("SET_EVIDENCE_CLI_ARGUMENTS");
  return Object.freeze({ path: args[0], json: args.length === 2 });
}
export async function runSetEvidenceReview(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseSetEvidenceArgs(args);
    const text = await readBoundedVaultPath(request.path, REPORT_SET_COMPARISON_EVIDENCE_LIMIT);
    const result = await reviewReportSetComparisonEvidence(text);
    stdout.write(request.json ? JSON.stringify(result, null, 2) + "\n" : setComparisonEvidenceReviewText(result) + "\n");
    return result.comparisonReview.matchesRecomputation ? 0 : 2;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(SET_EVIDENCE_CLI|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code)
      ? code : "SET_EVIDENCE_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runSetEvidenceReview(process.argv.slice(2));
