import { captureDataRecord } from "./security-data.js";
import { createPortfolioHistory } from "./portfolio-history.js";
import { normalizeAddress, validateSiteOrigin } from "./wallet-session.js";
import { exportTextBytes } from "./export-payload.js";
import { parseSecurityJson } from "./security-json.js";
import { validatePortfolioSnapshot } from "./portfolio-report.js";

export const HISTORY_QUERY_FILE_LIMIT = 65536;
export function encodeHistoryQueryFile(input) {
  const query = validateHistoryQuery(input), text = JSON.stringify({ schema: "threecore-history-query-v1", query,
    configurationOnly: true, canAuthorizeConnection: false, canAuthorizeTransaction: false }, null, 2) + "\n";
  exportTextBytes(text, HISTORY_QUERY_FILE_LIMIT); return text;
}
export function decodeHistoryQueryFile(text) {
  try {
    const value = captureDataRecord(parseSecurityJson(text, { bytes: HISTORY_QUERY_FILE_LIMIT, depth: 4, nodes: 40 }),
      ["schema", "query", "configurationOnly", "canAuthorizeConnection", "canAuthorizeTransaction"]);
    if (value.schema !== "threecore-history-query-v1" || value.configurationOnly !== true || value.canAuthorizeConnection !== false || value.canAuthorizeTransaction !== false) fail();
    return validateHistoryQuery(value.query);
  } catch { fail(); }
}

export class HistoryQueryError extends Error {
  constructor(message) {
    super(message);
    this.name = "HistoryQueryError";
    this.code = "INVALID_HISTORY_QUERY";
  }
}
const MAX = (1n << 256n) - 1n;
function fail() { throw new HistoryQueryError("Invalid history filter"); }
function height(value) {
  if (value === "") return null;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > MAX) fail();
  return value;
}
/** Strict, primitive-only filters. No regex, arbitrary search expressions or code. */
export function validateHistoryQuery(query = {}) {
  const allowed = ["account", "chainId", "minimumBlock", "maximumBlock", "order", "tokenAddress", "tokenStatus", "siteOrigin"];
  try {
    const keys=Reflect.ownKeys(query);if(keys.some(key=>!allowed.includes(key)))fail();
    query=captureDataRecord(query,keys);
  } catch { fail(); }
  let account = query.account ?? "";
  if (account !== "") {
    try { account = normalizeAddress(account); } catch { fail(); }
  }
  const chainId = query.chainId ?? "";
  if (chainId !== "" && (!Number.isSafeInteger(chainId) || chainId < 1)) fail();
  const minimumBlock = height(query.minimumBlock ?? "");
  const maximumBlock = height(query.maximumBlock ?? "");
  if (minimumBlock !== null && maximumBlock !== null && BigInt(minimumBlock) > BigInt(maximumBlock)) fail();
  const order = query.order ?? "oldest";
  if (order !== "oldest" && order !== "newest") fail();
  let tokenAddress = query.tokenAddress ?? "";
  if (tokenAddress !== "") { try { tokenAddress = normalizeAddress(tokenAddress); } catch { fail(); } }
  const tokenStatus = query.tokenStatus ?? "any";
  if (!["any", "known", "unknown", "not-observed"].includes(tokenStatus) || (!tokenAddress && tokenStatus !== "any")) fail();
  let siteOrigin = query.siteOrigin ?? "";
  if (siteOrigin !== "") { try { siteOrigin = validateSiteOrigin(siteOrigin); } catch { fail(); } }
  return Object.freeze({ account, chainId, minimumBlock, maximumBlock, order, tokenAddress, tokenStatus, siteOrigin });
}

/** Query a copied archive; retained source indices are local to this archive. */
export function queryPortfolioHistory(text, input = {}) {
  const query = validateHistoryQuery(input);
  const history = createPortfolioHistory();
  history.importText(text);
  const state = history.state();
  const rows = state.snapshots.map((snapshot, index) => ({ snapshot, index })).filter(({ snapshot }) => {
    if (query.account && snapshot.account !== query.account) return false;
    if (query.chainId !== "" && snapshot.chainId !== query.chainId) return false;
    if (query.siteOrigin && snapshot.siteOrigin !== query.siteOrigin) return false;
    const block = BigInt(snapshot.blockNumber);
    if (query.minimumBlock !== null && block < BigInt(query.minimumBlock)) return false;
    if (query.maximumBlock !== null && block > BigInt(query.maximumBlock)) return false;
    if (query.tokenAddress) {
      const holding = snapshot.holdings.find(row => row.address === query.tokenAddress);
      if (query.tokenStatus === "not-observed") return !holding;
      if (!holding || (query.tokenStatus === "known" && !holding.hasCode) || (query.tokenStatus === "unknown" && holding.hasCode)) return false;
    }
    return true;
  });
  rows.sort((a, b) => {
    const first = BigInt(a.snapshot.blockNumber), last = BigInt(b.snapshot.blockNumber);
    const value = first < last ? -1 : first > last ? 1 : a.index - b.index;
    return query.order === "newest" ? -value : value;
  });
  return Object.freeze({
    totalCount: state.size,
    matchCount: rows.length,
    query,
    rows: Object.freeze(rows.map(row => Object.freeze(row))),
    historicalObservation: true,
    canAuthorizeConnection: false,
    canAuthorizeTransaction: false,
  });
}

/** Export matching observations only, preserving the original strict schema. */
export function exportFilteredHistory(text, query) {
  const result = queryPortfolioHistory(text, query);
  const subset = createPortfolioHistory();
  subset.merge(result.rows.map(row => row.snapshot));
  return Object.freeze({
    text: subset.exportText(),
    totalCount: result.totalCount,
    exportedCount: result.matchCount,
    excludesOtherRecords: result.matchCount !== result.totalCount,
  });
}

/** Prepare a bounded complement. No mutation; never treat display order as a removal scope. */
export function prepareHistoryPrune(text, input) {
  const result = queryPortfolioHistory(text, input), q = result.query;
  if (!(q.account || q.chainId !== "" || q.siteOrigin || q.minimumBlock !== null || q.maximumBlock !== null || q.tokenAddress)) fail();
  if (result.matchCount === 0 || result.matchCount === result.totalCount) fail();
  const source = createPortfolioHistory(); source.importText(text);
  const selected = new Set(result.rows.map(row => row.index)), remaining = createPortfolioHistory();
  remaining.merge(source.state().snapshots.filter((_, index) => !selected.has(index)));
  return Object.freeze({ query: q, previousCount: result.totalCount, removedCount: result.matchCount,
    remainingCount: result.totalCount - result.matchCount, removedIndices: Object.freeze([...selected]),
    text: remaining.exportText(), historicalObservation: true, canAuthorizeConnection: false, canAuthorizeTransaction: false });
}

/** Find the newest strictly earlier saved point in the exact target identity. */
export function findPreviousPortfolioObservation(text, input) {
  const target = validatePortfolioSnapshot(input), result = queryPortfolioHistory(text, { account: target.account, chainId: target.chainId, siteOrigin: target.siteOrigin, order: "newest" });
  return result.rows.find(({ snapshot }) => snapshot.agent === target.agent && BigInt(snapshot.blockNumber) < BigInt(target.blockNumber)) ?? null;
}

/** Retain the newest N matched saved points per complete identity, preserving all unmatched rows. */
export function prepareHistoryRetention(text, input, keepCount) {
  if (!Number.isSafeInteger(keepCount) || keepCount < 1 || keepCount > 64) fail();
  const result = queryPortfolioHistory(text, input), groups = new Map(), removed = new Set();
  for (const row of result.rows) { const s = row.snapshot, key = JSON.stringify([s.agent, s.account, s.chainId, s.siteOrigin]); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  for (const rows of groups.values()) {
    rows.sort((a, b) => BigInt(a.snapshot.blockNumber) > BigInt(b.snapshot.blockNumber) ? -1 : BigInt(a.snapshot.blockNumber) < BigInt(b.snapshot.blockNumber) ? 1 : a.index - b.index);
    for (const row of rows.slice(keepCount)) removed.add(row.index);
  }
  if (!removed.size) fail();
  const source = createPortfolioHistory(); source.importText(text); const retained = createPortfolioHistory();
  retained.merge(source.state().snapshots.filter((_, index) => !removed.has(index)));
  return Object.freeze({ query: result.query, keepCount, previousCount: result.totalCount, removedCount: removed.size, remainingCount: result.totalCount - removed.size,
    removedIndices: Object.freeze([...removed]), text: retained.exportText(), historicalObservation: true, canAuthorizeConnection: false, canAuthorizeTransaction: false });
}

/** Complete balance rows for matched observations; no valuation, rounding or inferred zeroes. */
export function portfolioHistoryCSV(text, input = {}) {
  const result = queryPortfolioHistory(text, input), queryText = JSON.stringify(result.query), limit = 16 * 1024 * 1024;
  const cell = value => {
    let text = value === null || value === undefined ? "" : String(value);
    // Preserve long decimal values when opened in spreadsheets, without executable formulas.
    if (/^\d+$/.test(text) || /^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const columns = ["row_kind", "query_json", "total_observations", "matched_observations", "original_index", "agent", "account", "chain_id_text", "site_origin", "block_number_text", "block_hash", "asset_kind", "token_address", "balance_status", "balance_base_units_text", "historical_only", "proves_current_balance", "restorable"];
  const lines = []; let size = 3, balanceRows = 0;
  function add(values) { const line = values.map(cell).join(",") + "\r\n"; size += exportTextBytes(line, limit); if (size > limit) throw new HistoryQueryError("CSV exceeds 16 MiB; narrow the history scope"); lines.push(line); }
  add(columns);
  add(["scope", queryText, result.totalCount, result.matchCount, "", "", "", "", "", "", "", "", "", "", "", true, false, false]);
  for (const { snapshot, index } of result.rows) {
    const prefix = ["balance", queryText, result.totalCount, result.matchCount, index, snapshot.agent, snapshot.account, snapshot.chainId, snapshot.siteOrigin, snapshot.blockNumber, snapshot.blockHash];
    add([...prefix, "native", "", "known", snapshot.nativeBalanceBaseUnits, true, false, false]); balanceRows++;
    for (const holding of snapshot.holdings) { add([...prefix, "token", holding.address, holding.hasCode ? "known" : "code-missing", holding.balanceBaseUnits, true, false, false]); balanceRows++; }
  }
  return Object.freeze({ text: "\ufeff" + lines.join(""), filename: "ThreeCore-portfolio-history-balances.csv", mimeType: "text/csv;charset=utf-8", byteLength: size,
    query: result.query, observationCount: result.matchCount, balanceRows, scope: "all-holdings-in-matching-observations", restorable: false, provesCurrentBalance: false });
}
