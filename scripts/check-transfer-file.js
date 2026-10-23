#!/usr/bin/env node
/** Offline file inspection. No Wallet discovery, provider, writes or network. */
import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { transferFail } from "../src/transfer-codec.js";
import { readTransferFile, TRANSFER_FILE_LIMIT } from "../src/transfer-file.js";
import { readTransferArchive, TRANSFER_ARCHIVE_FILE_LIMIT } from "../src/transfer-archive-file.js";
import { describeTransferArchive, transferArchiveText } from "../src/transfer-archive.js";
import { compareTransferSnapshots, summarizeTransfers, transferComparisonText, transferSummaryText } from "../src/transfer-view.js";

export function parseTransferCheckOptions(args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string" || !arg) || args.length > 6) {
    transferFail("TRANSFER_CLI_ARGUMENTS");
  }
  let file = null, baseline = null, archive = false, json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json" && !json) json = true;
    else if (arg === "--archive" && !archive) archive = true;
    else if (arg === "--baseline" && !baseline && args[index + 1] && !args[index + 1].startsWith("--")) baseline = args[++index];
    else if (!arg.startsWith("--") && file === null) file = arg;
    else transferFail("TRANSFER_CLI_ARGUMENTS");
  }
  if (!file || (archive && baseline)) transferFail("TRANSFER_CLI_ARGUMENTS");
  return Object.freeze({ file, baseline, archive, json });
}

async function loadFile(path, archive) {
  const handle = await open(resolve(path), "r");
  const limit = archive ? TRANSFER_ARCHIVE_FILE_LIMIT : TRANSFER_FILE_LIMIT;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) transferFail("TRANSFER_FILE_SIZE");
    // A growing file cannot cause an unbounded read after the initial stat.
    const bytes = new Uint8Array(limit + 1);
    let total = 0;
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total !== stat.size || total > limit) transferFail("TRANSFER_FILE_SIZE");
    const selected = bytes.slice(0, total);
    const file = { name: basename(path), size: total, arrayBuffer: async () => selected.slice().buffer };
    return archive ? await readTransferArchive(file) : await readTransferFile(file);
  } finally { await handle.close(); }
}

export async function inspectTransferFiles(options) {
  const current = await loadFile(options.file, options.archive);
  const baseline = options.baseline ? await loadFile(options.baseline, false) : null;
  const comparison = baseline ? compareTransferSnapshots(baseline.snapshot, current.snapshot) : null;
  const assessment = options.archive ? describeTransferArchive(current.archive) : summarizeTransfers(current.snapshot);
  const text = options.archive ? transferArchiveText(current.archive) : transferSummaryText(current.snapshot, "imported") +
    (comparison ? "\n\n" + transferComparisonText(comparison) : "");
  return Object.freeze({
    schema: "threecore.offline-transfer-check.v1",
    kind: options.archive ? "archive" : "snapshot",
    checksumVerified: true,
    authenticated: false,
    digest: current.digest,
    assessment,
    comparison,
    text,
    walletRequests: 0,
    networkRequests: 0,
    filesModified: 0,
  });
}

export async function runTransferCheck(args, output = process.stdout, errors = process.stderr) {
  try {
    const options = parseTransferCheckOptions(args);
    const result = await inspectTransferFiles(options);
    output.write(options.json ? JSON.stringify(result, null, 2) + "\n" : result.text + "\n");
    return 0;
  } catch (error) {
    const code = typeof error?.code === "string" && /^[A-Z_]+$/.test(error.code) ? error.code : "TRANSFER_FILE_READ";
    errors.write("Transfer file check failed: " + code + "\n");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runTransferCheck(process.argv.slice(2));
}
