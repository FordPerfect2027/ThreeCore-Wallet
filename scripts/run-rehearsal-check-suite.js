#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedRehearsalText } from "./read-bounded-rehearsal-file.js";
import { RehearsalError } from "../src/operation-rehearsal.js";
import { decodeRehearsalCheckSuite, encodeRehearsalCheckReport, REHEARSAL_CHECK_SUITE_LIMIT } from "../src/operation-rehearsal-check-suite.js";
export async function runCheckSuite(args,output=process.stdout,errors=process.stderr){
  try{
    if(!Array.isArray(args)||args.length!==1||typeof args[0]!=="string"||!args[0]||args[0].startsWith("--"))throw new RehearsalError("CLI_ARGUMENTS");
    const text=await readBoundedRehearsalText(args[0],REHEARSAL_CHECK_SUITE_LIMIT);
    const report=encodeRehearsalCheckReport(decodeRehearsalCheckSuite(text));
    output.write(report);return JSON.parse(report).summary.allMatched?0:2;
  }catch(error){errors.write("Rehearsal expected-outcome check failed: "+(error?.code??"FILE_READ_FAILED")+"\n");return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runCheckSuite(process.argv.slice(2));
