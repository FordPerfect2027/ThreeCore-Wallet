#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportSetFile, REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { reviewReportSetCoverageFile, REPORT_SET_COVERAGE_LIMIT } from "../src/report-set-export.js";
const USAGE = "Usage: node scripts/verify-history-coverage.js source-set.json coverage.json [--json]\n" +
  "Recomputes saved history coverage from its verified original source. No network or input-file writes.\n" +
  "Exit 0: file matches recomputation; 2: file differs; 1: invalid input. Exit 0 does not prove complete chain history.\n";
export function parseCoverageReviewArgs(args) {
  if (!Array.isArray(args) || ![2, 3].includes(args.length) || args.some(value => typeof value !== "string") ||
      args.slice(0, 2).some(value => !value || value.startsWith("-") || !/\.json$/i.test(value) || value.includes("\0")) ||
      (args.length === 3 && args[2] !== "--json")) throw Error("COVERAGE_REVIEW_CLI_ARGUMENTS");
  return Object.freeze({ source: args[0], coverage: args[1], json: args.length === 3 });
}
export async function runCoverageReview(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseCoverageReviewArgs(args);
    const source = await decodeReportSetFile(await readBoundedVaultPath(request.source, REPORT_SET_FILE_LIMIT));
    const text = await readBoundedVaultPath(request.coverage, REPORT_SET_COVERAGE_LIMIT);
    const review = await reviewReportSetCoverageFile(source.input, text);
    const result = Object.freeze({ ...review, sourceChecksumVerified: true });
    stdout.write(request.json ? JSON.stringify(result, null, 2) + "\n" :
      "History coverage file: " + (result.matchesRecomputation ? "MATCH" : "DIFFERENCES") + "\n" +
      "Source digest matches: " + result.sourceDigestMatches + "\n" +
      "Groups, never combined: " + result.groupCount + "\n" +
      "Differing fields: " + (result.differences.join(", ") || "none") + "\n" +
      "Unexpected top-level fields: " + result.unexpectedFields + "\n" +
      "Saved query presence only; not complete history, authorship or live-chain verification.\n");
    return result.matchesRecomputation ? 0 : 2;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(COVERAGE_REVIEW_CLI|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "COVERAGE_REVIEW_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runCoverageReview(process.argv.slice(2));
