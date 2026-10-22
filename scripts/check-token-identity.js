#!/usr/bin/env node
/** Inspect downloaded records locally. No wallet, RPC or network dependencies. */
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeTokenIdentityFile, IDENTITY_FILE_LIMIT } from "../src/token-identity-report.js";
import { assessTokenObservation, compareTokenObservations } from "../src/token-identity-model.js";
import { describeTokenObservation, describeTokenComparison } from "../src/token-identity-view.js";
import { identityFail } from "../src/token-identity-codec.js";

export function parseIdentityCheckOptions(args) {
  if (!Array.isArray(args) || args.length > 5 || args.some(arg => typeof arg !== "string" || !arg)) {
    identityFail("IDENTITY_CLI_ARGUMENTS");
  }
  let json = false;
  let baseline = null;
  let file = null;
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === "--json") {
      if (json) identityFail("IDENTITY_CLI_ARGUMENTS");
      json = true;
    } else if (value === "--baseline") {
      if (baseline || !args[index + 1] || args[index + 1].startsWith("--")) identityFail("IDENTITY_CLI_ARGUMENTS");
      baseline = args[++index];
    } else if (value.startsWith("--") || file) identityFail("IDENTITY_CLI_ARGUMENTS");
    else file = value;
  }
  if (!file) identityFail("IDENTITY_CLI_ARGUMENTS");
  return Object.freeze({ file, baseline, json });
}

async function load(path) {
  const handle = await open(resolve(path), "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > IDENTITY_FILE_LIMIT) identityFail("IDENTITY_FILE_SIZE");
    // Read at most the limit plus one byte, even if another process grows it.
    const buffer = new Uint8Array(IDENTITY_FILE_LIMIT + 1);
    let total = 0;
    while (total < buffer.length) {
      const result = await handle.read(buffer, total, buffer.length - total, total);
      if (result.bytesRead === 0) break;
      total += result.bytesRead;
    }
    if (total !== stat.size || total > IDENTITY_FILE_LIMIT) identityFail("IDENTITY_FILE_SIZE");
    return await decodeTokenIdentityFile(buffer.slice(0, total));
  } finally { await handle.close(); }
}

export async function inspectIdentityFiles(options) {
  const current = await load(options.file);
  const baseline = options.baseline ? await load(options.baseline) : null;
  const assessment = assessTokenObservation(current.observation);
  const comparison = baseline ? compareTokenObservations(baseline.observation, current.observation) : null;
  return Object.freeze({
    schema: "threecore-local-identity-check-v1",
    observation: current.observation,
    digest: current.digest,
    checksumVerified: true,
    authenticated: false,
    assessment,
    comparison,
    text: describeTokenObservation(current.observation, "imported") +
      (baseline ? "\n\n" + describeTokenComparison(baseline.observation, current.observation) : ""),
    networkRequests: 0,
    walletRequests: 0,
    filesModified: 0,
  });
}

export async function runIdentityCheck(args, output = process.stdout, errors = process.stderr) {
  try {
    const options = parseIdentityCheckOptions(args);
    const result = await inspectIdentityFiles(options);
    output.write(options.json ? JSON.stringify(result, null, 2) + "\n" : result.text + "\n");
    return 0;
  } catch (error) {
    errors.write("Token record check failed: " + (error?.code ?? "IDENTITY_FILE_READ") + "\n");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runIdentityCheck(process.argv.slice(2));
}
