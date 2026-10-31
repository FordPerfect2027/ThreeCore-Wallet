#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportSetFile, REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { diagnosticQuery, querySetDiagnostics } from "../src/report-set-diagnostics.js";
import { validateSetExportOptions } from "../src/report-set-model.js";
import { reportSetDiagnosticsCSV } from "../src/report-set-export.js";
import { analyzeReportSet } from "../src/report-set-engine.js";

const USAGE = "Usage: node scripts/export-report-checks.js file.json [--agent all|DAT|EMA|CAWELON] [--severity all|conflict|missing|review|information] [--search text] [--format csv|json] [--include-notes] [--full-addresses] [--require-continuous]\n" +
  "Exports all matching checks plus an unfiltered summary, including on zero matches. No network or input-file writes.\n" +
  "Unencrypted viewing output, not a restorable backup. Notes are omitted and structured addresses shortened by default; names/search may still contain addresses.\n";
const fail = () => { throw Error("REPORT_CHECKS_CLI_ARGUMENTS"); };
export function parseReportCheckArgs(args) {
  if (!Array.isArray(args) || args.length < 1 || args.length > 12 || args.some(value => typeof value !== "string") ||
      !args[0] || args[0].startsWith("-") || !/\.json$/i.test(args[0]) || args[0].includes("\0")) fail();
  const flags = new Map(), switches = ["--include-notes", "--full-addresses", "--require-continuous"];
  for (let i = 1; i < args.length;) {
    const flag = args[i++];
    if (!["--agent", "--severity", "--search", "--format", ...switches].includes(flag) || flags.has(flag)) fail();
    if (switches.includes(flag)) { flags.set(flag, true); continue; }
    if (i === args.length) fail();
    flags.set(flag, args[i++]);
  }
  const format = flags.get("--format") ?? "csv";
  if (!["csv", "json"].includes(format)) fail();
  const query = diagnosticQuery({ agent: flags.get("--agent") ?? "all", severity: flags.get("--severity") ?? "all", search: flags.get("--search") ?? "" });
  const options = validateSetExportOptions({ includeNotes: flags.has("--include-notes"), shortAddresses: !flags.has("--full-addresses") });
  return Object.freeze({ path: args[0], query, options, format, requireContinuous: flags.has("--require-continuous") });
}

async function inspectReportChecks(request) {
  const decoded = await decodeReportSetFile(await readBoundedVaultPath(request.path, REPORT_SET_FILE_LIMIT));
  const file = reportSetDiagnosticsCSV(decoded.input, request.query, request.options);
  const found = querySetDiagnostics(decoded.input, request.query), report = analyzeReportSet(decoded.input);
  return Object.freeze({ schema: "threecore.filtered-report-checks.v1", sourcePayloadDigest: decoded.digest,
    checksumVerified: true, authenticated: false, encrypted: false, historicalOnly: true,
    liveChainRechecked: false, automaticRepairs: false, restorable: false,
    query: file.query, options: file.options, total: file.total, matched: file.matched, scope: "all-matches", summaryRow: true,
    summary: Object.freeze({ counts: found.counts, allContinuous: report.allContinuous, conclusionsUseAllSourceEvidence: true }), csv: file.text });
}

export async function runReportCheckExport(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseReportCheckArgs(args), result = await inspectReportChecks(request);
    stdout.write(request.format === "csv" ? result.csv : JSON.stringify(result, null, 2) + "\n");
    if (request.requireContinuous && !result.summary.allContinuous) {
      stderr.write("REPORT_CHECKS_CLI_NOT_CONTINUOUS\n"); return 2;
    }
    return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(REPORT_CHECKS_CLI|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code)
      ? code : "REPORT_CHECKS_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runReportCheckExport(process.argv.slice(2));
