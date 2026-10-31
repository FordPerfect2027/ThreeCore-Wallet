#!/usr/bin/env node
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {readBoundedRehearsalText} from "./read-bounded-rehearsal-file.js";
import {reviewRehearsalReport,canExportReviewedRehearsalWorkspace,exportReviewedRehearsalWorkspace,exportReviewedRehearsalAgent,REHEARSAL_REPORT_REVIEW_LIMIT} from "../src/operation-rehearsal-report-review.js";

export async function recoverRehearsalWorkspace(args,output=process.stdout,errors=process.stderr){
  try{
    if(Array.isArray(args)&&args.length===1&&args[0]==="--help"){
      output.write("Usage: node scripts/recover-rehearsal-workspace.js report.json [--sha256 HEX] [--agent DAT|EMA|CAWELON]\nRecomputes a saved overview, record query or reference report. Emits the complete canonical workspace, or only the explicitly selected present agent's input.\nNo live import, network, execution or input writes. This reconstructs field values, not original file formatting.\nExit 0: inputs emitted; 2: mismatching/unsupported source or absent agent; 1: invalid input.\n");return 0;
    }
    if(!Array.isArray(args)||![1,3,5].includes(args.length)||args.some(value=>typeof value!=="string"||!value)||args[0].startsWith("-"))throw Error("CLI_ARGUMENTS");
    let expectedSha256=null,agent=null;const seen=new Set();
    for(let i=1;i<args.length;i+=2){const flag=args[i],value=args[i+1];
      if(seen.has(flag)||!["--sha256","--agent"].includes(flag))throw Error("CLI_ARGUMENTS");seen.add(flag);
      if(flag==="--sha256"){if(!/^[a-f0-9]{64}$/i.test(value))throw Error("CLI_ARGUMENTS");expectedSha256=value;}
      else{if(!["DAT","EMA","CAWELON"].includes(value))throw Error("CLI_ARGUMENTS");agent=value;}
    }
    const receipt=await reviewRehearsalReport(await readBoundedRehearsalText(args[0],REHEARSAL_REPORT_REVIEW_LIMIT),{expectedSha256});
    if(!canExportReviewedRehearsalWorkspace(receipt)){
      errors.write((!receipt.matchesRecomputation||receipt.checksumMatches===false?"REVIEW_MISMATCH":"UNSUPPORTED_WORKSPACE_SOURCE")+"\n");return 2;
    }
    output.write(agent===null?exportReviewedRehearsalWorkspace(receipt):exportReviewedRehearsalAgent(receipt,agent));return 0;
  }catch(error){const code=error?.code??error?.message;errors.write((typeof code==="string"&&/^[A-Z_]+$/.test(code)?code:"WORKSPACE_RECOVERY_FAILED")+"\n");return code==="REVIEW_AGENT_MISSING"?2:1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await recoverRehearsalWorkspace(process.argv.slice(2));
