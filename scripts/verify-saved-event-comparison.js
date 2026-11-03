#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportSetFile, REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { reviewReportSetEventComparisonFile, REPORT_SET_EVENT_COMPARISON_LIMIT } from "../src/report-set-export.js";
const USAGE = "Usage: node scripts/verify-saved-event-comparison.js source-set.json comparison.json [--json]\n" +
  "Recomputes the saved comparison's stated pair and token against its original source. No network or file writes.\n" +
  "Exit 0: file matches recomputation; 2: file differs; 1: invalid input. Exit 0 does not mean the compared event observations agree.\n";
export function parseEventReviewArgs(args) {
  if (!Array.isArray(args) || ![2, 3].includes(args.length) || args.some(value => typeof value !== "string") ||
      args.slice(0, 2).some(value => !value || value.startsWith("-") || !/\.json$/i.test(value) || value.includes("\0")) ||
      (args.length === 3 && args[2] !== "--json")) throw Error("EVENT_REVIEW_CLI_ARGUMENTS");
  return Object.freeze({ source: args[0], comparison: args[1], json: args.length === 3 });
}
export async function runEventReview(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseEventReviewArgs(args);
    const source = await decodeReportSetFile(await readBoundedVaultPath(request.source, REPORT_SET_FILE_LIMIT));
    const text = await readBoundedVaultPath(request.comparison, REPORT_SET_EVENT_COMPARISON_LIMIT);
    const review = await reviewReportSetEventComparisonFile(source.input, text);
    const result = Object.freeze({ ...review, sourceChecksumVerified: true });
    stdout.write(request.json ? JSON.stringify(result, null, 2) + "\n" :
      "Saved event comparison file: " + (result.matchesRecomputation ? "MATCH" : "DIFFERENCES") + "\n" +
      "Source digest matches: " + result.sourceDigestMatches + "\n" +
      "Recomputed observation comparison: " + result.comparisonStatus + "\n" +
      "Differing fields: " + (result.differences.join(", ") || "none") + "\n" +
      "Unexpected top-level fields: " + result.unexpectedFields + "\n" +
      "Source checksum verified; historical comparison, not authorship or live-chain verification.\n");
    return result.matchesRecomputation ? 0 : 2;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(EVENT_REVIEW_CLI|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "EVENT_REVIEW_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runEventReview(process.argv.slice(2));
