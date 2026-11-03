#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportHistoryFile, prepareHistoryImportInspectionFile, REPORT_HISTORY_FILE_LIMIT } from "../src/report-history-file.js";
import { inspectReportHistoryImport, selectHistoryEntries } from "../src/report-history-model.js";
import { historyImportInspectionText } from "../src/report-history-view.js";
const USAGE = "Usage: node scripts/inspect-report-history-import.js current.json incoming.json [--json] [--id ID...]\n" +
  "Verifies both checksums and explains additions, duplicate reports, retained metadata, conflicts and capacity.\n" +
  "Optional IDs select incoming reports only. JSON is an inspection receipt, not a restorable backup.\n" +
  "No network, import, replacement or writes. Both files use portable revision zero; current browser state is not inspected.\n" +
  "Exit 0: compatible snapshots; 2: conflict or capacity/revision limit; 1: invalid input. Not chain verification.\n";
export function parseHistoryInspectionArgs(args) {
  if (!Array.isArray(args) || args.length < 2 || args.some(value => typeof value !== "string") ||
      args.slice(0, 2).some(value => !value || value.startsWith("-") || !/\.json$/i.test(value) || value.includes("\0"))) throw Error("PERIOD_HISTORY_CLI_ARGUMENTS");
  let json = false; const ids = [];
  for (let index = 2; index < args.length; index++) {
    if (args[index] === "--json" && !json) json = true;
    else if (args[index] === "--id" && args[index + 1] && !args[index + 1].startsWith("-") && ids.length < 12) {
      const id = args[++index]; if (ids.includes(id)) throw Error("PERIOD_HISTORY_CLI_ARGUMENTS"); ids.push(id);
    } else throw Error("PERIOD_HISTORY_CLI_ARGUMENTS");
  }
  return Object.freeze({ before: args[0], incoming: args[1], json, ids: ids.length ? Object.freeze(ids) : null });
}
export async function runHistoryImportInspection(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseHistoryInspectionArgs(args);
    const before = await decodeReportHistoryFile(await readBoundedVaultPath(request.before, REPORT_HISTORY_FILE_LIMIT));
    const incoming = await decodeReportHistoryFile(await readBoundedVaultPath(request.incoming, REPORT_HISTORY_FILE_LIMIT));
    const selected = request.ids ? selectHistoryEntries(incoming.document, request.ids) : incoming.document;
    const inspection = inspectReportHistoryImport(before.document, selected);
    stdout.write(request.json ? (await prepareHistoryImportInspectionFile(before.document, selected)).text : historyImportInspectionText(inspection) + "\n");
    return inspection.compatible ? 0 : 2;
  } catch (error) {
    const code = error?.code ?? error?.message;
    stderr.write((typeof code === "string" && /^(PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "PERIOD_HISTORY_CLI_READ_FAILED") + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runHistoryImportInspection(process.argv.slice(2));
