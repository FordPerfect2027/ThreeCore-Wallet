const messages = Object.freeze({
  TRANSFER_WINDOW_GENESIS: "開始ブロックが0のため、前の期間はありません。",
  TRANSFER_WINDOW_MINIMUM: "1ブロックの範囲は、これ以上絞れません。",
  TRANSFER_ARCHIVE_REQUIRED: "先に履歴をまとめに追加してください。",
  TRANSFER_ARCHIVE_LIMIT: "まとめには1～12件の記録を保存できます。",
  TRANSFER_ARCHIVE_SCHEMA: "対応する履歴のまとめファイルではありません。",
  TRANSFER_ARCHIVE_CONTEXT: "同じ口座・トークン・チェーンの記録だけをまとめられます。",
  TRANSFER_ARCHIVE_DUPLICATE_RANGE: "同じ期間の記録がすでにあります。比較画面で内容を確認してください。",
  TRANSFER_ARCHIVE_OVERLAP: "重なる期間の履歴が一致しません。混ぜずに個別の記録を比較してください。",
  TRANSFER_ARCHIVE_BLOCK_CONFLICT: "同じ高さのブロックが一致しません。記録を混ぜず、再確認してください。",
  TRANSFER_ARCHIVE_EVENT_CONFLICT: "同じイベントの内容が一致しません。個別の記録を比較してください。",
  TRANSFER_ARCHIVE_INDEX: "表示する記録を選択してください。",
  TRANSFER_ARCHIVE_FILE_SIZE: "まとめファイルが空か、6 MiBを超えています。",
  TRANSFER_NOT_CONNECTED: "先に、このカードのWalletを接続してください。",
  TRANSFER_CONTEXT: "DAT・EMA・CAWELONとBaseの設定を確認してください。",
  TRANSFER_ADDRESS: "完全なWallet公開アドレスを入力してください。",
  TRANSFER_INTEGER: "ブロック番号は0以上の整数を半角で入力してください。",
  TRANSFER_LOOKBACK: "直近のブロック数は1～2,000で指定してください。",
  TRANSFER_RANGE: "開始から終了までを2,000ブロック以内で指定してください。",
  TRANSFER_FUTURE_BLOCK: "終了ブロックが最新ブロックより先になっています。",
  TRANSFER_TOKEN_UNAVAILABLE: "指定時点の登録トークンを確認できませんでした。",
  TRANSFER_METADATA_MISMATCH: "取得したトークンの名称・記号・桁数が登録情報と一致しません。",
  TRANSFER_RPC_FAILED: "Walletから履歴を取得できませんでした。接続と対応状況を確認してください。",
  TRANSFER_BLOCK_CHANGED: "参照中にブロックの不一致を検出しました。範囲を確認して再取得してください。",
  TRANSFER_EVENT_LIMIT: "履歴件数または参照ブロック数が上限を超えました。期間を狭めてください。",
  TRANSFER_SESSION_CHANGED: "接続先が変わったため、読み取りを破棄しました。",
  TRANSFER_TIMEOUT: "読み取り時間を超えました。期間を狭めて再取得してください。",
  TRANSFER_CANCELLED: "読み取りを中止しました。",
  TRANSFER_FILE_SIZE: "ファイルが空か、512 KiBを超えています。",
  TRANSFER_FILE_NAME: "この画面で保存したJSONファイルを選択してください。",
  TRANSFER_FILE_JSON: "JSONファイルとして読み取れませんでした。",
  TRANSFER_FILE_SCHEMA: "対応する送受信履歴ファイルではありません。",
  TRANSFER_FILE_ENCODING: "UTF-8のファイルを選択してください。",
  TRANSFER_FILE_READ: "ファイルを読み取れませんでした。",
  TRANSFER_CHECKSUM_MISMATCH: "保存時のチェックサムと一致しません。元のファイルを確認してください。",
  TRANSFER_IMPORT_CONTEXT: "ファイルの口座・トークン・チェーンが、このカードの設定と違います。",
  TRANSFER_COMPARISON_CONTEXT: "比較には、同じ口座・トークン・ブロック範囲の記録が必要です。",
  TRANSFER_REVIEW_REQUIRED: "読み込み内容をプレビューしてから反映してください。",
  TRANSFER_BASELINE_REQUIRED: "比較元の記録を指定してください。",
  TRANSFER_SNAPSHOT_REQUIRED: "先に履歴を取得するか、保存した記録を読み込んでください。",
  TRANSFER_CRYPTO_UNAVAILABLE: "このブラウザーではチェックサムを確認できません。",
  TRANSFER_CRYPTO_FAILED: "チェックサムの計算に失敗しました。",
});

export function transferErrorText(code) {
  return Object.hasOwn(messages, code) ? messages[code] : "履歴の形式や取得内容を確認できなかったため、処理を中止しました。";
}

const stages = Object.freeze({ range: "期間を確認", token: "トークンを照合", incoming: "受信履歴を取得",
  outgoing: "送信履歴を取得", blocks: "ブロックを照合", canonical: "期間の最終確認", complete: "取得完了" });

export function transferProgressText(progress) {
  if (!progress || !Object.hasOwn(stages, progress.stage)) return "読み取り中です。";
  return stages[progress.stage] + (progress.total ? ` ${progress.completed} / ${progress.total}` : "");
}
