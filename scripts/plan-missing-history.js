#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedVaultPath } from "./check-transfer-vault.js";
import { decodeReportSetFile, REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { reportSetMissingHistoryQueue, missingHistoryQueueText } from "../src/report-set-timeline.js";
import { analyzeReportSet } from "../src/report-set-engine.js";
import { periodBlock } from "../src/period-plan.js";

const USAGE = "Usage: node scripts/plan-missing-history.js file.json --group DAT-1 [--kind pending|unplanned] [--window-size 1..2000] [--page 1..N] [--format json|text] [--require-empty]\n" +
  "Group IDs are local to the selected report set. Inspect the full account/chain in the output. Pages contain at most ten proposed windows, newest first; --page is one-based.\n" +
  "pending selects planned ranges without saved records; unplanned selects gaps between plans. Recorded ranges needing review are excluded. Nothing is executed. No network or input-file writes.\n" +
  "--require-empty exits 2 if any selected missing range exists across all pages. Exit 0 is not whole-source continuity or complete history. JSON contains public account/range data and is not a restorable backup.\n";
const fail = () => { throw Error("HISTORY_QUEUE_CLI_ARGUMENTS"); };
export function parseMissingHistoryArgs(args) {
  if (!Array.isArray(args) || args.length < 3 || args.length > 12 || args.some(value => typeof value !== "string") ||
      !args[0] || args[0].startsWith("-") || !/\.json$/i.test(args[0]) || args[0].includes("\0")) fail();
  const flags = new Map();
  for (let index = 1; index < args.length;) {
    const flag = args[index++];
    if (!["--group", "--kind", "--window-size", "--page", "--format", "--require-empty"].includes(flag) || flags.has(flag)) fail();
    if (flag === "--require-empty") { flags.set(flag, true); continue; }
    if (index === args.length) fail();
    flags.set(flag, args[index++]);
  }
  const groupId = flags.get("--group"), kind = flags.get("--kind") ?? "pending", size = flags.get("--window-size") ?? "2000";
  const page = flags.get("--page") ?? "1", format = flags.get("--format") ?? "json";
  if (typeof groupId !== "string" || !/^(DAT|EMA|CAWELON)-[1-9][0-9]?$/.test(groupId) || !["pending", "unplanned"].includes(kind) ||
      !/^[1-9][0-9]{0,3}$/.test(size) || Number(size) > 2000 || !/^[1-9][0-9]{0,77}$/.test(page) || !["json", "text"].includes(format)) fail();
  const pageIndex = (BigInt(page) - 1n).toString();
  try { periodBlock(pageIndex); } catch { fail(); }
  return Object.freeze({ path: args[0], query: Object.freeze({ groupId, kind, windowSize: Number(size), page: pageIndex }),
    format, requireEmpty: flags.has("--require-empty") });
}

export async function runMissingHistoryPlan(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseMissingHistoryArgs(args);
    const decoded = await decodeReportSetFile(await readBoundedVaultPath(request.path, REPORT_SET_FILE_LIMIT));
    const queue = reportSetMissingHistoryQueue(decoded.input, request.query), source = analyzeReportSet(decoded.input);
    const result = { ...queue, sourcePayloadDigest: decoded.digest, sourceChecksumVerified: true,
      sourceSummary: { allContinuous: source.allContinuous, status: source.status, issues: source.issues, conclusionsUseAllSourceEvidence: true },
      authenticated: false, encrypted: false, restorable: false };
    stdout.write(request.format === "json" ? JSON.stringify(result, null, 2) + "\n" : missingHistoryQueueText(queue) +
      "\nSource payload SHA-256: " + decoded.digest + "\nWhole-source continuity: " + source.allContinuous +
      "; issues: " + (source.issues.join(", ") || "none") + "\nChecksum verified; source authenticity and current chain state remain unverified.\n");
    if (request.requireEmpty && queue.totalBlocks !== "0") { stderr.write("HISTORY_QUEUE_CLI_MISSING_RANGES\n"); return 2; }
    return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(HISTORY_QUEUE_CLI|PERIOD|TRANSFER|IDENTITY|RECONCILIATION|VAULT_CLI)_[A-Z_]+$/.test(code)
      ? code : "HISTORY_QUEUE_CLI_READ_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)
  process.exitCode = await runMissingHistoryPlan(process.argv.slice(2));
