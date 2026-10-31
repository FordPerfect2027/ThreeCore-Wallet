#!/usr/bin/env node
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {readBoundedRehearsalText} from "./read-bounded-rehearsal-file.js";
import {reviewRehearsalReport,canExportReviewedRehearsalWorkspace,exportReviewedRehearsalWorkspace,REHEARSAL_REPORT_REVIEW_LIMIT} from "../src/operation-rehearsal-report-review.js";

export async function recoverRehearsalWorkspace(args,output=process.stdout,errors=process.stderr){
  try{
    if(Array.isArray(args)&&args.length===1&&args[0]==="--help"){
      output.write("Usage: node scripts/recover-rehearsal-workspace.js report.json [--sha256 HEX]\nRecomputes a saved overview, record query or reference report and emits its complete canonical workspace inputs.\nNo live import, network, execution or input writes. This reconstructs field values, not original workspace file formatting.\nExit 0: workspace emitted; 2: mismatching or unsupported source; 1: invalid input.\n");return 0;
    }
    if(!Array.isArray(args)||![1,3].includes(args.length)||args.some(value=>typeof value!=="string"||!value)||args[0].startsWith("-")||
      (args.length===3&&(args[1]!=="--sha256"||!/^[a-f0-9]{64}$/i.test(args[2]))))throw Error("CLI_ARGUMENTS");
    const receipt=await reviewRehearsalReport(await readBoundedRehearsalText(args[0],REHEARSAL_REPORT_REVIEW_LIMIT),{expectedSha256:args[2]??null});
    if(!canExportReviewedRehearsalWorkspace(receipt)){
      errors.write((!receipt.matchesRecomputation||receipt.checksumMatches===false?"REVIEW_MISMATCH":"UNSUPPORTED_WORKSPACE_SOURCE")+"\n");return 2;
    }
    output.write(exportReviewedRehearsalWorkspace(receipt));return 0;
  }catch(error){const code=error?.code??error?.message;errors.write((typeof code==="string"&&/^[A-Z_]+$/.test(code)?code:"WORKSPACE_RECOVERY_FAILED")+"\n");return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await recoverRehearsalWorkspace(process.argv.slice(2));
