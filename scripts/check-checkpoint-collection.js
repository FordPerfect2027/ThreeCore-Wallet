import { open } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeCheckpointCollection, CHECKPOINT_TRANSFER_LIMIT } from "../src/checkpoint-transfer.js";
import { decodeWorkspaceFile } from "../src/workspace-file.js";
import { workspaceToDraft } from "../src/workspace-format.js";
import { summarizeWorkspace } from "../src/workspace-overview.js";

const USAGE = "node scripts/check-checkpoint-collection.js --file <checkpoints.json> [--json]";

/** Read one existing file; neither browser storage nor the original file is changed. */
export async function inspectCheckpointCollection(filename) {
  if (typeof filename !== "string" || !filename || filename.includes("\0") ||
      extname(filename).toLowerCase() !== ".json") throw Error("Choose a JSON collection");
  const handle = await open(resolve(filename), "r");
  let bytes;
  try {
    const before = await handle.stat();
    if (!before.isFile() || !Number.isSafeInteger(before.size) ||
        before.size < 1 || before.size > CHECKPOINT_TRANSFER_LIMIT) throw Error("Invalid file size");
    bytes = new Uint8Array(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!read.bytesRead) throw Error("File changed during inspection");
      offset += read.bytesRead;
    }
    const extra = await handle.read(new Uint8Array(1), 0, 1, bytes.length);
    const after = await handle.stat();
    if (extra.bytesRead || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw Error("File changed during inspection");
    }
  } finally {
    await handle.close();
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const decoded = await decodeCheckpointCollection(text);
  const snapshots = [];
  for (const [index, entry] of decoded.entries.entries()) {
    const file = await decodeWorkspaceFile(new TextEncoder().encode(entry.fileText));
    const summary = summarizeWorkspace(workspaceToDraft(file.workspace));
    // Labels, full addresses and balances are intentionally absent from routine reports.
    snapshots.push(Object.freeze({
      position: index + 1,
      archived: entry.archived,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      configuredCards: summary.configured,
      historicalObservations: summary.totalObservations,
      agents: Object.freeze(summary.cards.map(card => Object.freeze({
        agent: card.agent, chainId: card.chainId,
        configuredTokens: card.tokens.count, historicalObservations: card.historyCount,
      }))),
    }));
  }
  return Object.freeze({
    schema: "threecore-checkpoint-inspection-v1",
    checksumVerified: true,
    nestedChecksumsVerified: decoded.entries.length,
    byteLength: bytes.byteLength,
    snapshots: Object.freeze(snapshots),
    activeCount: decoded.entries.filter(entry => !entry.archived).length,
    archivedCount: decoded.entries.filter(entry => entry.archived).length,
    restored: false,
    networkAccess: false,
    currentBalanceVerified: false,
    ownershipVerified: false,
    independentSecurityAudit: false,
  });
}

export function formatCheckpointInspection(report) {
  const lines = [
    "ThreeCore saved-checkpoint collection: checksums verified",
    "File bytes: " + report.byteLength,
    "Active checkpoints: " + report.activeCount,
    "Archived checkpoints: " + report.archivedCount,
    "Verified workspace files: " + report.nestedChecksumsVerified,
  ];
  for (const snapshot of report.snapshots) {
    lines.push("Checkpoint " + snapshot.position + " (" + (snapshot.archived ? "archived" : "active") + "):",
      "  Created " + snapshot.createdAt + "; updated " + snapshot.updatedAt,
      "  Configured cards " + snapshot.configuredCards + "/3; historical observations " + snapshot.historicalObservations);
    for (const agent of snapshot.agents) {
      lines.push("  " + agent.agent + ": chain " + agent.chainId + ", " +
        agent.configuredTokens + " tokens, " + agent.historicalObservations + " historical observations");
    }
  }
  lines.push("No restore, overwrite, network access, or wallet request was performed.",
    "Checksum verification does not prove authenticity, ownership, current balances, or security.");
  return lines.join("\n");
}

export function parseCheckpointArguments(args) {
  if (!Array.isArray(args) || args.some(value => typeof value !== "string")) throw Error("Invalid arguments");
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if (![2, 3].includes(args.length) || args[0] !== "--file" || !args[1] ||
      args[1].startsWith("--") || args.length === 3 && args[2] !== "--json") throw Error(USAGE);
  return { filename: args[1], json: args[2] === "--json" };
}

export async function runCheckpointInspection(args, { output = console.log, error = console.error } = {}) {
  try {
    const options = parseCheckpointArguments(args);
    if (options.help) {
      output("Usage: " + USAGE);
      output("Read-only inspection of a local saved-checkpoint collection.");
      return 0;
    }
    const report = await inspectCheckpointCollection(options.filename);
    output(options.json ? JSON.stringify(report, null, 2) : formatCheckpointInspection(report));
    return 0;
  } catch (failure) {
    const code = typeof failure?.code === "string" && /^[A-Z_]{1,50}$/.test(failure.code)
      ? failure.code : "INVALID_COLLECTION";
    error("Saved-checkpoint inspection failed: " + code + ". Preserve the original file and check its format.");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runCheckpointInspection(process.argv.slice(2));
}

