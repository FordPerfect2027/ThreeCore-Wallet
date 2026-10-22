import { validateAllowanceTargets } from "./allowance-targets.js";
import { validateAllowanceObservation, summarizeAllowances, filterAllowances, compareAllowances } from "./allowance-observation.js";
import { tokenIdentityErrorMessage } from "./token-identity-view.js";

const STATUS = Object.freeze({
  zero: "承認額ゼロ", nonzero: "承認額あり", maximum: "uint256最大値の承認", unknown: "承認額は未確認",
});
export function describeAllowanceTargets(input) {
  const plan = validateAllowanceTargets(input);
  return [
    plan.agent + " / " + (plan.chainId === 84532 ? "Base Sepolia（テスト）" : "Base Mainnet"),
    "トークン: " + plan.tokenAddress,
    "確認する相手: " + plan.targets.length + "件",
    ...plan.targets.map((target, index) => (index + 1) + ". " + (target.label ? target.label + "\n   " : "") + target.address),
    "名前はこのPCで付けたラベルです。相手の運営者や正当性を証明しません。",
    "指定した相手だけを読み取ります。Walletの承認先をすべて発見する機能ではありません。",
  ].join("\n");
}
export function describeAllowanceProgress(value) {
  if (!value) return "";
  const labels = {
    __proto__: null,
    token: "トークンの契約情報と残高を照合しています。",
    "spender-code": "指定した相手のコードを確認しています。",
    allowance: "参照ブロックの承認額を読み取っています。",
    "row-complete": "この相手の読み取りを終えました。",
    canonical: "参照ブロックが変わっていないか再確認しています。",
    complete: "取得した内容を画面の設定と照合しています。",
  };
  if (!Object.hasOwn(labels, value.stage) || !Number.isInteger(value.completed) ||
      !Number.isInteger(value.total) || value.total < 1 || value.total > 20 ||
      value.completed < 0 || value.completed > value.total) return "";
  return labels[value.stage] + "\n相手ごとの確認: " + value.completed + " / " + value.total;
}
export function describeAllowanceObservation(input, provenance = "imported", filter) {
  const record = validateAllowanceObservation(input);
  const summary = summarizeAllowances(record);
  const rows = filterAllowances(record, filter);
  const identity = record.identity;
  const lines = [
    provenance === "read" ? "今回読み取ったブロック時点の記録" : "ファイルから読み込んだ過去の承認記録",
    identity.agent + " / " + (identity.chainId === 84532 ? "Base Sepolia（テスト）" : "Base Mainnet"),
    "Wallet: " + identity.account,
    "トークン: " + identity.tokenAddress,
    "参照元: " + identity.siteOrigin,
    "ブロック: " + identity.blockNumber + "\nハッシュ: " + identity.blockHash,
    "照合状態: " + (summary.tokenStatus === "matched" ? "登録情報と一致" : "未完了・不一致あり"),
    "確認対象 " + summary.requested + "件 / 承認額取得 " + summary.knownAmounts + "件 / 未確認 " + summary.unknownAmounts + "件",
    "承認額あり " + summary.positiveAmounts + "件（最大値 " + summary.maximumAmounts + "件）/ ゼロ " + summary.zeroAmounts + "件",
    "表示対象: " + rows.length + " / " + summary.requested + "件",
    "",
  ];
  for (const row of rows) {
    lines.push((row.label || "ラベルなし") + "\n" + row.spenderAddress);
    lines.push(STATUS[row.status]);
    lines.push("承認額（最小単位）: " + (row.allowanceBaseUnits ?? "未確認"));
    lines.push("トークン単位: " + (row.amount === null ? "照合未完了・未確認のため表示しません" : row.amount + " " + identity.agent));
    lines.push("相手のコード: " + (row.hasCode === null ? "未確認" : row.hasCode ? "あり" : "なし"));
    if (row.codeError) lines.push("コードを取得できませんでした。承認額の確認とは別の結果です。");
    if (row.allowanceError) lines.push("承認額を取得できませんでした。ゼロとして扱っていません。");
    if (row.status === "maximum") lines.push("最大値の設定です。無期限の許可や安全性を証明する意味ではありません。");
    if (row.exceedsObservedBalance === true) lines.push("承認額は、このブロックで確認した残高より大きい値です。");
    if (row.selfSpender) lines.push("相手はこのWallet自身のアドレスです。");
    if (row.tokenIsSpender) lines.push("相手はトークンの契約アドレス自身です。");
    if (row.smallerAmount !== null) lines.push("残高と承認額の小さい方（参考値）: " + row.smallerAmount + " " + identity.agent);
    lines.push("");
  }
  lines.push("相手のコード有無や承認額だけでは、安全性や実際に移動できる金額を判断できません。",
    "承認額は相手ごとに重なるため、合計して資産総額や損失額にはしません。",
    "指定外の承認先、署名による許可、NFTの承認などはこの一覧の対象外です。",
    "承認の追加・取消・署名・送金は行っていません。記録は現在の許可や所有権の証明ではありません。");
  if (provenance !== "read") lines.push("破損チェックは、ファイルの作成者やチェーン上の真正性の証明ではありません。");
  return lines.join("\n");
}
export function describeAllowanceComparison(before, after) {
  const comparison = compareAllowances(before, after);
  const labels = { "new-target": "今回初めて指定した相手", "omitted-target": "今回は指定しなかった相手",
    unknown: "比較できる承認額が不足", increased: "承認額が増加", decreased: "承認額が減少", unchanged: "承認額に差なし" };
  const lines = ["基準記録との比較: block " + comparison.earlierBlock + " → " + comparison.laterBlock];
  for (const row of comparison.rows) {
    lines.push("", row.label || "ラベルなし", row.spenderAddress, labels[row.status],
      "以前: " + (row.before ?? "未確認") + " / 今回: " + (row.after ?? "未確認"),
      "最小単位の差: " + (row.deltaBaseUnits ?? "比較不可"));
    if (row.deltaAmount !== null) lines.push("トークン単位の差: " + row.deltaAmount);
    if (row.labelChanged) lines.push("PC上のラベルが変わりました。");
    if (row.codeChanged) lines.push("相手のコード有無の観測結果が変わりました。");
  }
  lines.push("", "一覧から外した相手の承認を取り消した、という意味ではありません。",
    "残高・承認額の差から、承認取引・取消取引やその原因を特定することはできません。");
  return lines.join("\n");
}
export function allowanceErrorMessage(code) {
  const errors = {
    __proto__: null,
    ALLOWANCE_TARGETS: "確認する相手を1〜20件で指定してください。",
    ALLOWANCE_ADDRESS: "相手の完全な公開アドレスを確認してください。",
    ALLOWANCE_LABEL: "ラベルは制御文字を含まない短い名前にしてください。",
    ALLOWANCE_DUPLICATE: "同じアドレスが重複しています。1件にまとめてください。",
    ALLOWANCE_DRAFT: "1行に1アドレス、必要なら「| ラベル」を付けて入力してください。",
    ALLOWANCE_TOKEN: "カードのトークン欄を、選択したトークンの公式アドレスに合わせてください。",
    ALLOWANCE_CONTEXT: "DAT・EMA・CAWELONとBaseのネットワークを確認してください。",
    ALLOWANCE_CONTEXT_CHANGED: "設定が変わりました。確認対象をもう一度確認してください。",
    ALLOWANCE_NOT_CONNECTED: "先にこのカードのWalletを接続してください。",
    ALLOWANCE_REVIEW_REQUIRED: "先に確認対象の一覧を表示し、適用してください。",
    ALLOWANCE_SESSION_CHANGED: "読み取り中に接続が変わりました。結果は採用していません。",
    ALLOWANCE_TIMEOUT: "読み取りの待機を終了しました。接続状態を確認してください。",
    ALLOWANCE_CANCELLED: "承認額の確認を中止しました。",
    ALLOWANCE_BLOCK_CHANGED: "参照ブロックが変わりました。もう一度確認してください。",
    ALLOWANCE_NO_RESULT: "保存・比較する記録または対象一覧がありません。",
    ALLOWANCE_IMPORT_AGENT: "この記録は別のトークンのカード用です。",
    ALLOWANCE_COMPARE_CONTEXT: "同じWallet・トークン・ネットワーク・参照元の記録を比較してください。",
    ALLOWANCE_COMPARE_ORDER: "比較の基準の方が新しいブロックになっています。",
    ALLOWANCE_BLOCK_CONFLICT: "同じ高さのブロックハッシュが一致しません。",
    ALLOWANCE_SAME_BLOCK_CONFLICT: "同じブロックの観測内容が一致しません。",
    ALLOWANCE_CHECKSUM: "ファイルの破損チェックが一致しません。",
    ALLOWANCE_FILE_SIZE: "空でない64KB以下のJSONファイルを指定してください。",
    ALLOWANCE_FILENAME: "拡張子.jsonの記録ファイルを指定してください。",
    ALLOWANCE_FILE_READ: "ファイルを読み取れませんでした。",
    ALLOWANCE_FILE_ENCODING: "ファイルをUTF-8として読み取れませんでした。",
    ALLOWANCE_FILE_JSON: "JSONの形式を読み取れませんでした。",
    ALLOWANCE_FILE_SCHEMA: "この承認記録のファイル形式に対応していません。",
    ALLOWANCE_CRYPTO: "破損チェックを利用できません。localhostまたはHTTPSで開いてください。",
    ALLOWANCE_DOWNLOAD: "ダウンロードを開始できませんでした。",
  };
  if (Object.hasOwn(errors, code)) return errors[code];
  if (typeof code === "string" && code.startsWith("IDENTITY_")) return tokenIdentityErrorMessage(code);
  return "確認を完了できませんでした。接続・入力・ファイルを確認してください。";
}
