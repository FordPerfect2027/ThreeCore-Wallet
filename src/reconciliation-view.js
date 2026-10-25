import { reconcileWorkspace, formatReconciliationAmount } from "./reconciliation-engine.js";
import { describeReconciliationPart } from "./reconciliation-model.js";

export const RECONCILIATION_STATUS = Object.freeze({
  "missing-input": "残高の記録待ち",
  "not-comparable": "条件が合わず比較できません",
  "incomplete-history": "履歴の期間が不足しています",
  "inconsistent-history": "履歴の途中に矛盾があります",
  "arithmetic-agreement": "保存した記録の計算が一致",
  "unexplained-difference": "説明できない差額があります",
});

const REASONS = Object.freeze({
  EARLIER_MISSING: "比較前の残高を入れてください。",
  LATER_MISSING: "比較後の残高を入れてください。",
  OBSERVATION_CONTEXT_CONFLICT: "前後のアカウント・チェーン・トークンが一致していません。",
  BLOCK_ORDER_CONFLICT: "比較前のブロックが比較後より新しくなっています。",
  EARLIER_METADATA_UNUSABLE: "比較前のコントラクト情報または残高が、登録した仕様と合いません。",
  LATER_METADATA_UNUSABLE: "比較後のコントラクト情報または残高が、登録した仕様と合いません。",
  SAME_BLOCK_HASH_CONFLICT: "同じブロック番号に異なるハッシュが記録されています。",
  SAME_BLOCK_STATE_CONFLICT: "同じブロックに異なる残高または仕様が記録されています。",
  ARCHIVE_CONTEXT_CONFLICT: "履歴のアカウント・チェーン・トークンが残高と異なります。",
  ARCHIVE_ANCHOR_CONFLICT: "残高と履歴で同じブロックのハッシュが異なります。",
  DIFFERENT_OBSERVATION_ORIGINS: "前後の記録は異なるサイトで取得されています。出所は保証できません。",
  DIFFERENT_CONNECTION_EPOCHS: "前後の記録ではウォレットの接続回が異なります。",
  ARCHIVE_MISSING: "この期間の送受信履歴が入っていません。",
  ENDPOINT_HASH_UNCHECKED: "期間の端のハッシュを履歴と照合できない箇所があります。",
  HISTORY_GAPS: "問い合わせた履歴に、この期間をカバーしないブロックがあります。",
  NEGATIVE_IMPLIED_BALANCE: "履歴から計算した途中残高がマイナスです。省略や記録の矛盾を確認してください。",
  IMPLIED_BALANCE_EXCEEDS_ISSUANCE: "履歴から推定した途中残高が、登録済みトークンの初期発行量を超えています。",
  SELF_TRANSFER_EXCEEDS_BALANCE: "自分宛の送信額が、その直前の推定残高を超えています。",
});

export const RECONCILIATION_NOTICE = "保存した残高とTransfer履歴の計算を照合します。現在の残高、全履歴、利益、資産の安全性を証明するものではありません。";
export const RECONCILIATION_STORAGE_NOTICE = "この作業は画面内にあります。閉じる前に「照合データを保存」でJSONを保存してください。再開時はJSONを選び、内容を確認して適用します。";

export function reconciliationReason(code) {
  return REASONS[code] ?? "記録を確認してください。";
}

export function reconciliationErrorMessage(error) {
  const code = error?.code;
  const messages = {
    RECONCILIATION_NO_SOURCE: "選んだカードに保存済みの記録がありません。先に残高や履歴を読み取るか、保存ファイルを選んでください。",
    RECONCILIATION_SLOT_AGENT: "選択したトークンとは異なる記録です。トークンの選択を確認してください。",
    RECONCILIATION_STALE: "確認中に元の内容が変わりました。もう一度取り込んで確認してください。",
    RECONCILIATION_ACK: "置き換え・削除する内容を確認してチェックを入れてください。",
    RECONCILIATION_NO_REVIEW: "適用する確認内容がありません。",
    RECONCILIATION_NO_REPORT: "先に現在の記録を照合してください。",
    RECONCILIATION_BUSY: "読み込みまたは保存の完了を待ってください。",
    RECONCILIATION_CHECKSUM: "ファイルの検査値が一致しません。現在のデータは変更していません。",
    RECONCILIATION_CRYPTO: "ファイルの検査に必要な機能を利用できません。",
    RECONCILIATION_FILENAME: "JSONファイルを選んでください。",
    RECONCILIATION_FILE_SIZE: "ファイルサイズが制限を超えているか、内容を読み取れません。",
    RECONCILIATION_FILE_READ: "ファイルを読み取れませんでした。",
    RECONCILIATION_FILE_ENCODING: "UTF-8のJSONファイルを選んでください。",
    RECONCILIATION_FILE_KIND: "ファイルの種類を確認してください。",
    RECONCILIATION_EXPORT_REFUSED: "書き出しを開始できませんでした。元の記録は保持しています。",
    RECONCILIATION_ASYNC_DELIVERY: "書き出しの開始を確認できませんでした。元の記録は保持しています。",
  };
  if (messages[code]) return messages[code];
  if (typeof code === "string" && /^(IDENTITY|TRANSFER|RECONCILIATION)_[A-Z_]+$/.test(code)) {
    return "記録の形式や内容を確認できませんでした。現在のデータは変更していません。（" + code + "）";
  }
  return "処理を完了できませんでした。現在のデータを確認してください。";
}

export function reconciliationPartText(part, value) {
  const info = describeReconciliationPart(part, value);
  if (!info) return "未登録";
  const context = `${info.agent} / chain ${info.chainId} / ${info.account}`;
  if (part === "archive") return `${context}\n${info.records}期間 / block ${info.firstBlock} ～ ${info.lastBlock}`;
  return `${context}\nblock ${info.blockNumber}\n残高（最小単位）: ${info.balanceBaseUnits ?? "不明"}\n取得サイト: ${info.siteOrigin}`;
}

export function reconciliationReviewText(review) {
  if (!review) return "確認待ちの変更はありません。";
  const names = { earlier: "比較前", later: "比較後", archive: "履歴" };
  const actions = { add: "追加", replace: "置き換え", remove: "削除" };
  if (!review.changes.length) return "現在と同じ内容です。";
  return review.changes.map(change => {
    const render = value => value === null ? "未登録" : `${value.account} / chain ${value.chainId} / ` +
      (value.blockNumber ?? `${value.firstBlock} ～ ${value.lastBlock} (${value.records}期間)`);
    return `${change.agent}・${names[change.part]}: ${actions[change.action]}\n以前: ${render(change.before)}\n変更後: ${render(change.after)}`;
  }).join("\n\n");
}

export function reconciliationTokenText(row) {
  const lines = [
    `${row.agent}: ${RECONCILIATION_STATUS[row.status]}`,
    `account: ${row.account ?? "未登録"}`,
    `chain: ${row.chainId ?? "未登録"}`,
    `contract: ${row.tokenAddress ?? "未登録"}`,
    `比較する区間: (${row.earlierBlock ?? "?"}, ${row.laterBlock ?? "?"}]`,
  ];
  if (row.totals) {
    const t = row.totals;
    const amount = value => formatReconciliationAmount(value, t.decimals) + " " + t.symbol;
    lines.push(
      "比較前の残高: " + amount(row.earlierBalanceBaseUnits),
      "比較後の残高: " + amount(row.laterBalanceBaseUnits),
      "観測された残高の増減: " + amount(t.observedDeltaBaseUnits),
      "履歴の受取合計: " + amount(t.incomingBaseUnits),
      "履歴の送出合計: " + amount(t.outgoingBaseUnits),
      "履歴による増減: " + amount(t.netTransferBaseUnits),
      "説明できない差額: " + amount(t.residualBaseUnits),
      `${t.eventCount}イベント / ${t.transactionCount}取引 / 自分宛 ${t.selfTransferCount} / 金額0 ${t.zeroValueCount}`,
      "自分宛の送受信は受取と送出に各1回入り、増減は0です。",
    );
  }
  if (row.coverage) {
    lines.push(`照合区間 ${row.coverage.expectedBlocks}ブロック / 問い合わせ済み ${row.coverage.coveredBlocks} / 未取得 ${row.coverage.missingBlocks}`);
    for (const gap of row.coverage.gaps) lines.push(`未取得: ${gap.fromBlock} ～ ${gap.toBlock}`);
  }
  if (row.anchors) {
    const labels = { agrees: "記録同士で一致", conflict: "矛盾", unchecked: "履歴に照合材料なし" };
    lines.push("前のハッシュ: " + labels[row.anchors.earlier.status], "後のハッシュ: " + labels[row.anchors.later.status]);
  }
  if (row.excludedEvents) lines.push(`区間外の${row.excludedEvents}イベントは計算から除外しています。`);
  return [...lines, ...row.issues.map(reconciliationReason), ...row.warnings.map(reconciliationReason)].join("\n");
}

export function reconciliationText(input) {
  const report = reconcileWorkspace(input);
  return ["ThreeCore — 残高と履歴の照合", RECONCILIATION_NOTICE,
    "金額は最小単位から整数計算。前のブロックを含まず、後のブロックまで含みます。",
    ...report.slots.map(reconciliationTokenText),
    "検査値はファイル内容の整合性用です。作成者やチェーン上の事実を保証しません。",
  ].join("\n\n") + "\n";
}

/** Quoting plus formula neutralization keeps CSV inert in common spreadsheet programs. */
export function reconciliationCsvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

function csv(rows) {
  return "\ufeff" + rows.map(row => row.map(reconciliationCsvCell).join(",")).join("\r\n") + "\r\n";
}

export function reconciliationSummaryCsv(input) {
  const report = reconcileWorkspace(input);
  return csv([
    ["agent", "account", "chain_id", "token_address", "status", "earlier_block_exclusive", "later_block_inclusive",
      "earlier_balance_base_units", "later_balance_base_units", "observed_delta_base_units", "transfer_net_base_units",
      "residual_base_units", "covered_blocks", "missing_blocks", "events", "issues", "warnings", "independently_verified"],
    ...report.slots.map(row => [row.agent, row.account, row.chainId, row.tokenAddress, row.status,
      row.earlierBlock, row.laterBlock, row.earlierBalanceBaseUnits, row.laterBalanceBaseUnits,
      row.totals?.observedDeltaBaseUnits, row.totals?.netTransferBaseUnits, row.totals?.residualBaseUnits,
      row.coverage?.coveredBlocks, row.coverage?.missingBlocks, row.totals?.eventCount,
      row.issues.join(";"), row.warnings.join(";"), false]),
  ]);
}

export function reconciliationEventsCsv(input) {
  const report = reconcileWorkspace(input);
  return csv([
    ["agent", "account", "chain_id", "status", "block", "block_hash", "transaction_hash", "transaction_index", "log_index",
      "direction", "from", "to", "amount_base_units", "delta_base_units", "cumulative_delta_base_units", "implied_balance_base_units",
      "independently_verified"],
    ...report.slots.flatMap(row => row.events.map(event => [row.agent, row.account, row.chainId, row.status,
      event.blockNumber, event.blockHash, event.transactionHash, event.transactionIndex, event.logIndex,
      event.direction, event.from, event.to, event.amountBaseUnits, event.deltaBaseUnits,
      event.cumulativeBaseUnits, event.impliedBalanceBaseUnits, false])),
  ]);
}
