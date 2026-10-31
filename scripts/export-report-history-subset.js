#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportHistoryFile, prepareReportHistoryFile, REPORT_HISTORY_FILE_LIMIT } from "../src/report-history-file.js";
import { selectHistoryEntries } from "../src/report-history-model.js";
import { filteredReportHistory, historyQuery } from "../src/report-history-query.js";
const USAGE = "Usage: node scripts/export-report-history-subset.js history.json --id ID [--id ID...]\n" +
  "   or: ... history.json --archive active|archived|all [--status all|arithmetic-agreement|attention|incomplete]\n" +
  "       [--agent all|DAT|EMA|CAWELON] [--search TEXT] [--tag TAG] [--order newest|oldest|name|created]\n" +
  "       [--block DECIMAL] [--block-scope planned|saved]\n" +
  "Provide at least one filter or explicit ID; do not mix ID and filter modes. Filters select whole reports, including all original tokens and notes.\n" +
  "Verifies the backup checksum and emits a plaintext recoverable history backup to stdout. No network, import or source writes.\n" +
  "Exit 0: nonempty subset exported; 1: invalid input or empty selection. No completeness or current-chain claim.\n";
const names = Object.freeze({ "--archive": "archive", "--status": "status", "--agent": "agent", "--search": "search",
  "--tag": "tag", "--order": "order", "--block": "block", "--block-scope": "blockScope" });
export function parseHistorySubsetArgs(args) {
  if (!Array.isArray(args) || args.length < 3 || args.some(value => typeof value !== "string") ||
      !args[0] || args[0].startsWith("-") || !/\.json$/i.test(args[0]) || args[0].includes("\0") || args.length % 2 !== 1) throw Error("PERIOD_HISTORY_CLI_ARGUMENTS");
  const ids = [], query = {}, seen = new Set();
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (key === "--id") { if (!value || ids.includes(value) || ids.length >= 12) throw Error("PERIOD_HISTORY_CLI_ARGUMENTS"); ids.push(value); }
    else {
      if (!Object.hasOwn(names, key) || seen.has(key)) throw Error("PERIOD_HISTORY_CLI_ARGUMENTS");
      seen.add(key); query[names[key]] = value;
    }
  }
  if (ids.length && seen.size) throw Error("PERIOD_HISTORY_CLI_ARGUMENTS");
  return Object.freeze({ path: args[0], ids: ids.length ? Object.freeze(ids) : null, query: ids.length ? null : historyQuery(query) });
}
export async function runHistorySubsetExport(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseHistorySubsetArgs(args), decoded = await decodeReportHistoryFile(await readBoundedVaultPath(request.path, REPORT_HISTORY_FILE_LIMIT));
    const subset = request.ids ? selectHistoryEntries(decoded.document, request.ids) : filteredReportHistory(decoded.document, request.query);
    if (!subset.entries.length) throw Error("PERIOD_HISTORY_EMPTY_SELECTION");
    stdout.write((await prepareReportHistoryFile(subset)).text); return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    stderr.write((typeof code === "string" && /^(PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "PERIOD_HISTORY_CLI_READ_FAILED") + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runHistorySubsetExport(process.argv.slice(2));
