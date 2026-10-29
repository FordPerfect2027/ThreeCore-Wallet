#!/usr/bin/env node
/** Bounded offline verification of an explicitly supplied rehearsal file. */
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { decodeRehearsal, evaluateRehearsal, REHEARSAL_LIMIT, RehearsalError } from "../src/operation-rehearsal.js";
import { decodeRehearsalWorkspace, reportRehearsalWorkspace, REHEARSAL_WORKSPACE_LIMIT } from "../src/operation-rehearsal-workspace.js";

const fail = code => { throw new RehearsalError(code); };
export function parseRehearsalCheckArgs(args) {
  if (!Array.isArray(args) || args.length > 5 || args.some(value => typeof value !== "string" || !value)) fail("CLI_ARGUMENTS");
  let file = null, expectedHash = null, json = false, workspace = false;
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === "--json" && !json) json = true;
    else if (value === "--workspace" && !workspace) workspace = true;
    else if (value === "--sha256" && expectedHash === null) {
      expectedHash = args[++i];
      if (typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/i.test(expectedHash)) fail("CLI_ARGUMENTS");
      expectedHash = expectedHash.toLowerCase();
    } else if (!value.startsWith("--") && file === null) file = value;
    else fail("CLI_ARGUMENTS");
  }
  if (!file) fail("CLI_ARGUMENTS");
  return { file, expectedHash, json, workspace };
}
export async function inspectRehearsalFile(file, expectedHash = null, workspace = false) {
  if (typeof workspace !== "boolean" || typeof file !== "string" || !file || (expectedHash !== null &&
      (typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/.test(expectedHash)))) fail("CLI_ARGUMENTS");
  const limit = workspace ? REHEARSAL_WORKSPACE_LIMIT : REHEARSAL_LIMIT;
  const handle = await open(resolve(file), "r");
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) fail("FILE_TOO_LARGE");
    const buffer = new Uint8Array(limit + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total);
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total !== stat.size || total > limit) fail("FILE_CHANGED_OR_TOO_LARGE");
    bytes = buffer.slice(0, total);
  } finally { await handle.close(); }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (expectedHash !== null && sha256 !== expectedHash) fail("CHECKSUM_MISMATCH");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("INVALID_UTF8"); }
  const report = workspace ? reportRehearsalWorkspace(decodeRehearsalWorkspace(text)) : evaluateRehearsal(decodeRehearsal(text));
  return { schema: workspace ? "threecore.offline-rehearsal-workspace-check.v1" : "threecore.offline-rehearsal-check.v1", sha256, byteLength: bytes.length,
    expectedChecksumMatched: expectedHash === null ? null : true, authenticated: false,
    simulationOnly: true, sourceVerified: false, authorizesExecution: false,
    constraintsSatisfied: workspace ? report.constraintsSatisfied : report.rows.every(row => row.withinEnteredLimits) && report.allocationShortfall === "0",
    rejectedRecords: workspace ? report.rows.filter(row => row.present).flatMap(row =>
      row.report.rows.filter(event => !event.withinEnteredLimits).map(event => ({ agent: row.agent, id: event.id, reasons: event.reasons })))
      : report.rows.filter(row => !row.withinEnteredLimits).map(row => ({ id: row.id, reasons: row.reasons })),
    networkRequests: 0, walletRequests: 0, filesModified: 0, report };
}
export async function runRehearsalCheck(args, output = process.stdout, errors = process.stderr) {
  try {
    const options = parseRehearsalCheckArgs(args);
    const result = await inspectRehearsalFile(options.file, options.expectedHash, options.workspace);
    output.write(options.json ? JSON.stringify(result, null, 2) + "\n" :
      ["Fictional rehearsal file verified and recalculated (not authenticated).",
        ...(options.workspace ? result.report.rows.map(row => row.present ?
          row.agent + ": " + row.recordCount + " records; P&L " + row.report.realizedPnl + "; reserved " + row.report.reservedAllocations + " (base units)"
          : row.agent + ": absent (not zero)") : ["Agent: " + result.report.agent]), "SHA-256: " + result.sha256,
        "Entered constraints satisfied: " + result.constraintsSatisfied,
        ...(options.workspace ? [] : ["Realized P&L in base units: " + result.report.realizedPnl,
        "Reserved allocation in base units: " + result.report.reservedAllocations,
        "Remaining hypothetical allocation in base units: " + result.report.proposedOwnTokenBuybackBudget]),
        "Network / wallet requests: 0 / 0. No execution authorized."].join("\n") + "\n");
    return result.constraintsSatisfied ? 0 : 2;
  } catch (error) {
    errors.write("Rehearsal check failed: " + (error?.code ?? "FILE_READ_FAILED") + "\n");
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runRehearsalCheck(process.argv.slice(2));
