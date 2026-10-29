#!/usr/bin/env node
import { readBoundedRehearsalText } from "./read-bounded-rehearsal-file.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
import { RehearsalError } from "../src/operation-rehearsal.js";
import { reviewRehearsalReport, encodeRehearsalReviewReceipt, REHEARSAL_REPORT_REVIEW_LIMIT } from "../src/operation-rehearsal-report-review.js";
const fail=code=>{throw new RehearsalError(code);};
export async function readRehearsalReportFile(file) {
  return readBoundedRehearsalText(file,REHEARSAL_REPORT_REVIEW_LIMIT);
}
export async function runRehearsalReportReview(args, output=process.stdout, errors=process.stderr) {
  try {
    if(!Array.isArray(args)||![1,3].includes(args.length)||args.some(value=>typeof value!=="string"||!value)||
      args[0].startsWith("--")||(args.length===3&&(args[1]!=="--sha256"||!/^[a-f0-9]{64}$/i.test(args[2])))) fail("CLI_ARGUMENTS");
    const text=await readRehearsalReportFile(args[0]);
    const receipt=await reviewRehearsalReport(text,{expectedSha256:args[2]??null,subtle:webcrypto.subtle});
    output.write(encodeRehearsalReviewReceipt(receipt));
    return receipt.matchesRecomputation&&receipt.checksumMatches!==false?0:2;
  } catch(error) {errors.write("Rehearsal report review failed: "+(error?.code??"FILE_READ_FAILED")+"\n");return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  process.exitCode=await runRehearsalReportReview(process.argv.slice(2));
