#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportHistoryFile, REPORT_HISTORY_FILE_LIMIT } from "../src/report-history-file.js";
import { reportHistoryIndex } from "../src/report-history-query.js";

export function parseHistoryArgs(args) {
  let path = null, json = false, requireAgreement = false;
  const seen = new Set();
  for (const value of args) {
    if (["--json", "--require-agreement"].includes(value)) {
      if (seen.has(value)) throw Error("PERIOD_HISTORY_CLI_ARGUMENTS");
      seen.add(value);
      if (value === "--json") json = true;
      else requireAgreement = true;
    } else if (typeof value !== "string" || value.startsWith("-") || path !== null || !/\.json$/i.test(value)) {
      throw Error("PERIOD_HISTORY_CLI_ARGUMENTS");
    } else path = value;
  }
  if (!path) throw Error("PERIOD_HISTORY_CLI_ARGUMENTS");
  return { path, json, requireAgreement };
}

/** Never print labels, notes, addresses or financial amounts in diagnostic output. */
export async function inspectHistoryPath(path) {
  const decoded = await decodeReportHistoryFile(await readBoundedVaultPath(path, REPORT_HISTORY_FILE_LIMIT));
  const index = reportHistoryIndex(decoded.document);
  const statuses = Object.fromEntries(["arithmetic-agreement", "attention", "incomplete"].map(status =>
    [status, index.rows.filter(row => row.status === status).length]));
  return Object.freeze({ count: index.count, active: index.active, archived: index.archived,
    statuses, allArithmeticAgreement: index.count > 0 && statuses["arithmetic-agreement"] === index.count,
    checksumVerified: true, digest: decoded.digest, authenticated: false, encrypted: false,
    liveChainRechecked: false, securityAudit: false });
}

export async function runHistoryCheck(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseHistoryArgs(args), result = await inspectHistoryPath(options.path);
    stdout.write(options.json ? JSON.stringify(result, null, 2) + "\n" :
      "ThreeCore report history: " + result.count + " reports (" + result.archived + " archived)\n" +
      "Agreement: " + result.statuses["arithmetic-agreement"] + "; attention: " + result.statuses.attention +
      "; incomplete: " + result.statuses.incomplete + "\nChecksum verified; no authorship or live-chain certification.\n");
    if (options.requireAgreement && !result.allArithmeticAgreement) {
      stderr.write("PERIOD_HISTORY_CLI_NO_AGREEMENT\n"); return 2;
    }
    return 0;
  } catch (value) {
    const code = value?.code ?? value?.message;
    const safe = typeof code === "string" && /^(PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code)
      ? code : "PERIOD_HISTORY_CLI_READ_FAILED";
    stderr.write(safe + "\nUsage: node scripts/check-report-history.js file.json [--json] [--require-agreement]\n");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runHistoryCheck(process.argv.slice(2));
}
