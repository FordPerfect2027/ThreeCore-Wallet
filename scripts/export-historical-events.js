#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReconciliationFile, RECONCILIATION_FILE_LIMIT } from "../src/reconciliation-file.js";
import { decodePeriodReportFile, PERIOD_REPORT_FILE_LIMIT } from "../src/period-report-file.js";
import { validateReconciliationQuery } from "../src/reconciliation-query.js";
import { validateReportEventQuery } from "../src/period-report-query.js";
import { reconciliationFilteredEventsCSV } from "../src/reconciliation-view.js";
import { periodReportEventsCSV } from "../src/period-report-export.js";
import { reconcileWorkspace } from "../src/reconciliation-engine.js";
import { analyzePeriodReport } from "../src/period-report-engine.js";

const USAGE = "Usage: node scripts/export-historical-events.js reconciliation|period file.json [--agent DAT|EMA|CAWELON|all] [--direction value] [--search text] [--format csv|json] [--require-agreement]\n" +
  "Period reports require one token (default DAT); reconciliation defaults to all. Every matching page is exported.\n" +
  "Output is unencrypted and contains public account/history data. CSV is viewing-only; JSON wraps CSV and query metadata, not a restorable backup. No network or input-file writes.\n";
const fail = () => { throw Error("HISTORY_EVENTS_CLI_ARGUMENTS"); };
export function parseHistoricalEventArgs(args) {
  if (!Array.isArray(args) || args.length < 2 || args.length > 11 ||
      args.some(value => typeof value !== "string") || !["reconciliation", "period"].includes(args[0]) ||
      !args[1] || args[1].startsWith("-") || !/\.json$/i.test(args[1]) || args[1].includes("\0")) fail();
  const options = new Map();
  for (let i = 2; i < args.length;) {
    const flag = args[i++];
    if (!["--agent", "--direction", "--search", "--format", "--require-agreement"].includes(flag) || options.has(flag)) fail();
    if (flag === "--require-agreement") { options.set(flag, true); continue; }
    if (i === args.length) fail();
    options.set(flag, args[i++]);
  }
  const kind = args[0], format = options.get("--format") ?? "csv";
  if (!["csv", "json"].includes(format)) fail();
  const queryInput = { agent: options.get("--agent") ?? (kind === "period" ? "DAT" : "all"),
    direction: options.get("--direction") ?? "all", search: options.get("--search") ?? "", page: 0 };
  const query = kind === "period" ? validateReportEventQuery(queryInput) : validateReconciliationQuery(queryInput);
  return Object.freeze({ kind, path: args[1], query, format, requireAgreement: options.has("--require-agreement") });
}

async function inspectHistoricalEventPath(request) {
  const period = request.kind === "period";
  const text = await readBoundedVaultPath(request.path, period ? PERIOD_REPORT_FILE_LIMIT : RECONCILIATION_FILE_LIMIT);
  const decoded = await (period ? decodePeriodReportFile(text) : decodeReconciliationFile(text));
  const input = period ? decoded.input : decoded.workspace;
  const file = period ? periodReportEventsCSV(input, request.query) : reconciliationFilteredEventsCSV(input, request.query);
  const report = period ? analyzePeriodReport(input) : reconcileWorkspace(input);
  const statuses = Object.freeze(report.slots.map(slot => Object.freeze({ agent: slot.agent, status: slot.status })));
  const allArithmeticAgreement = period ? report.allArithmeticAgreement : statuses.every(slot => slot.status === "arithmetic-agreement");
  return Object.freeze({ schema: "threecore.filtered-history-events.v1", sourceKind: request.kind,
    sourcePayloadDigest: decoded.digest, checksumVerified: true, authenticated: false,
    historicalOnly: true, liveChainRechecked: false, completeHistory: false, restorable: false,
    query: request.query, total: file.total, matched: file.matched, scope: "all-matches",
    summary: Object.freeze({ allArithmeticAgreement, statuses, conclusionsUseAllSourceEvidence: true }),
    csv: file.text });
}

export async function runHistoricalEventExport(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const options = parseHistoricalEventArgs(args);
    const result = await inspectHistoricalEventPath(options);
    stdout.write(options.format === "csv" ? result.csv : JSON.stringify(result, null, 2) + "\n");
    if (options.requireAgreement && !result.summary.allArithmeticAgreement) {
      stderr.write("HISTORY_EVENTS_CLI_NOT_ALL_AGREE\n"); return 2;
    }
    return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(HISTORY_EVENTS_CLI|RECONCILIATION|PERIOD|TRANSFER|IDENTITY|VAULT_CLI)_[A-Z_]+$/.test(code)
      ? code : "HISTORY_EVENTS_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runHistoricalEventExport(process.argv.slice(2));
