#!/usr/bin/env node
/** Offline reproduction of the browser's complete confirmation overview. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readRehearsalInputFile } from "./check-rehearsal.js";
import { encodeRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { RehearsalError } from "../src/operation-rehearsal.js";

export async function runRehearsalOverview(args, output = process.stdout, errors = process.stderr) {
  try {
    if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== "string" || !args[0] || args[0].startsWith("--"))
      throw new RehearsalError("CLI_ARGUMENTS");
    const file = await readRehearsalInputFile(args[0], null, true);
    output.write(encodeRehearsalOverview(file.data));
    return 0; // Report completed, including any open positions or rejected records; not execution approval.
  } catch (error) { errors.write("Rehearsal overview failed: " + (error?.code ?? "FILE_READ_FAILED") + "\n"); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runRehearsalOverview(process.argv.slice(2));
