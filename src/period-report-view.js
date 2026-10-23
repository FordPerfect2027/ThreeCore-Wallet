import { formatReconciliationAmount } from "./reconciliation-engine.js";

export const REPORT_STATUS_TEXT = Object.freeze({
  missing: "記録が選ばれていません",
  partial: "取得途中",
  "requires-new-plan": "再取得が必要",
  "anchor-conflict": "ブロック記録に不一致",
  "arithmetic-agreement": "保存された残高と履歴の計算が一致",
  "unexplained-difference": "説明できない残高差あり",
  "inconsistent-history": "履歴の途中残高に矛盾あり",
  "incomplete-history": "取得範囲に欠落あり",
  "not-comparable": "比較できない記録",
  "missing-input": "残高記録が不足",
  attention: "確認が必要な記録があります",
  incomplete: "3トークンを同じ条件で確認できていません",
});

export const REPORT_ISSUE_TEXT = Object.freeze({
  MISSING_TOKEN: "3トークンすべての記録が選ばれていません。",
  DIFFERENT_CHAINS: "異なるチェーンの記録が含まれています。同じブロック番号でも別の期間です。",
  DIFFERENT_PERIODS: "開始・終了ブロックがそろっていません。",
  BLOCK_HASH_CONFLICT: "同じチェーン・同じブロックのハッシュに不一致があります。新しい計画で再取得してください。",
  QUARANTINED_SOURCE: "再取得が必要と記録された控えが含まれています。",
  INCOMPLETE_ACQUISITION: "予定された取得工程が完了していません。",
  UNEXPLAINED_DIFFERENCE: "保存された残高差を、保存されたTransfer履歴だけでは説明できません。",
  UNUSABLE_HISTORY: "履歴の欠落、残高の矛盾、または比較できない入力があります。",
  SHARED_ACCOUNT: "複数のトークンに同じ公開アドレスが使われています。別々のウォレットであるとは確認していません。",
  ARCHIVED_SOURCE: "非表示保管に移した控えが選ばれています。",
});

const ERRORS = Object.freeze({
  PERIOD_REPORT_OPTIONS: "報告画面の初期化に失敗しました。",
  PERIOD_REPORT_BUSY: "処理中です。完了を待つか中止してください。",
  PERIOD_REPORT_NOT_LOADED: "先にPC内の保存一覧を読み込んでください。",
  PERIOD_REPORT_EMPTY: "少なくとも1つの控えを選択してください。",
  PERIOD_REPORT_SOURCE_MISSING: "選んだ控えが見つかりません。一覧を再読み込みしてください。",
  PERIOD_REPORT_SOURCE_CHANGED: "確認中に選んだ控えが変更されました。一覧を再読み込みし、もう一度確認してください。",
  PERIOD_REPORT_AGENT: "トークンと控えの組み合わせが一致しません。",
  PERIOD_REPORT_REVIEW: "先に作成または読込み内容を確認してください。",
  PERIOD_REPORT_NO_RESULT: "先に報告を作成してください。",
  PERIOD_REPORT_ACK: "元の履歴を含むファイルの保存内容を確認してください。",
  PERIOD_REPORT_DELIVERY: "ファイルを保存できませんでした。再度お試しください。",
  PERIOD_REPORT_FORMAT: "保存形式が指定されていません。",
  PERIOD_REPORT_FILE_SIZE: "報告ファイルのサイズが不正です。上限は64 MiBです。",
  PERIOD_REPORT_FILE_SCHEMA: "対応するThreeCoreの報告JSONではありません。",
  PERIOD_CHECKSUM: "ファイルのチェックサムが一致しません。元の控えを保全して確認してください。",
  PERIOD_FILENAME: "JSONファイルを選択してください。",
  PERIOD_FILE_JSON: "JSONとして読み取れませんでした。",
  PERIOD_FILE_READ: "ファイルを読み込めませんでした。",
  PERIOD_FILE_ENCODING: "UTF-8のファイルではありません。",
  PERIOD_CRYPTO: "ファイルの破損確認機能を利用できません。",
  PERIOD_LIBRARY_LABEL: "報告名を1〜60文字で入力してください。",
  CHECKPOINT_UNAVAILABLE: "このブラウザーではPC内保存を利用できません。JSONから報告を開くことはできます。",
  CHECKPOINT_BLOCKED: "別の画面が保存領域を使用中です。その画面を閉じて再度お試しください。",
  CHECKPOINT_TIMEOUT: "PC内保存の読込みが時間内に完了しませんでした。",
});

export function reportErrorCode(error) {
  const value = error?.code;
  return typeof value === "string" && /^(PERIOD|CHECKPOINT|IDENTITY|TRANSFER|RECONCILIATION)_[A-Z_]+$/.test(value)
    ? value : "PERIOD_REPORT_FAILED";
}

export function reportErrorText(code) {
  return Object.hasOwn(ERRORS, code) ? ERRORS[code] : "処理を完了できませんでした。元の記録は変更されていません。";
}

export function reportStatusText(status) {
  return Object.hasOwn(REPORT_STATUS_TEXT, status) ? REPORT_STATUS_TEXT[status] : "未確認";
}

export function reportIssueText(code) {
  return Object.hasOwn(REPORT_ISSUE_TEXT, code) ? REPORT_ISSUE_TEXT[code] : "記録の追加確認が必要です。";
}

export function reportAmount(value, decimals = 18) {
  return value === null || value === undefined ? "未取得" : formatReconciliationAmount(value, decimals);
}

export function reportSlotText(slot) {
  if (!slot.plan) return slot.agent + ": 記録が選ばれていません。";
  const row = slot.arithmetic, decimals = row.totals?.decimals ?? 18;
  return [slot.agent + " · " + reportStatusText(slot.status),
    "保存名: " + slot.label + (slot.archived ? "（非表示保管）" : ""),
    "chain " + slot.plan.context.chainId + " / " + slot.plan.context.account,
    "期間: " + slot.plan.earlierBlock + " → " + slot.plan.laterBlock + "（開始ブロックの翌ブロックから集計）",
    "取得: " + slot.progress.completed + "/" + slot.progress.total + "工程",
    "開始残高: " + reportAmount(row.earlierBalanceBaseUnits, decimals),
    "終了残高: " + reportAmount(row.laterBalanceBaseUnits, decimals),
    "残高変化: " + reportAmount(row.totals?.observedDeltaBaseUnits, decimals),
    "履歴の差引: " + reportAmount(row.totals?.netTransferBaseUnits, decimals),
    "未説明の差: " + reportAmount(row.totals?.residualBaseUnits, decimals),
    "集計イベント: " + (row.totals?.eventCount ?? "未算出"),
    "算術診断: " + reportStatusText(row.status),
    row.warnings.length ? "補足コード: " + row.warnings.join(", ") : "",
    row.issues.length ? "診断コード: " + row.issues.join(", ") : "",
  ].filter(Boolean).join("\n");
}

export const REPORT_LIMITATION = "過去に保存した記録の比較です。現在の残高、履歴の完全性、独立監査、利益を証明するものではありません。異なるトークンの数量は合算しません。";
