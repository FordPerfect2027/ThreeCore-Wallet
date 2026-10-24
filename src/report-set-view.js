import { historyErrorText, historyErrorCode } from "./report-history-view.js";
import { reportStatusText } from "./period-report-view.js";

export const SET_LIMITATION = "保存した報告の計画範囲と証拠の照合です。現在のチェーン状態や履歴の完全性を認証しません。トークン数量やイベントを合算せず、利益も計算しません。";
export const SET_ISSUES = Object.freeze({
  SINGLE_REPORT: "報告が1件のため、複数期間のつながりは確認できません。",
  MISSING_TOKEN: "選択した報告に含まれていないトークンがあります。",
  MIXED_CONTEXTS: "チェーン・コントラクト・アカウント等が異なる記録を別グループに分けています。",
  GAPS: "選択した計画の範囲に抜けがあります。",
  OVERLAPS: "選択した計画の範囲が重複しています。",
  REPEATED_EVIDENCE: "同じ証拠を含む複数の報告があります。",
  INCOMPLETE_EVIDENCE: "取得途中、再取得が必要、または計算が一致しない記録があります。",
  BALANCE_CONFLICTS: "同じブロック・ハッシュで保存された残高が異なります。",
  HASH_CONFLICTS: "同じチェーン・ブロックのハッシュが食い違っています。",
  REPORTS_NEED_REVIEW: "3トークンを同条件で照合できていない報告があります。",
});
export const SET_SEGMENTS = Object.freeze({ single: "計画1件", gap: "計画の抜け", overlap: "計画の重複", repeated: "同じ証拠の重複" });
export const SET_SOURCE_STATUS = Object.freeze({ exact: "保存内容と一致", metadata: "名前・メモ・保管状態が変更", changed: "報告の証拠が変更", missing: "保存番号が見つからない" });
const ERRORS = Object.freeze({
  PERIOD_SET_EMPTY: "確認する報告を1件以上選んでください。",
  PERIOD_SET_SCHEMA: "対応する確認セットの形式ではありません。",
  PERIOD_SET_TITLE: "確認名を確認してください。",
  PERIOD_SET_DUPLICATE_SELECTION: "同じ報告が重複して選ばれています。",
  PERIOD_SET_SOURCE_MISSING: "選択した報告が保存一覧にありません。読み直してください。",
  PERIOD_SET_SOURCE_CHANGED: "確認中に選択した報告が変わりました。保存一覧を読み直して選び直してください。",
  PERIOD_SET_NOT_LOADED: "先に報告の一覧を読み込んでください。",
  PERIOD_SET_NO_REVIEW: "先に選択内容を確認してください。",
  PERIOD_SET_NO_RESULT: "先に確認セットを作成するか、JSONから開いてください。",
  PERIOD_SET_BUSY: "確認セットの処理中です。完了を待つか中止してください。",
  PERIOD_SET_SIZE: "確認セットの上限は12報告・64 MiBです。",
  PERIOD_SET_FILE_SIZE: "ファイルの大きさが不正です。96 MiBまでのJSONを選んでください。",
  PERIOD_SET_FILE_SCHEMA: "確認セット用のバックアップJSONではありません。",
  PERIOD_SET_ACK: "保存される情報の内容を確認してチェックを入れてください。",
  PERIOD_SET_EXPORT_OPTIONS: "説明用ファイルの出力設定が不正です。",
  PERIOD_SET_FORMAT: "この形式では書き出せません。",
  PERIOD_SET_DISPOSED: "画面が閉じられています。",
  PERIOD_SET_FAILED: "処理を完了できませんでした。元の報告履歴は変更していません。",
  PERIOD_SET_OPTIONS: "確認機能の設定が不正です。画面を開き直してください。",
});

export function setErrorCode(value) {
  const code = historyErrorCode(value);
  return code === "PERIOD_HISTORY_FAILED" ? "PERIOD_SET_FAILED" : code;
}
export function setErrorText(code) { return ERRORS[code] ?? historyErrorText(code); }
export function shortSetAddress(value, shorten = true) {
  return !value ? "—" : shorten ? value.slice(0, 8) + "…" + value.slice(-6) : value;
}
export function setStatusText(result) {
  return result.allContinuous ? "選択した証拠は3トークンとも期間境界で一致" : "確認が必要な箇所があります";
}
export function setIssueText(code) { return SET_ISSUES[code] ?? "確認が必要です。"; }

export function setSummaryText(result) {
  if (!result) return "";
  return [result.title, setStatusText(result), "対象: " + result.reportCount + "報告（非表示保管 " + result.archivedCount + "件）",
    "確認セット作成日時: " + result.createdAt,
    ...result.issues.map(setIssueText), SET_LIMITATION].join("\n");
}

export function setTokenText(token, shortAddresses = true) {
  const lines = [token.agent, token.continuous ? "選択した期間の境界が一致" : "期間・証拠の確認が必要"];
  if (token.hashConflictCount || token.invalidAnchorCount) lines.push("ブロックハッシュの食い違い: " +
    token.hashConflictCount + "箇所 / 記録内の矛盾: " + token.invalidAnchorCount + "件");
  if (token.missingReportIds.length) lines.push("このトークンを含まない報告: " + token.missingReportIds.length + "件");
  for (const group of token.groups) {
    lines.push("Chain " + group.context.chainId + " / " + shortSetAddress(group.context.account, shortAddresses));
    lines.push("計画範囲: " + group.start + " → " + group.end + " / " + group.rows.length + "報告");
    lines.push("計画に含まれるブロック数（重複分を除く）: " + group.plannedUniqueBlocks);
    lines.push("計画の抜け: " + group.gapBlocks + " / 重複: " + group.overlapBlocks + " ブロック");
    for (const row of group.rows) lines.push("  " + row.reportLabel + ": " + row.start + " → " + row.end + " / " + reportStatusText(row.status));
    if (group.balanceConflicts.length) lines.push("同一ブロックの残高不一致: " + group.balanceConflicts.length + "件");
  }
  return lines.join("\n");
}

export function setSourcesText(inspection) {
  if (!inspection) return "";
  return ["現在のPC内保存一覧との照合 / 版 " + inspection.revision,
    ...inspection.rows.map(row => row.label + ": " + SET_SOURCE_STATUS[row.status]),
    "照合のみです。確認セットと元の保存一覧は変更していません。"].join("\n");
}
