#!/usr/bin/env node
/** Offline inspection: no provider discovery, network access or file writes. */
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeAllowanceFile, ALLOWANCE_FILE_LIMIT } from "../src/allowance-file.js";
import { summarizeAllowances, compareAllowances } from "../src/allowance-observation.js";
import { describeAllowanceTargets, describeAllowanceObservation, describeAllowanceComparison } from "../src/allowance-view.js";
import { allowanceFail } from "../src/allowance-targets.js";

export function parseAllowanceCheckOptions(args) {
  if (!Array.isArray(args) || args.length > 5 || args.some(arg => typeof arg !== "string" || !arg)) {
    allowanceFail("ALLOWANCE_CLI_ARGUMENTS");
  }
  let json = false, baseline = null, file = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json") {
      if (json) allowanceFail("ALLOWANCE_CLI_ARGUMENTS");
      json = true;
    } else if (arg === "--baseline") {
      if (baseline || !args[i + 1] || args[i + 1].startsWith("--")) allowanceFail("ALLOWANCE_CLI_ARGUMENTS");
      baseline = args[++i];
    } else if (arg.startsWith("--") || file) allowanceFail("ALLOWANCE_CLI_ARGUMENTS");
    else file = arg;
  }
  if (!file) allowanceFail("ALLOWANCE_CLI_ARGUMENTS");
  return Object.freeze({ file, baseline, json });
}
async function load(path) {
  const handle = await open(resolve(path), "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > ALLOWANCE_FILE_LIMIT) allowanceFail("ALLOWANCE_FILE_SIZE");
    const buffer = new Uint8Array(ALLOWANCE_FILE_LIMIT + 1);
    let total = 0;
    while (total < buffer.length) {
      const result = await handle.read(buffer, total, buffer.length - total, total);
      if (result.bytesRead === 0) break;
      total += result.bytesRead;
    }
    if (total !== stat.size || total > ALLOWANCE_FILE_LIMIT) allowanceFail("ALLOWANCE_FILE_SIZE");
    return await decodeAllowanceFile(buffer.slice(0, total));
  } finally { await handle.close(); }
}
export async function inspectAllowanceFiles(options) {
  const current = await load(options.file);
  const baseline = options.baseline ? await load(options.baseline) : null;
  if (baseline && (baseline.kind !== "observation" || current.kind !== "observation")) allowanceFail("ALLOWANCE_COMPARE_KIND");
  const observation = current.kind === "observation";
  const assessment = observation ? summarizeAllowances(current.payload) : null;
  const comparison = baseline ? compareAllowances(baseline.payload, current.payload) : null;
  return Object.freeze({
    schema: "threecore-local-allowance-check-v1",
    kind: current.kind, payload: current.payload,
    digest: current.digest, checksumVerified: true, authenticated: false,
    assessment, comparison,
    text: (observation ? describeAllowanceObservation(current.payload, "imported") : describeAllowanceTargets(current.payload)) +
      (baseline ? "\n\n" + describeAllowanceComparison(baseline.payload, current.payload) : ""),
    networkRequests: 0, walletRequests: 0, filesModified: 0,
  });
}
export async function runAllowanceCheck(args, output = process.stdout, errors = process.stderr) {
  try {
    const options = parseAllowanceCheckOptions(args);
    const result = await inspectAllowanceFiles(options);
    output.write(options.json ? JSON.stringify(result, null, 2) + "\n" : result.text + "\n");
    return 0;
  } catch (error) {
    errors.write("Allowance file check failed: " + (error?.code ?? "ALLOWANCE_FILE_READ") + "\n");
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runAllowanceCheck(process.argv.slice(2));
}
