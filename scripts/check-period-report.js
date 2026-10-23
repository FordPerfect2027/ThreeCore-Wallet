#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodePeriodReportFile, PERIOD_REPORT_FILE_LIMIT } from "../src/period-report-file.js";
import { analyzePeriodReport } from "../src/period-report-engine.js";

export function parseReportArgs(args) {
  let path = null, json = false, requireAgreement = false;
  const seen = new Set();
  for (const arg of args) {
    if (["--json", "--require-agreement"].includes(arg)) {
      if (seen.has(arg)) throw Error("PERIOD_REPORT_CLI_ARGUMENTS");
      seen.add(arg);
      if (arg === "--json") json = true;
      else requireAgreement = true;
    } else if (typeof arg !== "string" || arg.startsWith("-") || path !== null || !/\.json$/i.test(arg)) {
      throw Error("PERIOD_REPORT_CLI_ARGUMENTS");
    } else path = arg;
  }
  if (!path) throw Error("PERIOD_REPORT_CLI_ARGUMENTS");
  return { path, json, requireAgreement };
}

/** Output deliberately omits user labels, addresses, amounts and transaction hashes. */
export async function inspectReportPath(path) {
  const decoded = await decodePeriodReportFile(await readBoundedVaultPath(path, PERIOD_REPORT_FILE_LIMIT));
  const report = analyzePeriodReport(decoded.input);
  return Object.freeze({ status: report.status, selectedCount: report.selectedCount,
    sameChainAndPeriod: report.sameChainAndPeriod, allArithmeticAgreement: report.allArithmeticAgreement,
    slots: report.slots.map(row => ({ agent: row.agent, status: row.status,
      completed: row.progress?.completed ?? 0, total: row.progress?.total ?? 0,
      events: row.arithmetic.totals?.eventCount ?? null })),
    issues: report.issues, warnings: report.warnings, conflictingBlocks: report.anchors.conflicts.length,
    digest: decoded.digest, checksumVerified: true, authenticated: false,
    liveChainRechecked: false, completeHistory: false, securityAudit: false });
}

export async function runReportCheck(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseReportArgs(args), result = await inspectReportPath(options.path);
    stdout.write(options.json ? JSON.stringify(result, null, 2) + "\n" :
      "ThreeCore historical report: " + result.status + "\n" +
      result.slots.map(row => row.agent + ": " + row.status + " (" + row.completed + "/" + row.total + ")").join("\n") + "\n" +
      "Checksum verified. No authorship, live-chain, completeness or independent-audit certification.\n");
    if (options.requireAgreement && !result.allArithmeticAgreement) {
      stderr.write("PERIOD_REPORT_CLI_NO_AGREEMENT\n"); return 2;
    }
    return 0;
  } catch (error) {
    const value = error?.code ?? error?.message;
    const safe = typeof value === "string" && /^(PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(value)
      ? value : "PERIOD_REPORT_CLI_READ_FAILED";
    stderr.write(safe + "\nUsage: node scripts/check-period-report.js file.json [--json] [--require-agreement]\n");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runReportCheck(process.argv.slice(2));
}
