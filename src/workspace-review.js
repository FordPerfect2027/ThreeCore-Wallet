import { captureWorkspaceDraft, workspaceHistory, freezeWorkspace } from "./workspace-format.js";

function tokenLines(value) {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function changes(before, after) {
  const oldKeys = new Set(before.map(value => value.toLowerCase()));
  const newKeys = new Set(after.map(value => value.toLowerCase()));
  return {
    added: after.filter(value => !oldKeys.has(value.toLowerCase())),
    removed: before.filter(value => !newKeys.has(value.toLowerCase())),
  };
}

function recordSummary(row) {
  return {
    account: row.account,
    chainId: row.chainId,
    siteOrigin: row.siteOrigin,
    blockNumber: row.blockNumber,
    blockHash: row.blockHash,
    tokenCount: row.holdings.length,
  };
}

/** Compare exact records: even a same-block correction is a removal plus addition. */
function historyChanges(agent, oldText, newText) {
  const oldRows = workspaceHistory(agent, oldText).state().snapshots;
  const newRows = workspaceHistory(agent, newText).state().snapshots;
  const oldKeys = new Set(oldRows.map(row => JSON.stringify(row)));
  const newKeys = new Set(newRows.map(row => JSON.stringify(row)));
  return {
    added: newRows.filter(row => !oldKeys.has(JSON.stringify(row))).map(recordSummary),
    removed: oldRows.filter(row => !newKeys.has(JSON.stringify(row))).map(recordSummary),
    unchanged: oldRows.filter(row => newKeys.has(JSON.stringify(row))).length,
  };
}

/** A review describes local data movement, never a token transfer or allowance. */
export function reviewWorkspaceChanges(beforeInput, afterInput) {
  const before = captureWorkspaceDraft(beforeInput);
  const after = captureWorkspaceDraft(afterInput);
  const cards = before.map((old, index) => {
    const next = after[index];
    const beforeTokens = tokenLines(old.tokens);
    const afterTokens = tokenLines(next.tokens);
    const delta = changes(beforeTokens, afterTokens);
    const history = historyChanges(old.agent, old.history, next.history);
    const relevant = row => row.account === next.account.trim().toLowerCase() && row.chainId === next.chainId;
    return {
      agent: old.agent,
      singleTokenBefore: old.tokenAddress.trim(),
      singleTokenAfter: next.tokenAddress.trim(),
      tokensBefore: beforeTokens,
      tokensAfter: afterTokens,
      tokensAdded: delta.added,
      tokensRemoved: delta.removed,
      listOrderChanged: beforeTokens.length === afterTokens.length && !delta.added.length && !delta.removed.length &&
        beforeTokens.some((value, position) => value.toLowerCase() !== afterTokens[position]?.toLowerCase()),
      history,
      addedOutsideCurrentConfiguration: history.added.filter(row => !relevant(row)).length,
    };
  });
  return freezeWorkspace({ cards, localDataOnly: true, authorizesConnection: false, authorizesTransaction: false });
}

// Escape control characters so an unfinished form cannot impersonate review labels.
function display(value) {
  return value ? value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0")) : "未設定";
}

function describeRecords(lines, label, rows) {
  lines.push("  " + label + ": " + rows.length + "件");
  for (const row of rows) {
    lines.push("    " + row.account + " / chain " + row.chainId + " / block " + row.blockNumber,
      "    参照元: " + display(row.siteOrigin),
      "    ブロックハッシュ: " + row.blockHash + " / トークン " + row.tokenCount + "件");
  }
}

export function describeWorkspaceChanges(before, after) {
  const review = reviewWorkspaceChanges(before, after);
  const lines = ["契約アドレスと履歴の変更明細", ""];
  for (const card of review.cards) {
    lines.push(card.agent,
      "  単独トークン欄: " + display(card.singleTokenBefore) + " → " + display(card.singleTokenAfter),
      "  復元後のトークン一覧: " + card.tokensAfter.length + "件");
    for (const token of card.tokensAfter) lines.push("    " + display(token));
    if (card.tokensAdded.length) lines.push("  一覧へ追加: " + card.tokensAdded.map(display).join(", "));
    if (card.tokensRemoved.length) lines.push("  一覧から除外: " + card.tokensRemoved.map(display).join(", "));
    if (card.listOrderChanged) lines.push("  トークン一覧の順序が変わります。");
    describeRecords(lines, "追加する過去記録", card.history.added);
    describeRecords(lines, "取り除く過去記録", card.history.removed);
    lines.push("  そのまま残る過去記録: " + card.history.unchanged + "件");
    if (card.addedOutsideCurrentConfiguration) {
      lines.push("  現在の設定とは異なるアドレス・ネットワークの追加記録: " + card.addedOutsideCurrentConfiguration + "件");
    }
    lines.push("");
  }
  lines.push("一覧の追加・除外は画面内の設定変更です。トークンの送金・焼却・承認ではありません。");
  return lines.join("\n");
}
