#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportSetFile, REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { analyzeReportSet } from "../src/report-set-engine.js";

export function parseSetArgs(args) {
  let path = null, json = false, requireContinuous = false;
  const seen = new Set();
  for (const value of args) {
    if (["--json", "--require-continuous"].includes(value)) {
      if (seen.has(value)) throw Error("PERIOD_SET_CLI_ARGUMENTS");
      seen.add(value);
      if (value === "--json") json = true;
      else requireContinuous = true;
    } else if (typeof value !== "string" || value.startsWith("-") || path !== null || !/\.json$/i.test(value)) {
      throw Error("PERIOD_SET_CLI_ARGUMENTS");
    } else path = value;
  }
  if (!path) throw Error("PERIOD_SET_CLI_ARGUMENTS");
  return { path, json, requireContinuous };
}

/** Diagnostic output omits titles, notes, addresses, event payloads and balances. */
export async function inspectSetPath(path) {
  const decoded = await decodeReportSetFile(await readBoundedVaultPath(path, REPORT_SET_FILE_LIMIT));
  const result = analyzeReportSet(decoded.input);
  const tokens = result.tokens.map(token => ({ agent: token.agent,
    contexts: token.contextCount, missingReports: token.missingReportIds.length,
    continuous: token.continuous,
    groups: token.groups.map(group => ({ reports: group.rows.length,
      plannedUniqueBlocks: group.plannedUniqueBlocks, gapBlocks: group.gapBlocks,
      overlapBlocks: group.overlapBlocks, incompleteReports: group.incompleteReports.length,
      balanceConflicts: group.balanceConflicts.length })) }));
  return Object.freeze({ reportCount: result.reportCount, archivedCount: result.archivedCount,
    allContinuous: result.allContinuous, issues: result.issues, tokens,
    hashConflicts: result.anchors.conflicts.length, checksumVerified: true,
    digest: decoded.digest, authenticated: false, encrypted: false,
    liveChainRechecked: false, eventsCombined: false, tokenAmountsSummed: false, securityAudit: false });
}

export async function runSetCheck(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseSetArgs(args), result = await inspectSetPath(options.path);
    stdout.write(options.json ? JSON.stringify(result, null, 2) + "\n" :
      "ThreeCore saved report set: " + result.reportCount + " reports\n" +
      "Selected evidence continuous: " + result.allContinuous + "\n" +
      "Issues: " + (result.issues.join(", ") || "none") + "\n" +
      "Checksum verified. Historical evidence only; no live-chain or authorship certification.\n");
    if (options.requireContinuous && !result.allContinuous) {
      stderr.write("PERIOD_SET_CLI_NOT_CONTINUOUS\n");
      return 2;
    }
    return 0;
  } catch (value) {
    const code = value?.code ?? value?.message;
    const safe = typeof code === "string" && /^(PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code)
      ? code : "PERIOD_SET_CLI_READ_FAILED";
    stderr.write(safe + "\nUsage: node scripts/check-report-set.js file.json [--json] [--require-continuous]\n");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runSetCheck(process.argv.slice(2));
}
