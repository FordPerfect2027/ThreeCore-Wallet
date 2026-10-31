#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportSetFile, REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { reviewReportSetComparisonFile, REPORT_SET_COMPARISON_LIMIT } from "../src/report-set-export.js";

const USAGE = "Usage: node scripts/verify-report-set-comparison.js before.json after.json comparison.json [--json]\n" +
  "Verifies both original checksums and recomputes the saved comparison. File order matters. No network or file writes.\n" +
  "Exit 0: comparison matches; 2: differences; 1: invalid input/read failure. Matching does not mean the originals are equal, authentic or current.\n";
export function parseComparisonReviewArgs(args) {
  if (!Array.isArray(args) || ![3, 4].includes(args.length) || args.some(value => typeof value !== "string") ||
      args.slice(0, 3).some(value => !value || value.startsWith("-") || !/\.json$/i.test(value) || value.includes("\0")) ||
      (args.length === 4 && args[3] !== "--json")) throw Error("SET_COMPARISON_REVIEW_CLI_ARGUMENTS");
  return Object.freeze({ before: args[0], after: args[1], comparison: args[2], json: args.length === 4 });
}
export async function runComparisonReview(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseComparisonReviewArgs(args);
    const before = await decodeReportSetFile(await readBoundedVaultPath(request.before, REPORT_SET_FILE_LIMIT));
    const after = await decodeReportSetFile(await readBoundedVaultPath(request.after, REPORT_SET_FILE_LIMIT));
    const text = await readBoundedVaultPath(request.comparison, REPORT_SET_COMPARISON_LIMIT);
    const review = await reviewReportSetComparisonFile(before.input, after.input, text);
    const result = Object.freeze({ ...review, beforeChecksumVerified: true, afterChecksumVerified: true });
    stdout.write(request.json ? JSON.stringify(result, null, 2) + "\n" :
      "ThreeCore saved comparison: " + (result.matchesRecomputation ? "MATCH" : "DIFFERENCES") + "\n" +
      "Before / after digest matches: " + result.beforeDigestMatches + " / " + result.afterDigestMatches + "\n" +
      "Original set contents identical: " + result.sameContents + "\n" +
      "Differing fields: " + (result.differences.join(", ") || "none") + "\n" +
      "Unexpected top-level fields: " + result.unexpectedFields + "\n" +
      "Both original checksums verified; saved evidence only, not authorship or live-chain verification.\n");
    return result.matchesRecomputation ? 0 : 2;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(SET_COMPARISON_REVIEW_CLI|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code)
      ? code : "SET_COMPARISON_REVIEW_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runComparisonReview(process.argv.slice(2));
