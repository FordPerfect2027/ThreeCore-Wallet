import { createPortfolioHistory } from "./portfolio-history.js";

/**
 * Build an immutable historical timeline from a bounded exported archive.
 * Each identity receives its own timeline. Balances are never summed across
 * contracts, accounts, chains or agents, and no timestamps imply freshness.
 */
export function summarizePortfolioHistory(text) {
  const history = createPortfolioHistory();
  history.importText(text);
  const state = history.state();
  const groups = history.groups().map(group => {
    const entries = group.indices.map(index => {
      const snapshot = state.snapshots[index];
      return Object.freeze({
        blockNumber: snapshot.blockNumber,
        blockHash: snapshot.blockHash,
        nativeBalanceBaseUnits: snapshot.nativeBalanceBaseUnits,
        tokenCount: snapshot.holdings.length,
        knownTokenCount: snapshot.holdings.filter(row => row.hasCode).length,
        unknownTokenCount: snapshot.holdings.filter(row => !row.hasCode).length,
      });
    });
    const transitions = [];
    for (let index = 1; index < group.indices.length; index++) {
      transitions.push(history.compare(group.indices[index - 1], group.indices[index], state.revision));
    }
    return Object.freeze({
      agent: group.agent,
      account: group.account,
      chainId: group.chainId,
      siteOrigin: group.siteOrigin,
      observations: Object.freeze(entries),
      transitions: Object.freeze(transitions),
    });
  });
  return Object.freeze({
    observationCount: state.size,
    identityCount: groups.length,
    groups: Object.freeze(groups),
    historicalObservation: true,
    provesTransfers: false,
    provesProfit: false,
    canAuthorizeConnection: false,
    canAuthorizeTransaction: false,
    securityAudit: false,
  });
}

/**
 * Render plain text from validated JSON, rather than arbitrary summary objects.
 * Callers must use textContent when putting this output into a browser.
 * Explicit base units avoid inventing decimals or market prices.
 */
export function describePortfolioHistory(text) {
  const summary = summarizePortfolioHistory(text);
  const lines = [
    "保存記録の時系列一覧",
    "現在の残高・所有権・送金履歴・利益を証明するものではありません。",
    "記録数: " + summary.observationCount,
    "アカウント・チェーン等の組み合わせ: " + summary.identityCount,
  ];
  for (const group of summary.groups) {
    lines.push("");
    lines.push(group.agent + " / " + group.account);
    lines.push("チェーン: " + group.chainId);
    lines.push("サイト: " + group.siteOrigin);
    for (const observation of group.observations) {
      lines.push("ブロック: " + observation.blockNumber);
      lines.push("ハッシュ: " + observation.blockHash);
      lines.push("ネイティブ残高（最小単位）: " + observation.nativeBalanceBaseUnits);
      lines.push("トークン契約数: " + observation.tokenCount);
      lines.push("残高未確認の契約数: " + observation.unknownTokenCount);
    }
    for (const transition of group.transitions) {
      lines.push("比較: " + transition.earlierBlockNumber + " → " + transition.laterBlockNumber);
      lines.push("ネイティブ差分（最小単位）: " + transition.native.deltaBaseUnits);
      for (const holding of transition.holdings) {
        lines.push(holding.address + ": " +
          (holding.deltaBaseUnits === null ? "比較不可" : holding.deltaBaseUnits) +
          " / " + holding.availability);
      }
    }
  }
  return lines.join("\n");
}
