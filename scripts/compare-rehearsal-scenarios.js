#!/usr/bin/env node
/** Exact offline reproduction of a same-events, same-context hypothetical replay. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readRehearsalInputFile } from "./check-rehearsal.js";
import { encodeRehearsalScenario } from "../src/operation-rehearsal-scenario.js";
import { RehearsalError } from "../src/operation-rehearsal.js";

export async function runRehearsalScenario(args, output = process.stdout, errors = process.stderr) {
  try {
    if (!Array.isArray(args) || args.length !== 2 || args.some(value => typeof value !== "string" || !value || value.startsWith("--")))
      throw new RehearsalError("CLI_ARGUMENTS");
    const before = await readRehearsalInputFile(args[0]);
    const after = await readRehearsalInputFile(args[1]);
    output.write(encodeRehearsalScenario(before.data, after.data));
    return 0; // Completed comparison, never execution approval or policy advice.
  } catch (error) { errors.write("Rehearsal scenario failed: " + (error?.code ?? "FILE_READ_FAILED") + "\n"); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runRehearsalScenario(process.argv.slice(2));
