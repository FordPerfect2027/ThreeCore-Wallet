#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodePeriodLibraryFile, PERIOD_LIBRARY_FILE_LIMIT } from "../src/period-library-file.js";
import { summarizePeriodLibrary } from "../src/period-library-query.js";

export function parseLibraryArgs(args) {
  let path = null, json = false, requireComplete = false;
  const seen = new Set();
  for (const argument of args) {
    if (["--json", "--require-complete"].includes(argument)) {
      if (seen.has(argument)) throw Error("PERIOD_LIBRARY_CLI_ARGUMENTS");
      seen.add(argument);
      if (argument === "--json") json = true;
      else requireComplete = true;
    } else if (typeof argument !== "string" || argument.startsWith("-") || path !== null || !/\.json$/i.test(argument)) {
      throw Error("PERIOD_LIBRARY_CLI_ARGUMENTS");
    } else path = argument;
  }
  if (!path) throw Error("PERIOD_LIBRARY_CLI_ARGUMENTS");
  return { path, json, requireComplete };
}

/** Offline inspection only; output excludes record names, public accounts and amounts. */
export async function inspectLibraryPath(path) {
  const decoded = await decodePeriodLibraryFile(await readBoundedVaultPath(path, PERIOD_LIBRARY_FILE_LIMIT));
  const summary = summarizePeriodLibrary(decoded.document);
  const entries = decoded.document.entries;
  const complete = entries.length > 0 && summary.agents.every(row => row.partial === 0 && row.blocked === 0);
  return Object.freeze({
    entries: summary.count,
    agents: summary.agents,
    allEntriesCollected: complete,
    includesArchived: true,
    digest: decoded.digest,
    checksumVerified: true,
    authenticated: false,
    liveChainRechecked: false,
    eventCountsAreUnique: false,
  });
}

export async function runLibraryCheck(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseLibraryArgs(args);
    const result = await inspectLibraryPath(options.path);
    stdout.write(options.json ? JSON.stringify(result, null, 2) + "\n" :
      "Saved period entries: " + result.entries + " (including archived)\n" +
      result.agents.map(row => row.agent + ": " + row.partial + " partial, " +
        row.complete + " collected, " + row.blocked + " require a new plan").join("\n") + "\n" +
      "Checksum verified; authorship, completeness of onchain logs and current chain state are not certified.\n");
    if (options.requireComplete && !result.allEntriesCollected) {
      stderr.write("PERIOD_LIBRARY_CLI_INCOMPLETE\n");
      return 2;
    }
    return 0;
  } catch (error) {
    const value = error?.code ?? error?.message;
    const safe = typeof value === "string" && /^(PERIOD|TRANSFER|IDENTITY|VAULT_CLI)_[A-Z_]+$/.test(value)
      ? value : "PERIOD_LIBRARY_CLI_READ_FAILED";
    stderr.write(safe + "\nUsage: node scripts/check-period-library.js file.json [--json] [--require-complete]\n");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runLibraryCheck(process.argv.slice(2));
}
