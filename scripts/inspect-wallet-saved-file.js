#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { inspectWalletSavedText, walletSavedInspectionText, WALLET_SAVED_INSPECTION_LIMIT } from "../src/file-read-status.js";
const USAGE = "Usage: node scripts/inspect-wallet-saved-file.js source.json [--json]\n" +
  "Identifies period, period-library, report, report-history and report-set originals, validates them and verifies their checksums.\n" +
  "Known auxiliary files receive declared-format guidance only; their contents and conclusions are not verified.\n" +
  "Output contains guidance and counts, not original addresses, balances or note values. It is not a restorable backup.\n" +
  "No network, import or source writes. Exit 0: validated original; 2: auxiliary declaration only; 1: invalid/unsupported input.\n";
export function parseSavedInspectionArgs(args) {
  if (!Array.isArray(args) || ![1,2].includes(args.length) || args.some(value => typeof value !== "string") ||
      !args[0] || args[0].startsWith("-") || !/\.json$/i.test(args[0]) || args[0].includes("\0") ||
      (args.length === 2 && args[1] !== "--json")) throw Error("FILE_INSPECTION_CLI_ARGUMENTS");
  return Object.freeze({ path: args[0], json: args.length === 2 });
}
export async function runSavedFileInspection(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const options = parseSavedInspectionArgs(args);
    const bytes = await readBoundedLocalBytes(options.path, WALLET_SAVED_INSPECTION_LIMIT, {
      fail: code => { throw Error(code); }, sizeCode: "FILE_INSPECTION_SIZE", changedCode: "FILE_INSPECTION_CHANGED", limitCode: "FILE_INSPECTION_LIMIT",
    });
    const result = await inspectWalletSavedText(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
    stdout.write(options.json ? JSON.stringify(result, null, 2) + "\n" : walletSavedInspectionText(result) + "\n");
    return result.validation === "validated-original" ? 0 : 2;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(FILE|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code) ? code : "FILE_INSPECTION_CLI_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runSavedFileInspection(process.argv.slice(2));
