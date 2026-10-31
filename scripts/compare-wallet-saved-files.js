#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectSavedFilePath } from "./inspect-wallet-saved-file.js";
import { compareWalletSavedInspections, walletSavedComparisonText } from "../src/file-read-status.js";
const USAGE = "Usage: node scripts/compare-wallet-saved-files.js before.json after.json [--json]\n" +
  "Validates both supported originals and distinguishes identical text, formatting-only changes, changed originals and different formats.\n" +
  "Auxiliary declarations remain unverified. Output includes source hashes and scope counts, not original addresses, balances or notes.\n" +
  "No network, import or source writes. Exit 0: same verified original; 2: different or unverified; 1: invalid input.\n";
export function parseSavedComparisonArgs(args) {
  if (!Array.isArray(args) || ![2,3].includes(args.length) || args.some(value => typeof value !== "string") ||
      args.slice(0,2).some(value => !value || value.startsWith("-") || !/\.json$/i.test(value) || value.includes("\0")) ||
      (args.length === 3 && args[2] !== "--json")) throw Error("FILE_COMPARISON_CLI_ARGUMENTS");
  return Object.freeze({ before: args[0], after: args[1], json: args.length === 3 });
}
export async function runSavedFileComparison(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseSavedComparisonArgs(args);
    const before = await inspectSavedFilePath(request.before), after = await inspectSavedFilePath(request.after);
    const result = compareWalletSavedInspections(before, after);
    stdout.write(request.json ? JSON.stringify(result, null, 2) + "\n" : walletSavedComparisonText(result) + "\n");
    return result.sameOriginal === true ? 0 : 2;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(FILE|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "FILE_COMPARISON_CLI_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runSavedFileComparison(process.argv.slice(2));
