#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportSetFile, REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { prepareReportSetEventComparisonFile } from "../src/report-set-export.js";

const USAGE = "Usage: node scripts/compare-saved-events.js set.json --before ID --after ID --agent DAT|EMA|CAWELON\n" +
  "Writes the shared saved-event comparison JSON, including full event values and addresses. No network or input writes.\n" +
  "Only overlapping saved query ranges are compared. Exit 0: saved observations match; 2: differences or no common coverage; 1: invalid input.\n";
export function parseSavedEventArgs(args) {
  if (!Array.isArray(args) || args.length !== 7 || args.some(v => typeof v !== "string") || !args[0] ||
      args[0].startsWith("-") || !/\.json$/i.test(args[0]) || args[0].includes("\0") ||
      args[1] !== "--before" || args[3] !== "--after" || args[5] !== "--agent" || !["DAT", "EMA", "CAWELON"].includes(args[6]) ||
      ![args[2], args[4]].every(v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)) || args[2] === args[4])
    throw Error("SAVED_EVENT_CLI_ARGUMENTS");
  return Object.freeze({ path: args[0], query: Object.freeze({ beforeId: args[2], afterId: args[4], agent: args[6] }) });
}
export async function runSavedEventComparison(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseSavedEventArgs(args), text = await readBoundedVaultPath(request.path, REPORT_SET_FILE_LIMIT);
    const decoded = await decodeReportSetFile(text), file = await prepareReportSetEventComparisonFile(decoded.input, request.query);
    stdout.write(file.text);
    return JSON.parse(file.text).comparison.status === "saved-observations-match" ? 0 : 2;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(SAVED_EVENT_CLI|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code)
      ? code : "SAVED_EVENT_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runSavedEventComparison(process.argv.slice(2));
