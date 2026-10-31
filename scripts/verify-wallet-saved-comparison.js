#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspectSavedFilePath } from "./inspect-wallet-saved-file.js";
import { readSavedTextPath, savedJSONPath, savedCLIError } from "./saved-file-cli-io.js";
import { reviewWalletSavedComparison, walletSavedComparisonReviewText, WALLET_SAVED_COMPARISON_REVIEW_LIMIT } from "../src/file-read-status.js";
const USAGE = "Usage: node scripts/verify-wallet-saved-comparison.js before.json after.json comparison.json [--json]\n" +
  "Recompute a saved comparison from both selected originals. A faithful changed-original result also passes.\n" +
  "No network, import or input writes. Exit 0: faithfully reproduced; 2: mismatch; 1: invalid input.\n";
export async function runSavedComparisonReview(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    if (![3,4].includes(args.length) || !args.slice(0,3).every(savedJSONPath) || (args.length === 4 && args[3] !== "--json")) throw Error("FILE_CLI_ARGUMENTS");
    const before = await inspectSavedFilePath(args[0]), after = await inspectSavedFilePath(args[1]);
    const text = await readSavedTextPath(args[2], WALLET_SAVED_COMPARISON_REVIEW_LIMIT);
    const receipt = await reviewWalletSavedComparison(before, after, text);
    stdout.write(args.length === 4 ? JSON.stringify(receipt, null, 2) + "\n" : walletSavedComparisonReviewText(receipt) + "\n");
    return receipt.matchesRecomputation ? 0 : 2;
  } catch (error) { stderr.write(savedCLIError(error) + "\n" + USAGE); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runSavedComparisonReview(process.argv.slice(2));
