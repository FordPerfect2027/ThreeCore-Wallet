#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readSavedTextPath, savedJSONPath, savedCLIError } from "./saved-file-cli-io.js";
import { inspectWalletSavedTextDifferences, encodeWalletSavedTextDifferences, walletSavedTextDifferencesText, WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT } from "../src/file-read-status.js";
const USAGE = "Usage: node scripts/inspect-wallet-saved-differences.js before.json after.json [--json]\n" +
  "Revalidate same-format plain settings, portfolio or rehearsal sources (2 MiB each).\n" +
  "Output only hashes, scope counts and the first 40 differing JSON locations; array rows match by position.\n" +
  "No network, import or input writes. Exit 0: parsed JSON values match; 2: differences; 1: invalid input.\n";
export async function runSavedDifferences(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    if (![2,3].includes(args.length) || !args.slice(0,2).every(savedJSONPath) || (args.length === 3 && args[2] !== "--json")) throw Error("FILE_CLI_ARGUMENTS");
    const before = await readSavedTextPath(args[0], WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT), after = await readSavedTextPath(args[1], WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT);
    const result = await inspectWalletSavedTextDifferences(before, after);
    stdout.write(args.length === 3 ? encodeWalletSavedTextDifferences(result) : walletSavedTextDifferencesText(result) + "\n");
    return result.parsedJSONValuesMatch ? 0 : 2;
  } catch (error) { stderr.write(savedCLIError(error) + "\n" + USAGE); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runSavedDifferences(process.argv.slice(2));
