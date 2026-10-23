#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodePeriodFile, PERIOD_FILE_LIMIT } from "../src/period-file.js";
import { periodDraftProgress } from "../src/period-draft.js";

export function parsePeriodArgs(args) {
  let path = null;
  let json = false;
  let requireComplete = false;
  const seen = new Set();
  for (const argument of args) {
    if (["--json", "--require-complete"].includes(argument)) {
      if (seen.has(argument)) throw Error("PERIOD_CLI_ARGUMENTS");
      seen.add(argument);
      if (argument === "--json") json = true;
      else requireComplete = true;
    } else if (typeof argument !== "string" || argument.startsWith("-") || path !== null || !/\.json$/i.test(argument)) {
      throw Error("PERIOD_CLI_ARGUMENTS");
    } else path = argument;
  }
  if (!path) throw Error("PERIOD_CLI_ARGUMENTS");
  return { path, json, requireComplete };
}

/** Inspection is read-only and omits full accounts, endpoint balances and event counterparties. */
export async function inspectPeriodPath(path) {
  const decoded = await decodePeriodFile(await readBoundedVaultPath(path, PERIOD_FILE_LIMIT));
  const plan = decoded.draft.plan;
  return Object.freeze({
    agent: plan.context.agent, chainId: plan.context.chainId,
    earlierBlock: plan.earlierBlock, laterBlock: plan.laterBlock,
    ...periodDraftProgress(decoded.draft), digest: decoded.digest,
    checksumVerified: true, authenticated: false, liveChainRechecked: false,
  });
}

export async function runPeriodCheck(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parsePeriodArgs(args);
    const result = await inspectPeriodPath(options.path);
    stdout.write(options.json ? JSON.stringify(result, null, 2) + "\n" :
      `${result.agent} / chain ${result.chainId}\nPeriod (${result.earlierBlock}, ${result.laterBlock}]\n` +
      `Collected: ${result.completed}/${result.total} steps; ${result.events} events\n` +
      "Checksum verified; provenance and live chain state are not verified.\n");
    if (options.requireComplete && !result.complete) {
      stderr.write("PERIOD_CLI_INCOMPLETE\n");
      return 2;
    }
    return 0;
  } catch (error) {
    const value = error?.code ?? error?.message;
    const safe = typeof value === "string" && /^(PERIOD|TRANSFER|IDENTITY|VAULT_CLI)_[A-Z_]+$/.test(value)
      ? value : "PERIOD_CLI_READ_FAILED";
    stderr.write(safe + "\nUsage: node scripts/check-period.js file.json [--json] [--require-complete]\n");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runPeriodCheck(process.argv.slice(2));
}
