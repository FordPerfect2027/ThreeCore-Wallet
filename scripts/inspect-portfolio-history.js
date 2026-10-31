#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readBoundedLocalBytes } from "./read-bounded-local-file.js";
import { createPortfolioHistory, HISTORY_TEXT_LIMIT, HISTORY_LIMIT } from "../src/portfolio-history.js";
import { queryPortfolioHistory, exportFilteredHistory, validateHistoryQuery, portfolioHistoryCSV } from "../src/history-query.js";
import { encodePortfolioReport } from "../src/portfolio-report.js";
import { encodePortfolioComparisonReport } from "../src/portfolio-comparison.js";
import { describePortfolioHistory } from "../src/portfolio-history-summary.js";

const USAGE = "Usage: node scripts/inspect-portfolio-history.js query|subset|csv history.json [filters]\n" +
  "  Filters: --account ADDRESS --chain ID --origin ORIGIN --min-block DECIMAL --max-block DECIMAL\n" +
  "           --order oldest|newest --token CONTRACT --token-state any|known|unknown|not-observed\n" +
  "  subset requires at least one filter and exports whole matching observations, including other holdings.\n" +
  "  csv emits a scope row and all native/token balances of matched observations; decimal text has a leading apostrophe.\n" +
  "  Missing-code balances stay blank, not zero. CSV is not a restorable archive.\n" +
  "  record history.json --index INDEX\n" +
  "  compare history.json --before INDEX --after INDEX\n" +
  "  timeline history.json\n" +
  "Indices are zero-based positions in the original archive, as returned by query; not sorted row numbers.\n" +
  "Reads one local portfolio-history JSON up to 1 MiB. Output includes public addresses and balances.\n" +
  "No network, wallet connection, import or source writes. Output goes only to stdout.\n" +
  "Exit 0: requested local analysis/export completed; 1: invalid input, incompatible pair or empty subset.\n" +
  "Structure and arithmetic checks do not authenticate observations, establish current balances or prove transfers/profit.\n";
const filters = Object.freeze({ "--account": "account", "--chain": "chainId", "--origin": "siteOrigin", "--min-block": "minimumBlock", "--max-block": "maximumBlock", "--order": "order", "--token": "tokenAddress", "--token-state": "tokenStatus" });
function fail(code = "PORTFOLIO_HISTORY_CLI_ARGUMENTS") { throw Error(code); }
function index(value) { if (!/^(0|[1-9][0-9]?)$/.test(value) || Number(value) >= HISTORY_LIMIT) fail(); return Number(value); }
export function parsePortfolioHistoryArgs(args) {
  if (!Array.isArray(args) || args.length < 2 || args.length % 2 !== 0 || args.some(value => typeof value !== "string" || value.includes("\0"))) fail();
  const [mode, path] = args;
  if (!["query", "subset", "csv", "record", "compare", "timeline"].includes(mode) || !path || path.startsWith("-") || !/\.json$/i.test(path)) fail();
  const query = {}, positions = {}, seen = new Set();
  for (let i = 2; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1]; if (seen.has(key) || value === "") fail(); seen.add(key);
    if (["query", "subset", "csv"].includes(mode)) {
      if (!Object.hasOwn(filters, key)) fail();
      if (key === "--chain" && !/^[1-9][0-9]{0,15}$/.test(value)) fail();
      query[filters[key]] = key === "--chain" ? Number(value) : value;
    } else if (mode === "record" && key === "--index") positions.index = index(value);
    else if (mode === "compare" && ["--before", "--after"].includes(key)) positions[key.slice(2)] = index(value);
    else fail();
  }
  if ((mode === "subset" && !seen.size) || (mode === "record" && seen.size !== 1) || (mode === "compare" && seen.size !== 2)) fail();
  return Object.freeze({ mode, path, query: ["query", "subset", "csv"].includes(mode) ? validateHistoryQuery(query) : null, positions: Object.freeze(positions) });
}

export async function inspectPortfolioHistoryPath(request) {
  const bytes = await readBoundedLocalBytes(request.path, HISTORY_TEXT_LIMIT, {
    fail, sizeCode: "PORTFOLIO_HISTORY_SIZE", changedCode: "PORTFOLIO_HISTORY_CHANGED", limitCode: "PORTFOLIO_HISTORY_LIMIT",
  });
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (request.mode === "query") return JSON.stringify(queryPortfolioHistory(text, request.query), null, 2) + "\n";
  if (request.mode === "csv") return portfolioHistoryCSV(text, request.query).text;
  if (request.mode === "subset") {
    const result = exportFilteredHistory(text, request.query); if (!result.exportedCount) fail("PORTFOLIO_HISTORY_EMPTY_SELECTION"); return result.text;
  }
  if (request.mode === "timeline") return describePortfolioHistory(text) + "\n";
  const history = createPortfolioHistory(); history.importText(text); const state = history.state();
  if (request.mode === "record") {
    const snapshot = state.snapshots[request.positions.index]; if (!snapshot) fail("PORTFOLIO_HISTORY_SELECTION"); return encodePortfolioReport(snapshot);
  }
  if (request.mode !== "compare") fail();
  const { before, after } = request.positions; history.compare(before, after, state.revision);
  return encodePortfolioComparisonReport(state.snapshots[before], state.snapshots[after]);
}

export async function runPortfolioHistoryInspection(args, { stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (Array.isArray(args) && args.length === 1 && args[0] === "--help") { stdout.write(USAGE); return 0; }
    const request = parsePortfolioHistoryArgs(args), text = await inspectPortfolioHistoryPath(request);
    stdout.write(text); return 0;
  } catch (error) {
    const code = error?.code ?? error?.message;
    const safe = typeof code === "string" && /^(PORTFOLIO_HISTORY|INVALID_HISTORY|INVALID_PORTFOLIO|IDENTITY_MISMATCH|REVERSED_BLOCKS|BLOCK_CONFLICT|OBSERVATION_CONFLICT|INVALID_SELECTION|STALE_HISTORY|HISTORY|COMPARISON_REPORT)(_[A-Z]+)*$/.test(code) ? code : "PORTFOLIO_HISTORY_CLI_FAILED";
    stderr.write(safe + "\n" + USAGE); return 1;
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = await runPortfolioHistoryInspection(process.argv.slice(2));
