#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReconciliationFile, RECONCILIATION_FILE_LIMIT } from "../src/reconciliation-file.js";
import { reconcileWorkspace } from "../src/reconciliation-engine.js";
import { reconciliationText } from "../src/reconciliation-view.js";

export function parseReconciliationArgs(args) {
  let path = null;
  let json = false;
  let strict = false;
  const seen = new Set();
  for (const argument of args) {
    if (argument === "--json" || argument === "--require-agreement") {
      if (seen.has(argument)) throw Error("RECONCILIATION_CLI_ARGUMENTS");
      seen.add(argument);
      if (argument === "--json") json = true;
      else strict = true;
    } else if (typeof argument !== "string" || argument.startsWith("-") || path !== null || !/\.json$/i.test(argument)) {
      throw Error("RECONCILIATION_CLI_ARGUMENTS");
    } else path = argument;
  }
  if (!path) throw Error("RECONCILIATION_CLI_ARGUMENTS");
  return { path, json, strict };
}

export async function inspectReconciliationPath(path) {
  const text = await readBoundedVaultPath(path, RECONCILIATION_FILE_LIMIT);
  const decoded = await decodeReconciliationFile(text);
  return Object.freeze({
    digest: decoded.digest,
    checksumVerified: true,
    authenticated: false,
    report: reconcileWorkspace(decoded.workspace),
    text: reconciliationText(decoded.workspace),
  });
}

/** Exit 0: valid file; 1: invalid input; 2: strict mode lacks agreement for all three slots. */
export async function runReconciliationCheck(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseReconciliationArgs(args);
    const result = await inspectReconciliationPath(options.path);
    stdout.write(options.json ? JSON.stringify({ ...result, text: undefined }, null, 2) + "\n" : result.text);
    if (options.strict && result.report.slots.some(slot => slot.status !== "arithmetic-agreement")) {
      stderr.write("RECONCILIATION_CLI_NOT_ALL_AGREE\n");
      return 2;
    }
    return 0;
  } catch (error) {
    const candidate = error?.code ?? error?.message;
    const safe = typeof candidate === "string" && /^(RECONCILIATION|TRANSFER|IDENTITY|VAULT_CLI)_[A-Z_]+$/.test(candidate)
      ? candidate : "RECONCILIATION_CLI_READ_FAILED";
    stderr.write(safe + "\nUsage: node scripts/check-reconciliation.js file.json [--json] [--require-agreement]\n");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runReconciliationCheck(process.argv.slice(2));
}
