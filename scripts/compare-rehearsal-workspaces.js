#!/usr/bin/env node
/** Offline comparison of two explicitly supplied bounded rehearsal workspaces. */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readRehearsalInputFile } from "./check-rehearsal.js";
import { encodeRehearsalComparison } from "../src/operation-rehearsal-comparison.js";
import { RehearsalError } from "../src/operation-rehearsal.js";

export function parseRehearsalCompareArgs(args) {
  if (!Array.isArray(args) || ![2, 3].includes(args.length) ||
      args.some(value => typeof value !== "string" || !value) || args.slice(0, 2).some(value => value.startsWith("--")) ||
      (args.length === 3 && args[2] !== "--json")) throw new RehearsalError("CLI_ARGUMENTS");
  return { before: args[0], after: args[1], json: args.length === 3 };
}
export async function runRehearsalCompare(args, output = process.stdout, errors = process.stderr) {
  try {
    const options = parseRehearsalCompareArgs(args);
    const before = await readRehearsalInputFile(options.before, null, true);
    const after = await readRehearsalInputFile(options.after, null, true);
    const text = encodeRehearsalComparison(before.data, after.data);
    if (options.json) output.write(text);
    else {
      const report = JSON.parse(text);
      output.write(["Comparison of fictional canonical inputs; not authenticated or execution authority.",
        "Before SHA-256: " + before.sha256, "After SHA-256: " + after.sha256,
        ...report.rows.map(row => row.agent + ": " + row.action + "; context changes " + row.contextChanges.length +
          "; policy changes " + row.policyChanges.length + "; added/removed/modified records " +
          [row.eventChanges.added.length, row.eventChanges.removed.length, row.eventChanges.modified.length].join("/")),
        "No amounts are aggregated. Exit 0 means comparison completed, not that inputs are equal or modeled constraints passed."].join("\n") + "\n");
    }
    return 0;
  } catch (error) { errors.write("Rehearsal comparison failed: " + (error?.code ?? "FILE_READ_FAILED") + "\n"); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runRehearsalCompare(process.argv.slice(2));
