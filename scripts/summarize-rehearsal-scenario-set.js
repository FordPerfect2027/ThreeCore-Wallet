#!/usr/bin/env node
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RehearsalError } from "../src/operation-rehearsal.js";
import { decodeRehearsalScenarioSet, encodeRehearsalScenarioSetReport, REHEARSAL_SCENARIO_SET_LIMIT } from "../src/operation-rehearsal-scenario-set.js";

export async function runRehearsalScenarioSet(args, output=process.stdout, errors=process.stderr) {
  let handle;
  try {
    if(!Array.isArray(args)||args.length!==1||typeof args[0]!=="string"||!args[0]||args[0].startsWith("--")) throw new RehearsalError("CLI_ARGUMENTS");
    handle=await open(resolve(args[0]),"r");const stat=await handle.stat();
    if(!stat.isFile()||stat.size<1||stat.size>REHEARSAL_SCENARIO_SET_LIMIT)throw new RehearsalError("FILE_TOO_LARGE");
    const bytes=new Uint8Array(REHEARSAL_SCENARIO_SET_LIMIT+1);let total=0;
    while(total<bytes.length){const {bytesRead}=await handle.read(bytes,total,bytes.length-total,total);if(!bytesRead)break;total+=bytesRead;}
    if(total!==stat.size||total>REHEARSAL_SCENARIO_SET_LIMIT)throw new RehearsalError("FILE_CHANGED_OR_TOO_LARGE");
    let text;try{text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,total));}catch{throw new RehearsalError("INVALID_UTF8");}
    output.write(encodeRehearsalScenarioSetReport(decodeRehearsalScenarioSet(text)));
    return 0; // The report completed; this does not approve any real operation.
  }catch(error){errors.write("Rehearsal scenario set failed: "+(error?.code??"FILE_READ_FAILED")+"\n");return 1;}
  finally{if(handle)await handle.close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  process.exitCode=await runRehearsalScenarioSet(process.argv.slice(2));
