import { reportStatusText, reportIssueText, reportErrorText, REPORT_LIMITATION } from "./period-report-view.js";
import { analyzePeriodReport } from "./period-report-engine.js";
export { REPORT_LIMITATION };

const ERRORS = Object.freeze({
  PERIOD_HISTORY_NOT_LOADED: "先に報告履歴を読み込んでください。",
  PERIOD_HISTORY_BUSY: "処理中です。完了を待つか中止してください。",
  PERIOD_HISTORY_NO_SOURCE: "先に上の画面で期間レポートを作成してください。",
  PERIOD_HISTORY_SOURCE_CHANGED: "確認中に表示中の報告が変わりました。内容を確認し直してください。",
  PERIOD_HISTORY_STALE: "別の画面で保存内容が変わりました。一覧を再読み込みしてください。",
  PERIOD_HISTORY_NOT_FOUND: "選んだ報告が見つかりません。一覧を再読み込みしてください。",
  PERIOD_HISTORY_DUPLICATE_REPORT: "同じ報告はすでに保存されています。既存の報告を選んでください。",
  PERIOD_HISTORY_DUPLICATE_ID: "保存番号が重複しています。確認からやり直してください。",
  PERIOD_HISTORY_CONFLICT: "同じ保存番号に別の報告があります。競合を除外するか、復元を中止してください。",
  PERIOD_HISTORY_CAPACITY: "保存上限は12件・合計64 MiBです。既存の履歴を保全し、別のJSONとして管理してください。",
  PERIOD_LIBRARY_CAPACITY: "保存件数または配列の形式が上限に合いません。",
  PERIOD_HISTORY_NOTE: "メモは500文字以内です。制御文字は使えません。",
  PERIOD_HISTORY_TAGS: "タグは英小文字・数字・ハイフンの24文字以内で、重複せず6個までです。",
  PERIOD_HISTORY_TIME_ORDER: "PCの時刻が前の更新より過去になっています。時計を確認してください。",
  PERIOD_HISTORY_REVIEW: "先に操作内容を確認してください。",
  PERIOD_HISTORY_ACK: "公開アドレス・残高・メモを含む保存内容を確認してください。",
  PERIOD_HISTORY_QUERY: "検索条件を確認してください。",
  PERIOD_HISTORY_COMPARE: "比較する2つの異なる報告を選んでください。",
  PERIOD_HISTORY_SOURCES_UNAVAILABLE: "元の期間の保存一覧を利用できません。報告そのものは履歴から開けます。",
  PERIOD_HISTORY_FILE_SIZE: "ファイルの大きさが不正です。上限は96 MiBです。",
  PERIOD_HISTORY_FILE_SCHEMA: "ThreeCoreの報告履歴バックアップではありません。",
  PERIOD_HISTORY_DELIVERY: "報告画面への引き渡しを完了できませんでした。保存済みの履歴は残っています。",
  PERIOD_HISTORY_FAILED: "処理を完了できませんでした。保存一覧を再読み込みして状態を確認してください。",
  CHECKPOINT_QUOTA: "ブラウザーの保存容量が不足しています。既存データを保全してください。",
  CHECKPOINT_CANCELLED: "保存を中止しました。一覧を再読み込みして結果を確認してください。",
});

export function historyErrorCode(error) {
  let code;
  try { code = error?.code; } catch { return "PERIOD_HISTORY_FAILED"; }
  return typeof code === "string" && /^(PERIOD|CHECKPOINT|IDENTITY|TRANSFER|RECONCILIATION)_[A-Z_]+$/.test(code)
    ? code : "PERIOD_HISTORY_FAILED";
}

export function historyErrorText(code) {
  return Object.hasOwn(ERRORS, code) ? ERRORS[code] : reportErrorText(code);
}

export function historyReportText(input) {
  const report = analyzePeriodReport(input);
  return [input.title, reportStatusText(report.status), "報告の作成日時: " + input.createdAt,
    ...report.slots.map(slot => slot.agent + ": " + reportStatusText(slot.status) + (slot.plan ?
      " / chain " + slot.plan.context.chainId + " / " + slot.plan.earlierBlock + "→" + slot.plan.laterBlock +
      " / " + slot.plan.context.account : "")),
    ...report.issues.map(reportIssueText), ...report.warnings.map(reportIssueText), REPORT_LIMITATION].join("\n");
}

export function historyReviewText(review) {
  if (!review) return "";
  if (review.kind === "merge") {
    const plan = review.plan;
    return ["バックアップの追加復元", "追加 " + plan.additions.length + "件 / 重複 " + plan.duplicates.length +
      "件 / 競合 " + plan.conflicts.length + "件",
      "既存の名前・メモ・保管状態を優先する記録: " + plan.metadataKept.length + "件",
      ...plan.conflicts.map(row => "競合: " + row.localLabel + " / 取込側: " + row.incomingLabel),
      review.skipConflicts ? "競合する記録は除外し、ほかの新しい記録だけを追加します。" : "競合がある場合、まだ適用できません。",
      plan.capacityExceeded ? "容量上限を超えるため追加できません。" : "復元後の合計: " + plan.resultingCount + "件",
      "既存の証拠・メモは上書きされません。チェックサムは出所や正しさを認証しません。"].join("\n");
  }
  return [review.kind === "save" ? "表示中の報告をPC内に保存" : "保存した報告を上の報告画面で開く",
    "保存名: " + review.entry.label, "メモ: " + (review.entry.note || "なし"),
    "タグ: " + (review.entry.tags.join(", ") || "なし"),
    review.entry.archived ? "非表示保管に移した報告です。" : "",
    historyReportText(review.entry.report), review.comparisonText ?? ""].filter(Boolean).join("\n");
}
