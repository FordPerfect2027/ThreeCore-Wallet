import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { decodeWorkspaceFile, WORKSPACE_FILE_LIMIT } from "../src/workspace-file.js";
import { workspaceToDraft } from "../src/workspace-format.js";
import { summarizeWorkspace } from "../src/workspace-overview.js";

/** Offline read-back of a downloaded file. Never writes the file or contacts a provider. */
export async function inspectWorkspaceBackup(filename) {
  if (typeof filename !== "string" || !filename || filename.includes("\0") ||
      extname(filename).toLowerCase() !== ".json") throw Error("Choose one .json workspace backup");
  const bytes = await readBoundedLocalBytes(resolve(filename), WORKSPACE_FILE_LIMIT, {
    fail: message => { throw Error(message); },
    sizeCode: "Backup file is empty, not a regular file, or exceeds the size limit",
    changedCode: "Backup file changed while being read",
  });
  const byteLength = bytes.length, decoded = await decodeWorkspaceFile(bytes);
  const summary = summarizeWorkspace(workspaceToDraft(decoded.workspace));
  // Keep routine reports free of full addresses and balances. The source backup
  // still contains public account data and should be shared deliberately.
  return Object.freeze({
    schema: "threecore-backup-check-v1",
    byteLength,
    checksumVerified: true,
    digest: decoded.digest,
    configuredCards: summary.configured,
    totalObservations: summary.totalObservations,
    cards: Object.freeze(summary.cards.map(card => Object.freeze({
      agent: card.agent,
      chainId: card.chainId,
      accountConfigured: card.accountStatus === "configured",
      configuredTokens: card.tokens.count,
      observations: card.historyCount,
      remainingCapacity: card.remainingCapacity,
      observationGroups: card.groups.length,
      historicalRecordsOutsideConfiguration: card.unrelatedObservations,
      unknownTokenBalances: card.groups.reduce((total, group) => total + group.unknownTokens, 0),
    }))),
    restored: false,
    currentBalanceVerified: false,
    ownershipVerified: false,
    independentSecurityAudit: false,
  });
}

export function formatBackupCheck(report) {
  const lines = ["ThreeCore workspace backup: checksum verified",
    "Bytes: " + report.byteLength,
    "Configured cards: " + report.configuredCards + "/3",
    "Historical observations: " + report.totalObservations];
  for (const card of report.cards) {
    lines.push(card.agent + ": chain " + card.chainId + ", " + card.configuredTokens +
      " configured tokens, " + card.observations + " observations, " + card.remainingCapacity + " free slots",
    "  Historical records outside current configuration: " + card.historicalRecordsOutsideConfiguration +
      "; unknown token balances in latest groups: " + card.unknownTokenBalances);
  }
  lines.push("No restoration or network access was performed.",
    "A checksum does not establish ownership, current balances, authenticity, or security.");
  return lines.join("\n");
}

export function parseBackupArguments(args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string")) throw Error("Invalid arguments");
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if ((args.length !== 2 && args.length !== 3) || args[0] !== "--file" || !args[1] ||
      args[1].startsWith("--") || (args.length === 3 && args[2] !== "--json")) {
    throw Error("Usage: node scripts/check-workspace-backup.js --file <backup.json> [--json]");
  }
  return { help: false, filename: args[1], json: args[2] === "--json" };
}

export async function runBackupCheck(args, { output = console.log, error = console.error } = {}) {
  try {
    const options = parseBackupArguments(args);
    if (options.help) {
      output("Usage: node scripts/check-workspace-backup.js --file <backup.json> [--json]");
      output("Reads one local file without restoring it or accessing the network.");
      return 0;
    }
    const report = await inspectWorkspaceBackup(options.filename);
    output(options.json ? JSON.stringify(report, null, 2) : formatBackupCheck(report));
    return 0;
  } catch (failure) {
    // Do not echo potentially private filesystem paths or contents from errors.
    const code = typeof failure?.code === "string" && /^[A-Z_]{1,50}$/.test(failure.code) ? failure.code : "INVALID_BACKUP";
    error("Workspace backup check failed: " + code + ". Check the filename, format, and original backup.");
    return 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runBackupCheck(process.argv.slice(2));
}
