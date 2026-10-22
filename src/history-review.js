import { createPortfolioHistory } from "./portfolio-history.js";

export const HISTORY_REVIEW_SCHEMA = "threecore-history-review-v1";
function load(text) {
  const history = createPortfolioHistory();
  history.importText(text);
  return history;
}
function identity(row) {
  return JSON.stringify([row.agent, row.account, row.chainId, row.siteOrigin]);
}
function key(row) {
  return JSON.stringify([identity(row), row.blockNumber]);
}
function reference(row) {
  return Object.freeze({
    agent: row.agent,
    account: row.account,
    chainId: row.chainId,
    siteOrigin: row.siteOrigin,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
  });
}
function sortedHoldings(row) {
  return [...row.holdings].sort((a, b) => a.address.localeCompare(b.address));
}
function changedFields(before, after) {
  const names = [];
  for (const name of ["blockHash", "nativeBalanceBaseUnits", "connectionEpoch"]) {
    if (before[name] !== after[name]) names.push(name);
  }
  if (JSON.stringify(sortedHoldings(before)) !== JSON.stringify(sortedHoldings(after))) names.push("holdings");
  return Object.freeze(names);
}
function tokenChanges(before, after) {
  const first = new Map(before.holdings.map(row => [row.address, row]));
  const last = new Map(after.holdings.map(row => [row.address, row]));
  const rows = [];
  for (const address of [...new Set([...first.keys(), ...last.keys()])]) {
    const previous = first.get(address), next = last.get(address);
    if (previous && next && previous.hasCode === next.hasCode && previous.balanceBaseUnits === next.balanceBaseUnits) continue;
    rows.push(Object.freeze({
      address,
      previouslyObserved: Boolean(previous),
      subsequentlyObserved: Boolean(next),
      previousHasCode: previous?.hasCode ?? null,
      subsequentHasCode: next?.hasCode ?? null,
      previousBalanceBaseUnits: previous?.balanceBaseUnits ?? null,
      subsequentBalanceBaseUnits: next?.balanceBaseUnits ?? null,
    }));
  }
  return Object.freeze(rows);
}
function flags() {
  return {
    historicalObservation: true,
    provesCurrentBalance: false,
    provesOwnership: false,
    provesTransfers: false,
    provesProfit: false,
    securityAudit: false,
    canAuthorizeConnection: false,
    canAuthorizeTransaction: false,
  };
}

/**
 * Describe the coverage of saved observations, never asset values or safety.
 * Block gaps describe sampled observations, not missing blockchain data.
 * No numbers from different contracts are aggregated as financial balances.
 */
export function reviewPortfolioHistory(text) {
  const history = load(text);
  const state = history.state();
  let known = 0, unknown = 0;
  const addresses = new Set();
  const groups = history.groups().map(group => {
    const observations = group.indices.map(index => state.snapshots[index]);
    const contracts = new Set();
    let missingCodeObservations = 0;
    const coverageChanges = [];
    const gaps = [];
    observations.forEach((row, index) => {
      const previous = observations[index - 1];
      for (const holding of row.holdings) {
        // Distinct token identity includes the chain, never only the address.
        addresses.add(JSON.stringify([row.chainId, holding.address]));
        contracts.add(holding.address);
        if (holding.hasCode) known++;
        else { unknown++; missingCodeObservations++; }
      }
      if (!previous) return;
      const distance = BigInt(row.blockNumber) - BigInt(previous.blockNumber);
      if (distance > 1n) gaps.push(Object.freeze({
        earlierBlockNumber: previous.blockNumber,
        laterBlockNumber: row.blockNumber,
        unobservedHeightsBetween: (distance - 1n).toString(),
      }));
      const first = new Set(previous.holdings.map(holding => holding.address));
      const last = new Set(row.holdings.map(holding => holding.address));
      const added = [...last].filter(address => !first.has(address));
      const removed = [...first].filter(address => !last.has(address));
      if (added.length || removed.length) coverageChanges.push(Object.freeze({
        earlierBlockNumber: previous.blockNumber,
        laterBlockNumber: row.blockNumber,
        newlyObservedContracts: Object.freeze(added),
        noLongerObservedContracts: Object.freeze(removed),
      }));
    });
    return Object.freeze({
      agent: group.agent,
      account: group.account,
      chainId: group.chainId,
      siteOrigin: group.siteOrigin,
      observationCount: observations.length,
      earliestBlockNumber: group.earliestBlockNumber,
      latestBlockNumber: group.latestBlockNumber,
      contractCount: contracts.size,
      missingCodeObservations,
      observationGaps: Object.freeze(gaps),
      coverageChanges: Object.freeze(coverageChanges),
    });
  });
  const warnings = [];
  if (!state.size) warnings.push("EMPTY_HISTORY");
  if (unknown) warnings.push("UNKNOWN_TOKEN_BALANCES");
  if (groups.length > 1) warnings.push("SEPARATE_IDENTITIES");
  if (groups.some(group => group.observationGaps.length)) warnings.push("SAMPLED_BLOCKS");
  if (groups.some(group => group.coverageChanges.length)) warnings.push("TOKEN_COVERAGE_CHANGED");
  return Object.freeze({
    schema: HISTORY_REVIEW_SCHEMA,
    observationCount: state.size,
    identityCount: groups.length,
    distinctChainContracts: addresses.size,
    knownTokenObservations: known,
    unknownTokenObservations: unknown,
    warnings: Object.freeze(warnings),
    groups: Object.freeze(groups),
    ...flags(),
  });
}

/**
 * Simulate an import against a copied destination and expose its exact impact.
 * This does not grant permission to apply. Existing import preview/revision
 * checks remain the only path for a caller to alter its in-memory collection.
 */
export function reviewHistoryImport(currentText, incomingText, { replace = false } = {}) {
  if (typeof replace !== "boolean") throw new TypeError("Replace must be a boolean");
  const current = load(currentText);
  const incoming = load(incomingText);
  const before = current.state().snapshots;
  const offered = incoming.state().snapshots;
  const outcome = current.merge(offered, replace);
  const after = current.state().snapshots;
  const first = new Map(before.map(row => [key(row), row]));
  const last = new Map(after.map(row => [key(row), row]));
  const added = after.filter(row => !first.has(key(row))).map(reference);
  const removed = before.filter(row => !last.has(key(row))).map(reference);
  // Replacement may intentionally change an existing same-height observation.
  // Surface that separately from additions, rather than hiding the overwrite.
  const changed = after.filter(row => {
    const previous = first.get(key(row));
    if (!previous) return false;
    return changedFields(previous, row).length > 0;
  }).map(row => {
    const previous = first.get(key(row));
    return Object.freeze({
      before: reference(previous), after: reference(row),
      changedFields: changedFields(previous, row),
      previousNativeBalanceBaseUnits: previous.nativeBalanceBaseUnits,
      subsequentNativeBalanceBaseUnits: row.nativeBalanceBaseUnits,
      tokenChanges: tokenChanges(previous, row),
    });
  });
  return Object.freeze({
    schema: "threecore-history-import-impact-v1",
    mode: replace ? "replace" : "merge",
    previousCount: before.length,
    incomingCount: offered.length,
    resultingCount: after.length,
    duplicateCount: outcome.duplicates,
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    changed: Object.freeze(changed),
    destinationChanged: outcome.changed,
    review: reviewPortfolioHistory(current.exportText()),
    ...flags(),
  });
}

const WARNINGS = Object.freeze({
  EMPTY_HISTORY: "履歴は空です。",
  UNKNOWN_TOKEN_BALANCES: "契約コードがなく、残高が未確認の記録があります。ゼロ残高とは異なります。",
  SEPARATE_IDENTITIES: "異なるアカウント・チェーン・サイトの記録は分けて扱います。",
  SAMPLED_BLOCKS: "参照ブロックの間隔があります。連続した送金履歴ではありません。",
  TOKEN_COVERAGE_CHANGED: "確認対象のトークン契約が途中で変わっています。未確認はゼロではありません。",
});
export function describeHistoryReview(text) {
  const report = reviewPortfolioHistory(text);
  const lines = [
    "保存履歴の内容確認（監査・安全性の判定ではありません）",
    "記録: " + report.observationCount + "件 / 組み合わせ: " + report.identityCount,
    "チェーン別の契約数: " + report.distinctChainContracts,
    "残高確認済みのトークン記録: " + report.knownTokenObservations,
    "残高未確認のトークン記録: " + report.unknownTokenObservations,
    ...report.warnings.map(code => WARNINGS[code]),
  ];
  for (const group of report.groups) {
    lines.push("");
    lines.push(group.agent + " / " + group.account);
    lines.push("チェーン: " + group.chainId + " / サイト: " + group.siteOrigin);
    lines.push("参照範囲: " + group.earliestBlockNumber + " → " + group.latestBlockNumber);
    lines.push("記録: " + group.observationCount + "件 / 未確認: " + group.missingCodeObservations);
    for (const gap of group.observationGaps) {
      lines.push("参照間隔: " + gap.earlierBlockNumber + " → " + gap.laterBlockNumber +
        "（間の未観測ブロック数 " + gap.unobservedHeightsBetween + "）");
    }
    for (const change of group.coverageChanges) {
      lines.push("対象契約変更: " + change.earlierBlockNumber + " → " + change.laterBlockNumber);
      for (const address of change.newlyObservedContracts) lines.push("確認対象に追加: " + address);
      for (const address of change.noLongerObservedContracts) lines.push("後の記録では対象外: " + address);
    }
  }
  lines.push("現在の残高・所有権・送金・利益を証明しません。接続・署名・送金は行っていません。");
  return lines.join("\n");
}
export function describeHistoryImport(currentText, incomingText, options) {
  const report = reviewHistoryImport(currentText, incomingText, options);
  const lines = [
    "履歴読み込みの変更予定（まだ適用していません）",
    report.mode === "replace" ? "方式: 既存履歴を置き換え" : "方式: 既存履歴へ追加",
    "現在 " + report.previousCount + "件 → 適用後 " + report.resultingCount + "件",
    "新規 " + report.added.length + "件 / 除外 " + report.removed.length +
      "件 / 同じ位置の変更 " + report.changed.length + "件",
  ];
  for (const [label, rows] of [["追加予定", report.added], ["除外予定", report.removed]]) {
    for (const row of rows) lines.push(label + ": " + row.agent + " / " + row.account +
      " / chain " + row.chainId + " / block " + row.blockNumber);
  }
  for (const row of report.changed) {
    lines.push("変更予定: " + row.after.agent + " / " + row.after.account + " / block " + row.after.blockNumber);
    lines.push("変更項目: " + row.changedFields.join(", "));
    if (row.changedFields.includes("blockHash")) lines.push("参照ハッシュ: " + row.before.blockHash + " → " + row.after.blockHash);
    if (row.changedFields.includes("nativeBalanceBaseUnits")) lines.push("ネイティブ残高（最小単位）: " + row.previousNativeBalanceBaseUnits + " → " + row.subsequentNativeBalanceBaseUnits);
    for (const token of row.tokenChanges) {
      lines.push("契約 " + token.address + ": " + (token.previousBalanceBaseUnits ?? "未確認") + " → " + (token.subsequentBalanceBaseUnits ?? "未確認"));
    }
  }
  lines.push("適用する場合は、別のプレビューと適用ボタンで内容を確認してください。");
  return lines.join("\n");
}

