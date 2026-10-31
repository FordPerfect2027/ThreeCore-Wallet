#!/usr/bin/env node
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {readBoundedRehearsalText} from "./read-bounded-rehearsal-file.js";
import {decodeRehearsalWorkspace,REHEARSAL_WORKSPACE_LIMIT} from "../src/operation-rehearsal-workspace.js";
import {encodeRehearsalReferenceReport,rehearsalReferenceCsv} from "../src/operation-rehearsal-records.js";
export async function inspectRehearsalReference(args,output=process.stdout,errors=process.stderr){
  try{
    if(Array.isArray(args)&&args.length===1&&args[0]==="--help"){
      output.write("Usage: node scripts/inspect-rehearsal-reference.js workspace.json AGENT:record-id [--format json|csv]\nRecomputes the complete operation/reservation lifecycle in its own stored agent, including rejected attempts.\nJSON includes original inputs for independent verification. CSV is for viewing; import all spreadsheet columns as text.\nNo network, execution, import or input writes. Exit 0: report emitted; 1: invalid input or no reference.\n");return 0;
    }
    if(!Array.isArray(args)||![2,4].includes(args.length)||args.some(value=>typeof value!=="string")||!args[0]||args[0].startsWith("-")||!args[0].endsWith(".json")||args[0].includes("\0")||
      (args.length===4&&(args[2]!=="--format"||!["json","csv"].includes(args[3]))))throw Error("CLI_ARGUMENTS");
    const input=decodeRehearsalWorkspace(await readBoundedRehearsalText(args[0],REHEARSAL_WORKSPACE_LIMIT));
    output.write((args[3]==="csv"?rehearsalReferenceCsv:encodeRehearsalReferenceReport)(input,args[1]));return 0;
  }catch(error){const code=error?.code??error?.message;errors.write((typeof code==="string"&&/^[A-Z_]+$/.test(code)?code:"REFERENCE_READ_FAILED")+"\n");return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await inspectRehearsalReference(process.argv.slice(2));
