import { captureWorkspaceDraft, workspaceHistory, freezeWorkspace, workspaceFail } from "./workspace-format.js";
import { normalizeAddress } from "./wallet-session.js";
import { describeWorkspaceChanges } from "./workspace-review.js";

/** Exact display only. Does not infer decimals, prices, value or profit. */
export function formatWorkspaceUnits(raw, decimals = 18) {
  if (typeof raw !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(raw) || BigInt(raw) >= (1n << 256n)) {
    workspaceFail("WORKSPACE_AMOUNT");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) workspaceFail("WORKSPACE_DECIMALS");
  if (!decimals) return raw;
  const digits = raw.padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fractional = digits.slice(-decimals).replace(/0+$/, "");
  return fractional ? whole + "." + fractional : whole;
}

function accountStatus(text) {
  if (!text.trim()) return { account: null, status: "missing" };
  try {
    const account = normalizeAddress(text.trim());
    if (/^0x0{40}$/.test(account)) throw Error("Zero address");
    return { account, status: "configured" };
  } catch { return { account: null, status: "invalid" }; }
}

function tokenStatus(text) {
  const lines = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const seen = new Set();
  let invalid = 0;
  let duplicate = 0;
  for (const value of lines) {
    try {
      const address = normalizeAddress(value);
      if (/^0x0{40}$/.test(address)) throw Error("Zero address");
      if (seen.has(address)) duplicate++;
      seen.add(address);
    } catch { invalid++; }
  }
  return { count: lines.length, distinct: seen.size, invalid, duplicate, overLimit: lines.length > 32 };
}

function observationGroups(history, configuredAccount, configuredChain) {
  const state = history.state();
  return history.groups().map(group => {
    const rows = group.indices.map(index => state.snapshots[index]);
    const latest = rows.at(-1);
    const previous = rows.length > 1 ? rows.at(-2) : null;
    const known = latest.holdings.filter(token => token.hasCode);
    return {
      account: group.account,
      chainId: group.chainId,
      siteOrigin: group.siteOrigin,
      count: rows.length,
      earliestBlock: group.earliestBlockNumber,
      latestBlock: latest.blockNumber,
      latestBlockHash: latest.blockHash,
      matchesConfiguration: group.account === configuredAccount && group.chainId === configuredChain,
      nativeBalanceBaseUnits: latest.nativeBalanceBaseUnits,
      nativeBalanceETH: formatWorkspaceUnits(latest.nativeBalanceBaseUnits),
      previousBlock: previous?.blockNumber ?? null,
      nativeChangeBaseUnits: previous
        ? (BigInt(latest.nativeBalanceBaseUnits) - BigInt(previous.nativeBalanceBaseUnits)).toString() : null,
      knownTokens: known.length,
      unknownTokens: latest.holdings.length - known.length,
      holdings: latest.holdings.map(token => ({
        address: token.address,
        balanceBaseUnits: token.balanceBaseUnits,
        known: token.hasCode,
      })),
      historicalObservation: true,
    };
  });
}

/** Every balance stays bound to account, network, origin and block. */
export function summarizeWorkspace(draft) {
  const entries = captureWorkspaceDraft(draft);
  const identities = entries.map(row => accountStatus(row.account));
  const cards = entries.map((row, index) => {
    const identity = identities[index];
    const duplicated = identity.account && identities.filter(item => item.account === identity.account).length > 1;
    const history = workspaceHistory(row.agent, row.history);
    const groups = observationGroups(history, identity.account, row.chainId);
    return {
      agent: row.agent,
      account: identity.account,
      accountStatus: duplicated ? "duplicate" : identity.status,
      chainId: row.chainId,
      tokens: tokenStatus(row.tokens),
      singleToken: accountStatus(row.tokenAddress),
      historyCount: history.state().size,
      remainingCapacity: history.state().capacity - history.state().size,
      groups,
      unrelatedObservations: groups.filter(group => !group.matchesConfiguration).reduce((sum, group) => sum + group.count, 0),
      emptyHistory: history.state().size === 0,
    };
  });
  return freezeWorkspace({
    schema: "threecore-workspace-overview-v1",
    cards,
    configured: cards.filter(card => card.accountStatus === "configured").length,
    totalObservations: cards.reduce((sum, card) => sum + card.historyCount, 0),
    unknownBalances: cards.reduce((sum, card) => sum + card.groups.reduce((subtotal, group) => subtotal + group.unknownTokens, 0), 0),
    historicalObservation: true,
    connectionVerified: false,
    securityAudit: false,
    monetaryValuation: false,
  });
}

export function describeWorkspaceOverview(draft) {
  const summary = summarizeWorkspace(draft);
  const labels = { configured: "設定済み・接続未確認", missing: "未設定", invalid: "形式を確認してください", duplicate: "他のカードと重複" };
  const lines = ["3ウォレットの保存状況", "別アドレスの設定: " + summary.configured + " / 3",
    "保存履歴: 合計 " + summary.totalObservations + "件", ""];
  for (const card of summary.cards) {
    lines.push(card.agent + " — " + labels[card.accountStatus],
      "公開アドレス: " + (card.account ?? "未設定または入力不正"),
      "設定ネットワーク: " + card.chainId,
      "トークン一覧: " + card.tokens.count + "件（重複 " + card.tokens.duplicate + " / 不正 " + card.tokens.invalid + "）",
      "保存履歴: " + card.historyCount + "件 / 残り " + card.remainingCapacity + "件");
    if (card.tokens.overLimit) lines.push("トークン一覧は32件以内にしてください。");
    if (card.unrelatedObservations) lines.push("現在の設定と異なるアドレス・ネットワークの過去記録: " + card.unrelatedObservations + "件");
    for (const group of card.groups) {
      lines.push("  過去の記録: " + group.account + " / chain " + group.chainId,
        "  参照元: " + group.siteOrigin,
        "  ブロック: " + group.earliestBlock + " → " + group.latestBlock,
        "  ETH: " + group.nativeBalanceETH + "（" + group.nativeBalanceBaseUnits + " wei）",
        "  トークン残高が確認できない項目: " + group.unknownTokens + "件");
      for (const holding of group.holdings) {
        lines.push("  " + holding.address + ": " + (holding.known ? holding.balanceBaseUnits + "（最小単位）" : "不明"));
      }
    }
    lines.push("");
  }
  lines.push("これは保存した過去の観測値です。現在の残高・接続・所有・安全性を証明しません。",
    "異なるトークンやネットワークの金額は合算しません。残高差は利益や送金履歴ではありません。",
    "公開アドレスと残高を含みます。共有先はご自身で確認してください。");
  return lines.join("\n");
}

export function describeWorkspacePreview(preview) {
  const lines = ["一括復元の変更内容", "設定・トークン一覧: " + (preview.options.settings ? "復元する" : "現在の入力を保持"),
    "履歴: " + (!preview.options.histories ? "現在の履歴を保持" : preview.options.mode === "merge" ? "既存履歴へ追加" : "ファイルの履歴に置き換え"), ""];
  for (const change of preview.changes) {
    lines.push(change.agent,
      "  アドレス: " + (change.beforeAccount || "未設定") + " → " + (change.afterAccount || "未設定"),
      "  ネットワーク: " + change.beforeChain + " → " + change.afterChain,
      "  入力するトークン: " + change.tokenCount + "件",
      "  保存履歴: " + change.beforeCount + " → " + change.afterCount + "件",
      "  ファイル内: " + change.incomingCount + "件 / 重複: " + change.duplicates + "件 / 取り除く既存記録: " + change.removed + "件",
      "  接続: " + (change.configurationChanged ? "このカードを切断します" : "設定に変更なし"));
  }
  lines.push("", "復元後の履歴も過去の観測値です。ウォレットは自動接続しません。",
    "直前の復元は、ほかの編集をする前ならこのページ内で戻せます。ページを閉じる前にファイル保存してください。");
  lines.push("", describeWorkspaceChanges(preview.before, preview.after));
  return lines.join("\n");
}

export function describeWorkspaceUndo(review) {
  const lines = ["直前の一括復元を戻す内容", ""];
  review.before.forEach((row, index) => {
    const after = review.after[index];
    lines.push(row.agent,
      "  アドレス: " + (row.account || "未設定") + " → " + (after.account || "未設定"),
      "  ネットワーク: " + row.chainId + " → " + after.chainId,
      "  履歴: " + workspaceHistory(row.agent, row.history).state().size + " → " + workspaceHistory(after.agent, after.history).state().size + "件");
  });
  lines.push("", "設定が変わるカードは切断します。接続許可や残高照会は復元しません。");
  lines.push("", describeWorkspaceChanges(review.before, review.after));
  return lines.join("\n");
}
