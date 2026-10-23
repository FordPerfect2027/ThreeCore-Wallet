import { transferErrorText } from "./transfer-messages.js";

const messages = Object.freeze({
  TRANSFER_VAULT_UNDO_EMPTY: "元に戻す・やり直す記録はありません。",
  TRANSFER_VAULT_UNDO_STALE: "復元履歴と画面の記録が一致しません。保存ファイルから内容を確認してください。",
  TRANSFER_VAULT_IMPORT_CONFLICT: "同じ保存番号で内容が違う記録があります。既存の保管記録は上書きしていません。",
  TRANSFER_VAULT_COLLECTION_SCHEMA: "このファイルは保存一覧の保全形式ではありません。",
  TRANSFER_VAULT_COLLECTION_SIZE: "保存一覧ファイルは空でない40 MiB以下のJSONを指定してください。",
  TRANSFER_VAULT_ARRAY: "記録の一覧の形式を確認してください。",
  TRANSFER_VAULT_SCHEMA: "ThreeCoreの履歴保管ファイルではありません。",
  TRANSFER_VAULT_SLOTS: "DAT・EMA・CAWELONの並びと記録を確認してください。",
  TRANSFER_VAULT_CONTEXT: "トークン・アカウント・チェーンが一致しません。既存の設定は変更していません。",
  TRANSFER_VAULT_RANGE_CONFLICT: "同じ期間に異なる記録があります。個別の履歴画面で比較してから保存してください。",
  TRANSFER_VAULT_SIZE: "履歴の容量が上限を超えています。期間や保管件数を減らしてください。",
  TRANSFER_VAULT_FILE_SIZE: "ファイルは空でない20 MiB以下のJSONを指定してください。",
  TRANSFER_VAULT_FILE_SCHEMA: "このファイルは3トークン一括形式ではありません。旧形式なら読み込み形式を選択してください。",
  TRANSFER_VAULT_FILE_KIND: "読み込み・保存の形式を確認してください。",
  TRANSFER_VAULT_EMPTY: "保管する履歴がありません。まず履歴を取得するか保存ファイルを開いてください。",
  TRANSFER_VAULT_LABEL: "保存名は1～60文字で入力してください。改行や制御文字は使用できません。",
  TRANSFER_VAULT_ID: "保存記録の識別番号が不正です。",
  TRANSFER_VAULT_TIME: "保存日時が不正です。PCの時刻設定を確認してください。",
  TRANSFER_VAULT_DOCUMENT: "保存データの形式を確認できませんでした。自動修復や上書きは行いません。",
  TRANSFER_VAULT_DUPLICATE: "同じ保存番号が存在します。再読み込みしてから操作してください。",
  TRANSFER_VAULT_STALE: "別の画面で保管庫が変更されています。一覧を再読み込みして内容を確認してください。",
  TRANSFER_VAULT_CAPACITY: "保存は最大5件です。JSONへ書き出してから不要な保管記録を整理してください。",
  TRANSFER_VAULT_MISSING: "選択した保存記録がありません。一覧を再読み込みしてください。",
  TRANSFER_VAULT_CONFIRMATION: "消える記録の確認が必要です。プレビューをやり直して確認欄を選択してください。",
  TRANSFER_VAULT_REVISION: "保存の更新番号が上限に達しました。JSONへ書き出してください。",
  TRANSFER_VAULT_REFRESH_REQUIRED: "最初に「PC内の保存一覧を開く」を押してください。",
  TRANSFER_VAULT_SELECTION: "操作する保存記録を一覧から選択してください。",
  TRANSFER_VAULT_ARCHIVED: "この記録は非表示保管中です。戻してから内容を読み込んでください。",
  TRANSFER_VAULT_REVIEW_REQUIRED: "プレビューが古くなりました。内容をもう一度確認してください。",
  TRANSFER_VAULT_CARDS_CHANGED: "プレビュー後にカードの履歴が変わりました。取り込み直してください。",
  TRANSFER_VAULT_CARD_REVIEW: "カードにプレビューできませんでした。対象トークンのアカウントとチェーンを確認してください。",
  TRANSFER_VAULT_NO_MATCHES: "この検索条件に一致する履歴がありません。条件を変えて確認してください。",
  TRANSFER_VAULT_QUERY: "検索条件を確認してください。",
  TRANSFER_VAULT_CANCELLED: "操作を中止しました。",
  TRANSFER_VAULT_ACTION: "処理を完了できませんでした。既存の保存を確認してから再試行してください。",
  CHECKPOINT_QUOTA: "ブラウザーの保存容量が不足しています。JSONを保存してから容量を確認してください。",
  CHECKPOINT_UNAVAILABLE: "このブラウザーではPC内保存を利用できません。JSONへの保存を使用してください。",
  CHECKPOINT_BLOCKED: "別の画面が保存領域を使用しています。その画面を閉じてから再試行してください。",
  CHECKPOINT_TIMEOUT: "保存領域を開く処理がタイムアウトしました。再試行してください。",
  CHECKPOINT_CLOSED: "保存領域が閉じられました。画面を開き直してください。",
  CHECKPOINT_ABORTED: "保存処理が中止されました。一覧を再読み込みして結果を確認してください。",
  CHECKPOINT_CANCELLED: "保存処理を中止しました。一覧を再読み込みして確認できます。",
  CHECKPOINT_VERSION: "保存領域のバージョンが異なります。自動で書き換えていません。",
  CHECKPOINT_SCHEMA: "保存領域を確認できませんでした。自動で書き換えていません。",
  CHECKPOINT_STORAGE: "PC内保存に失敗しました。JSONを書き出して保全してください。",
});

export function vaultErrorText(code) {
  return messages[code] ?? transferErrorText(code);
}

export function vaultReviewText(review) {
  if (!review) return "";
  const source = ({ cards: "画面の履歴", file: "一括JSON", legacy: "個別の履歴JSON", stored: "PC内の保存" })[review.source] ?? "記録";
  const lines = [source + "からのプレビュー", "変更対象はこの保管画面の作業用コピーです。Walletの接続や設定は変更しません。"];
  for (const row of review.changes) {
    lines.push(`${row.agent}: 追加 ${row.added}期間 / 外れる ${row.removed}期間` + (row.contextChanged ? "（アカウントまたはチェーンが変更）" : ""));
  }
  if (review.unchanged) lines.push("表示中の記録と同じ内容です。");
  if (review.removesRecords) lines.push("作業用コピーから外れる記録があります。PC内の保存済み記録や既存ファイルは変更されません。");
  lines.push("内容は過去の記録です。現在のチェーン状態は未確認です。");
  return lines.join("\n");
}
