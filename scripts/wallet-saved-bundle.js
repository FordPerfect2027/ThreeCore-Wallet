#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readSavedTextPath, savedJSONPath, savedCLIError } from "./saved-file-cli-io.js";
import { prepareWalletSavedSourceBundle, reviewWalletSavedBundle, walletSavedBundleSourceFile, walletSavedBundleReviewText, encodeWalletSavedBundleReview,
  WALLET_SAVED_BUNDLE_SOURCE_LIMIT, WALLET_SAVED_BUNDLE_LIMIT } from "../src/file-read-status.js";
const USAGE = "Usage: node scripts/wallet-saved-bundle.js create before.json after.json\n" +
  "       node scripts/wallet-saved-bundle.js check bundle.json [--json]\n" +
  "       node scripts/wallet-saved-bundle.js extract bundle.json before|after\n" +
  "Create emits both complete plaintext originals (combined maximum 24 MiB); check validates a bundle up to 48 MiB.\n" +
  "Validated plain settings, portfolio and rehearsal sources are supported with explicit non-checksummed scope.\n" +
  "Extract emits an exact original only after a faithful comparison review, retaining restrictions and annotations.\n" +
  "Output goes to stdout. No network, import or input writes. Exit 0: success; 2: comparison mismatch (no extraction); 1: invalid input.\n";
export async function runSavedBundle(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const [mode, path, option] = args;
    if (mode === "create" && args.length === 3 && [path, option].every(savedJSONPath)) {
      const before = await readSavedTextPath(path, WALLET_SAVED_BUNDLE_SOURCE_LIMIT), after = await readSavedTextPath(option, WALLET_SAVED_BUNDLE_SOURCE_LIMIT);
      const result = await prepareWalletSavedSourceBundle(before, after); stdout.write(result.text); return 0;
    }
    if (!savedJSONPath(path) || !((mode === "check" && (args.length === 2 || (args.length === 3 && option === "--json"))) ||
        (mode === "extract" && args.length === 3 && ["before", "after"].includes(option)))) throw Error("FILE_CLI_ARGUMENTS");
    const receipt = await reviewWalletSavedBundle(await readSavedTextPath(path, WALLET_SAVED_BUNDLE_LIMIT));
    if (mode === "check") stdout.write(option === "--json" ? encodeWalletSavedBundleReview(receipt) : walletSavedBundleReviewText(receipt) + "\n");
    if (!(receipt.sourceFilesAvailable ?? receipt.originalsAvailable)) { if (mode === "extract") stderr.write("FILE_BUNDLE_COMPARISON_MISMATCH\n"); return 2; }
    if (mode === "extract") stdout.write(walletSavedBundleSourceFile(receipt, option).text);
    return 0;
  } catch (error) { stderr.write(savedCLIError(error) + "\n" + USAGE); return 1; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runSavedBundle(process.argv.slice(2));
