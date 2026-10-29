#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedRehearsalText } from "./read-bounded-rehearsal-file.js";
import { decodeRehearsalWorkspace, REHEARSAL_WORKSPACE_LIMIT } from "../src/operation-rehearsal-workspace.js";
import { encodeRehearsalRecordReport, REHEARSAL_RECORD_QUERY } from "../src/operation-rehearsal-records.js";
import { RehearsalError } from "../src/operation-rehearsal.js";
export async function inspectRehearsalRecords(args,output=process.stdout,errors=process.stderr){try{
  if(!Array.isArray(args)||args.length<1||args.length>9||args.length%2!==1||args.some(value=>typeof value!=="string")||!args[0]||args[0].startsWith("--"))throw new RehearsalError("CLI_ARGUMENTS");
  const query={...REHEARSAL_RECORD_QUERY},seen=new Set();
  for(let i=1;i<args.length;i+=2){const key=args[i].slice(2);if(args[i]!=="--"+key||!Object.hasOwn(query,key)||seen.has(key))throw new RehearsalError("CLI_ARGUMENTS");seen.add(key);query[key]=args[i+1];}
  const input=decodeRehearsalWorkspace(await readBoundedRehearsalText(args[0],REHEARSAL_WORKSPACE_LIMIT));
  output.write(encodeRehearsalRecordReport(input,query));return 0;
}catch(error){errors.write("Rehearsal record query failed: "+(error?.code??"FILE_READ_FAILED")+"\n");return 1;}}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await inspectRehearsalRecords(process.argv.slice(2));
