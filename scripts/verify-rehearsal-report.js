#!/usr/bin/env node
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { webcrypto } from "node:crypto";
import { RehearsalError } from "../src/operation-rehearsal.js";
import { reviewRehearsalReport, encodeRehearsalReviewReceipt, REHEARSAL_REPORT_REVIEW_LIMIT } from "../src/operation-rehearsal-report-review.js";
const fail=code=>{throw new RehearsalError(code);};
export async function readRehearsalReportFile(file) {
  const handle=await open(resolve(file),"r");
  try {
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size<1||stat.size>REHEARSAL_REPORT_REVIEW_LIMIT) fail("FILE_TOO_LARGE");
    const bytes=new Uint8Array(REHEARSAL_REPORT_REVIEW_LIMIT+1); let total=0;
    while(total<bytes.length) { const {bytesRead}=await handle.read(bytes,total,bytes.length-total,total); if(!bytesRead)break;total+=bytesRead; }
    if(total!==stat.size||total>REHEARSAL_REPORT_REVIEW_LIMIT) fail("FILE_CHANGED_OR_TOO_LARGE");
    try { return new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,total)); }
    catch { fail("INVALID_UTF8"); }
  } finally {await handle.close();}
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
