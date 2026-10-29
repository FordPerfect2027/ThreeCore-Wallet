#!/usr/bin/env node
import { readBoundedRehearsalText } from "./read-bounded-rehearsal-file.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { RehearsalError } from "../src/operation-rehearsal.js";
import { decodeRehearsalScenarioSet, encodeRehearsalScenarioSetReport, REHEARSAL_SCENARIO_SET_LIMIT } from "../src/operation-rehearsal-scenario-set.js";

export async function runRehearsalScenarioSet(args, output=process.stdout, errors=process.stderr) {
  try {
    if(!Array.isArray(args)||args.length!==1||typeof args[0]!=="string"||!args[0]||args[0].startsWith("--")) throw new RehearsalError("CLI_ARGUMENTS");
    const text=await readBoundedRehearsalText(args[0],REHEARSAL_SCENARIO_SET_LIMIT);
    output.write(encodeRehearsalScenarioSetReport(decodeRehearsalScenarioSet(text)));
    return 0; // The report completed; this does not approve any real operation.
  }catch(error){errors.write("Rehearsal scenario set failed: "+(error?.code??"FILE_READ_FAILED")+"\n");return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  process.exitCode=await runRehearsalScenarioSet(process.argv.slice(2));
