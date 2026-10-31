#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { parsePortfolioHistoryArgs } from "./inspect-portfolio-history.js";
import { prepareHistoryArchives, HISTORY_ARCHIVE_FILE_LIMIT, HISTORY_ARCHIVE_BATCH_LIMIT } from "../src/history-file.js";
import { prepareHistoryPrune } from "../src/history-query.js";

const USAGE = "Usage: node scripts/prepare-portfolio-history.js combine DAT|EMA|CAWELON first.json [more.json ...]\n" +
  "       node scripts/prepare-portfolio-history.js prune history.json [filters]\n" +
  "Combine: 1-16 archives, each <= 1 MiB, total <= 4 MiB, at most 64 unique observations.\n" +
  "Prune filters: --account ADDRESS --chain ID --origin ORIGIN --min-block N --max-block N\n" +
  "               --token CONTRACT --token-state any|known|unknown|not-observed --order oldest|newest\n" +
  "Prune prepares the complement of an explicit nonempty proper subset; order alone is not a scope.\n" +
  "OUTPUT ONLY: writes a candidate history JSON to stdout. Never deletes, overwrites or imports any file or live history.\n" +
  "Review the candidate before importing. Keep the original files for recovery. Output includes public addresses and balances.\n" +
  "Exit 0: complete local candidate; 1: rejected arguments, input, conflict, capacity or scope. No partial stdout on failure.\n" +
  "No network or wallet access. Structural agreement is not authentication, current balance verification or a security audit.\n";
function fail(code = "HISTORY_PREPARATION_ARGUMENTS") { throw Error(code); }
function validPath(path) { return typeof path === "string" && path.length > 0 && !path.startsWith("-") && !path.includes("\0") && /\.json$/i.test(path); }
export function parseHistoryPreparationArgs(args) {
  if (!Array.isArray(args) || args.some(value => typeof value !== "string" || value.includes("\0"))) fail();
  if (args[0] === "combine") {
    const [, agent, ...paths] = args;
    if (!["DAT", "EMA", "CAWELON"].includes(agent) || paths.length < 1 || paths.length > 16 || !paths.every(validPath)) fail();
    return Object.freeze({ mode: "combine", agent, paths: Object.freeze(paths) });
  }
  if (args[0] === "prune") {
    const request = parsePortfolioHistoryArgs(["subset", ...args.slice(1)]);
    return Object.freeze({ mode: "prune", paths: Object.freeze([request.path]), query: request.query });
  }
  fail();
}
export async function prepareHistoryPaths(request) {
  const texts = []; let remaining = HISTORY_ARCHIVE_BATCH_LIMIT;
  for (const path of request.paths) {
    if (remaining < 1) fail("HISTORY_PREPARATION_TOTAL_SIZE");
    const bytes = await readBoundedLocalBytes(path, Math.min(HISTORY_ARCHIVE_FILE_LIMIT, remaining), {
      fail, sizeCode: "HISTORY_PREPARATION_SIZE", changedCode: "HISTORY_PREPARATION_CHANGED", limitCode: "HISTORY_PREPARATION_LIMIT",
    });
    remaining -= bytes.byteLength;
    texts.push(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  }
  if (request.mode === "combine") return prepareHistoryArchives(texts, request.agent).text;
  if (request.mode === "prune") {
    // Archive imports permit a single leading UTF-8 BOM. Other text is preserved for strict parsing.
    const text = texts[0].startsWith("\uFEFF") ? texts[0].slice(1) : texts[0];
    return prepareHistoryPrune(text, request.query).text;
  }
  fail();
}
export async function runHistoryPreparation(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parseHistoryPreparationArgs(args), text = await prepareHistoryPaths(request);
    stdout.write(text); return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(HISTORY_PREPARATION|PORTFOLIO_HISTORY|INVALID_HISTORY|INVALID_FILE|INVALID_AGENT|FILE_SIZE|AGENT_MISMATCH|OBSERVATION_CONFLICT|HISTORY_LIMIT)(_[A-Z]+)*$/.test(code) ? code : "HISTORY_PREPARATION_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runHistoryPreparation(process.argv.slice(2));
