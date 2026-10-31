#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readSavedTextPath, savedJSONPath, savedCLIError } from "./saved-file-cli-io.js";
import { inspectWalletSavedTextDifferences, reviewWalletSavedTextDifferences, encodeWalletSavedTextDifferenceReview, walletSavedTextDifferenceReviewText, WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT, WALLET_SAVED_DIFFERENCE_REVIEW_LIMIT } from "../src/file-read-status.js";
const USAGE = "Usage: node scripts/verify-wallet-saved-differences.js before.json after.json differences.json [--json]\n" +
  "Recompute plain-source differences and verify the saved locations, counts, flags and source hashes.\n" +
  "No network, import or input writes. Exit 0: faithfully reproduced (even for differing originals); 2: mismatch; 1: invalid input.\n";
export async function runSavedDifferenceReview(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    if (![3,4].includes(args.length) || !args.slice(0,3).every(savedJSONPath) || (args.length === 4 && args[3] !== "--json")) throw Error("FILE_CLI_ARGUMENTS");
    const before = await readSavedTextPath(args[0], WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT), after = await readSavedTextPath(args[1], WALLET_SAVED_DIFFERENCE_SOURCE_LIMIT);
    const expected = await inspectWalletSavedTextDifferences(before, after), text = await readSavedTextPath(args[2], WALLET_SAVED_DIFFERENCE_REVIEW_LIMIT);
    const result = await reviewWalletSavedTextDifferences(expected, text);
    stdout.write(args.length === 4 ? encodeWalletSavedTextDifferenceReview(result) : walletSavedTextDifferenceReviewText(result) + "\n");
    return result.matchesRecomputation ? 0 : 2;
  } catch (error) { stderr.write(savedCLIError(error) + "\n" + USAGE); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runSavedDifferenceReview(process.argv.slice(2));
