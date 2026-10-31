#!/usr/bin/env node
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {readBoundedVaultPath} from "./check-transfer-vault.js";
import {decodeReportSetFile, REPORT_SET_FILE_LIMIT} from "../src/report-set-file.js";
import {reviewReportSetChecksFile, REPORT_SET_CHECKS_LIMIT} from "../src/report-set-export.js";

const USAGE = "Usage: node scripts/verify-report-checks.js source-set.json check-details.json [--json]\n" +
  "Recomputes saved check details using the verified original source and the file's stated query/options. No network or file writes.\n" +
  "Exit 0: matches; 2: differences; 1: invalid input/read failure. Matching does not authenticate authorship or current chain state.\n";
export function parseCheckReviewArgs(args) {
  if (!Array.isArray(args) || ![2,3].includes(args.length) || args.some(value => typeof value !== "string") ||
      args.slice(0,2).some(value => !value || value.startsWith("-") || !/\.json$/i.test(value) || value.includes("\0")) ||
      (args.length === 3 && args[2] !== "--json")) throw Error("CHECK_REVIEW_CLI_ARGUMENTS");
  return Object.freeze({source: args[0], details: args[1], json: args.length === 3});
}
export async function runCheckReview(args, {stdout=process.stdout, stderr=process.stderr} = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseCheckReviewArgs(args);
    const source = await decodeReportSetFile(await readBoundedVaultPath(request.source, REPORT_SET_FILE_LIMIT));
    const text = await readBoundedVaultPath(request.details, REPORT_SET_CHECKS_LIMIT);
    const review = await reviewReportSetChecksFile(source.input, text);
    const result = Object.freeze({...review, sourceChecksumVerified: true});
    stdout.write(request.json ? JSON.stringify(result,null,2)+"\n" :
      "ThreeCore check details: "+(result.matchesRecomputation?"MATCH":"DIFFERENCES")+"\n"+
      "Source digest matches: "+result.sourceDigestMatches+"\n"+
      "Recomputed checks: "+result.matched+" / "+result.total+"\n"+
      "Differing fields: "+(result.differences.join(", ")||"none")+"\n"+
      "Unexpected top-level fields: "+result.unexpectedFields+"\n"+
      "Source checksum verified; historical-only comparison, not authorship or live-chain verification.\n");
    return result.matchesRecomputation?0:2;
  } catch (error) {
    const code = error?.code??error?.message;
    const safe = typeof code === "string" && /^(CHECK_REVIEW_CLI|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "CHECK_REVIEW_CLI_READ_FAILED";
    stderr.write(safe+"\n"+USAGE);return 1;
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  process.exitCode=await runCheckReview(process.argv.slice(2));
