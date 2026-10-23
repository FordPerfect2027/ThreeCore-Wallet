#!/usr/bin/env node
import { open } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { decodeVaultFile, VAULT_FILE_LIMIT } from "../src/transfer-vault-file.js";
import { decodeVaultCollection, VAULT_COLLECTION_LIMIT } from "../src/transfer-vault-collection.js";
import { vaultActivityText, summarizeVaultActivity } from "../src/transfer-vault-analytics.js";
import { vaultMetadata } from "../src/transfer-vault-model.js";

export function parseVaultArgs(args) {
  let path = null, collection = false, json = false;
  const seen = new Set();
  for (const argument of args) {
    if (argument === "--collection" || argument === "--json") {
      if (seen.has(argument)) throw Error("VAULT_CLI_ARGUMENTS");
      seen.add(argument);
      if (argument === "--collection") collection = true;
      else json = true;
    } else if (typeof argument !== "string" || argument.startsWith("--") || path !== null || !argument.endsWith(".json")) {
      throw Error("VAULT_CLI_ARGUMENTS");
    } else path = argument;
  }
  if (!path) throw Error("VAULT_CLI_ARGUMENTS");
  return { path, collection, json };
}

/** Fixed upper bound even if a file grows after stat; does not write or use RPC. */
export async function readBoundedVaultPath(path, limit) {
  const handle = await open(path, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw Error("VAULT_CLI_FILE_SIZE");
    const chunks = [];
    let total = 0;
    while (total <= limit) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1 - total));
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (!bytesRead) break;
      chunks.push(buffer.subarray(0, bytesRead));
      total += bytesRead;
      if (total > limit) throw Error("VAULT_CLI_FILE_SIZE");
    }
    if (total !== stat.size) throw Error("VAULT_CLI_FILE_CHANGED");
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total));
  } finally { await handle.close(); }
}

export async function inspectVaultPath(options) {
  const text = await readBoundedVaultPath(options.path, options.collection ? VAULT_COLLECTION_LIMIT : VAULT_FILE_LIMIT);
  if (options.collection) {
    const result = await decodeVaultCollection(text);
    return { kind: "saved-collection", checksumVerified: true, authenticated: false,
      metadata: vaultMetadata(result.document),
      records: result.document.entries.map(row => ({ id: row.id, label: row.label, archived: row.archived,
        tokens: summarizeVaultActivity(row.bundle) })) };
  }
  const result = await decodeVaultFile(text);
  return { kind: "working-bundle", checksumVerified: true, authenticated: false,
    tokens: summarizeVaultActivity(result.bundle), text: vaultActivityText(result.bundle) };
}

export async function runVaultCheck(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const options = parseVaultArgs(args);
    const result = await inspectVaultPath(options);
    if (options.json) stdout.write(JSON.stringify(result, null, 2) + "\n");
    else if (result.kind === "working-bundle") stdout.write(result.text + "\nChecksum verified; source authenticity and live chain state are unverified.\n");
    else stdout.write(`Saved collection: ${result.metadata.count} entries, ${result.metadata.bytes} bytes.\n` +
      result.metadata.entries.map(row => `${row.id} / ${row.label} / ${row.archived ? "archived" : "active"} / ${row.records} periods`).join("\n") +
      "\nChecksum verified; no files or browser records were changed.\n");
    return 0;
  } catch (error) {
    const value = error?.code ?? error?.message;
    const safe = typeof value === "string" && /^(TRANSFER|VAULT_CLI)_[A-Z_]+$/.test(value) ? value : "VAULT_CLI_READ_FAILED";
    stderr.write(safe + "\nUsage: npm run vault:check -- file.json [--collection] [--json]\n");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runVaultCheck(process.argv.slice(2));
}
