#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readSavedTextPath, savedJSONPath, savedCLIError } from "./saved-file-cli-io.js";
import { inspectWalletSavedTextDifferences, encodeWalletSavedTextDifferences, walletSavedTextDifferencesText, WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT } from "../src/file-read-status.js";
import { queryWalletSavedTextDifferences, encodeWalletSavedTextDifferencePage, walletSavedTextDifferencePageText } from "../src/file-read-status.js";
const USAGE = "Usage: node scripts/inspect-wallet-saved-differences.js before.json after.json [--json|--csv] [--offset N] [--path TEXT]\n" +
  "Revalidate same-format plain settings, portfolio or rehearsal sources (2 MiB each).\n" +
  "Output hashes, counts and locations only. --offset (0,40,80,...) and --path select a page; path matching is case-sensitive.\n" +
  "--csv exports a scoped page, including an explicit scope row even when no locations match. Array rows match by position.\n" +
  "No network, import or input writes. Exit 0: full parsed JSON values match; 2: differences anywhere (even outside the filter); 1: invalid input.\n";
export function parseSavedDifferencesArgs(args) {
  if (!Array.isArray(args) || args.length < 2 || !args.slice(0,2).every(savedJSONPath)) throw Error("FILE_CLI_ARGUMENTS");
  let format = "text", paged = false; const query = {}, seen = new Set();
  for (let i = 2; i < args.length; i++) {
    const key = args[i]; if (seen.has(key)) throw Error("FILE_CLI_ARGUMENTS"); seen.add(key);
    if (key === "--json" || key === "--csv") { if (format !== "text") throw Error("FILE_CLI_ARGUMENTS"); format = key.slice(2); if (format === "csv") paged = true; }
    else if (key === "--offset" || key === "--path") {
      const value = args[++i]; if (typeof value !== "string" || value.startsWith("--")) throw Error("FILE_CLI_ARGUMENTS"); paged = true;
      if (key === "--offset") { if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 200000 || Number(value) % 40) throw Error("FILE_CLI_ARGUMENTS"); query.offset = Number(value); }
      else { if (value.length > 128 || /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/.test(value)) throw Error("FILE_CLI_ARGUMENTS"); query.pathIncludes = value; }
    } else throw Error("FILE_CLI_ARGUMENTS");
  }
  return Object.freeze({ before: args[0], after: args[1], format, paged, query: Object.freeze(query) });
}
export async function runSavedDifferences(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseSavedDifferencesArgs(args);
    const before = await readSavedTextPath(request.before, WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT), after = await readSavedTextPath(request.after, WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT);
    const result = await inspectWalletSavedTextDifferences(before, after);
    if (request.paged) { const page = queryWalletSavedTextDifferences(result, request.query); stdout.write(request.format === "text" ? walletSavedTextDifferencePageText(page) + "\n" : encodeWalletSavedTextDifferencePage(page, request.format)); }
    else stdout.write(request.format === "json" ? encodeWalletSavedTextDifferences(result) : walletSavedTextDifferencesText(result) + "\n");
    return result.parsedJSONValuesMatch ? 0 : 2;
  } catch (error) { stderr.write(savedCLIError(error) + "\n" + USAGE); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runSavedDifferences(process.argv.slice(2));
