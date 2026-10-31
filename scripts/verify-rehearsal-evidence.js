#!/usr/bin/env node
import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
import { RehearsalError } from "../src/operation-rehearsal.js";
import { reviewRehearsalEvidence, REHEARSAL_REVIEW_EVIDENCE_LIMIT } from "../src/operation-rehearsal-report-review.js";

export async function readRehearsalEvidenceFile(file) {
  const bytes = await readBoundedLocalBytes(resolve(file), REHEARSAL_REVIEW_EVIDENCE_LIMIT, {
    fail: code => { throw new RehearsalError(code); }, sizeCode: "FILE_TOO_LARGE", changedCode: "FILE_CHANGED_OR_TOO_LARGE",
  });
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new RehearsalError("INVALID_UTF8"); }
}

export async function runRehearsalEvidenceReview(args, output = process.stdout, errors = process.stderr) {
  try {
    if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== "string" ||
        !args[0] || args[0].startsWith("--")) throw new RehearsalError("CLI_ARGUMENTS");
    const text = await readRehearsalEvidenceFile(args[0]);
    const result = await reviewRehearsalEvidence(text, { subtle: webcrypto.subtle });
    output.write(JSON.stringify(result, null, 2) + "\n");
    return result.matchesReceipt && result.reportReview.matchesRecomputation && result.reportReview.checksumMatches !== false ? 0 : 2;
  } catch (error) {
    errors.write("Rehearsal evidence review failed: " + (error?.code ?? "FILE_READ_FAILED") + "\n");
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runRehearsalEvidenceReview(process.argv.slice(2));
