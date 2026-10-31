import { captureDataRecord } from "./security-data.js";
import { createPortfolioHistory } from "./portfolio-history.js";
import { normalizeAddress } from "./wallet-session.js";

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
  const allowed = ["account", "chainId", "minimumBlock", "maximumBlock", "order", "tokenAddress", "tokenStatus"];
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
  return Object.freeze({ account, chainId, minimumBlock, maximumBlock, order, tokenAddress, tokenStatus });
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
