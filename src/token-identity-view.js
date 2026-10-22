import { catalogToken, reviewCatalogAddress } from "./token-catalog.js";
import { assessTokenObservation, validateTokenObservation, compareTokenObservations } from "./token-identity-model.js";

const STATUS = Object.freeze({
  matched: "登録した公式情報と一致",
  mismatch: "公式情報と一致しない項目があります",
  "missing-code": "契約コードが見つかりません",
});

const FIELD = Object.freeze({
  code: "契約コード", name: "名前", symbol: "シンボル", decimals: "小数桁",
  supply: "発行上限との比較", balance: "残高と総供給量の比較",
});

const CHECK_STATUS = Object.freeze({
  match: "一致", mismatch: "不一致", unknown: "未確認",
  missing: "なし", "within-issuance": "発行上限以内",
  "exceeds-issuance": "発行上限を超えています", "within-supply": "総供給量以内",
  "exceeds-supply": "総供給量を超えています",
});

export function tokenIdentityProgressMessage(stage) {
  const stages = {
    __proto__: null,
    block: "参照ブロックを取得しています。",
    code: "選択した契約のコードを確認しています。",
    native: "同じブロックのETH残高を確認しています。",
    metadata: "名前・シンボル・小数桁・総供給量を確認しています。",
    balance: "同じブロックのトークン残高を確認しています。",
    canonical: "参照ブロックが変わっていないか再確認しています。",
    complete: "取得した内容を画面の設定と照合しています。",
  };
  return stages[stage] ?? "";
}

export function describeCatalog(context, input = "") {
  const selected = catalogToken(context);
  const lines = [
    selected.agent + " / " + selected.networkLabel,
    "正式名称: " + selected.name,
    "契約アドレス: " + selected.address,
    "小数桁: " + selected.decimals,
    "コードと技術資料: " + selected.repository,
  ];
  if (input) {
    try {
      const review = reviewCatalogAddress(context, input);
      const labels = {
        expected: "入力されたアドレスは登録情報と一致しています。",
        "other-agent": "別のトークンのアドレスが入力されています。",
        "other-network": "別のネットワークのアドレスが入力されています。",
        unrecognized: "入力されたアドレスは登録されていません。",
      };
      lines.push(labels[review.classification]);
    } catch { lines.push("入力されたアドレスの形式を確認してください。"); }
  }
  if (selected.testnet) lines.push("Base Sepoliaのテスト用ERC-20です。本番トークンやトレーニング用クレジットとは別です。");
  lines.push("この一覧表示だけでは、チェーン上の状態を確認したことにはなりません。");
  return lines.join("\n");
}

export function describeTokenObservation(input, provenance = "imported") {
  const row = validateTokenObservation(input);
  const assessment = assessTokenObservation(row);
  const lines = [
    provenance === "read" ? "今回読み取ったブロック時点の記録" : "ファイルから読み込んだ過去の記録",
    STATUS[assessment.status],
    row.agent + " / " + assessment.expected.networkLabel,
    "Wallet: " + row.account,
    "参照元: " + row.siteOrigin,
    "契約アドレス: " + row.tokenAddress,
    "参照ブロック: " + row.blockNumber,
    "ブロックハッシュ: " + row.blockHash,
    "ETH残高: " + assessment.nativeAmount + " ETH",
    "ETHの最小単位: " + row.nativeBalanceBaseUnits + " wei",
  ];
  if (assessment.tokenAmount !== null) {
    lines.push("トークン残高: " + assessment.tokenAmount + " " + assessment.expected.symbol);
  } else {
    lines.push("トークン単位の表示: 照合未完了のため表示しません");
  }
  lines.push("トークンの最小単位: " + (row.balanceBaseUnits ?? "不明"));
  for (const check of assessment.checks) {
    lines.push(FIELD[check.field] + ": " + (CHECK_STATUS[check.status] ?? check.status) +
      " / 観測 " + (check.observed ?? "不明") + " / 登録・上限 " + (check.expected ?? "不明"));
  }
  if (assessment.belowInitialSupply) {
    lines.push("供給量は初期発行量より少なく、上限以内です。減少理由や取引をこの照合だけでは特定できません。");
  }
  if (assessment.expected.testnet) lines.push("テストネットの記録です。本番の資産残高として扱わないでください。");
  lines.push("記録は現在の接続・所有権・安全性を証明しません。署名・送金・承認は行いません。");
  if (provenance !== "read") lines.push("ファイルの破損確認は、記録の作成者やチェーン上の真正性を証明しません。");
  return lines.join("\n");
}

export function describeTokenComparison(before, after) {
  const result = compareTokenObservations(before, after);
  return [
    "保存した基準記録との比較",
    "ブロック: " + result.earlierBlock + " → " + result.laterBlock,
    "トークン残高の差: " + (result.deltaAmount ?? "照合未完了のため比較不可"),
    "最小単位の差: " + (result.deltaBaseUnits ?? "不明"),
    "残高差は利益や送金履歴ではありません。",
  ].join("\n");
}

export function tokenIdentityErrorMessage(code) {
  const messages = {
    __proto__: null,
    IDENTITY_NOT_CONNECTED: "先にこのカードのWalletを接続してください。",
    IDENTITY_CONTRACT_MISMATCH: "選択したトークン・ネットワークの公式アドレスと一致しません。",
    IDENTITY_ADDRESS: "完全な公開アドレスを入力してください。",
    IDENTITY_SESSION_CHANGED: "読み取り中に接続が変わりました。改めて確認してください。",
    IDENTITY_CANCELLED: "照合をキャンセルしました。",
    IDENTITY_TIMEOUT: "応答待ちを終了しました。接続状態を確認してください。",
    IDENTITY_BLOCK_CHANGED: "参照ブロックが変わったため、結果を採用しませんでした。",
    IDENTITY_ABI_STRING: "トークン名・シンボルの応答形式を読み取れませんでした。",
    IDENTITY_ABI_WORD: "トークンの数値応答が正しくありません。",
    IDENTITY_METADATA_TEXT: "トークン名・シンボルの応答が表示条件を満たしません。",
    IDENTITY_CONTEXT: "DAT・EMA・CAWELONとBaseのネットワークを選択してください。",
    IDENTITY_CHECKSUM: "ファイルの破損確認が一致しません。元ファイルを確認してください。",
    IDENTITY_FILE_SIZE: "ファイルは空でない32KB以下のJSONを選択してください。",
    IDENTITY_FILE_ENCODING: "ファイルをUTF-8として読み取れませんでした。",
    IDENTITY_FILE_READ: "選択したファイルを読み取れませんでした。",
    IDENTITY_FILE_JSON: "JSONの形式が正しくありません。",
    IDENTITY_FILE_SCHEMA: "この照合記録のファイル形式に対応していません。",
    IDENTITY_FILENAME: "拡張子が.jsonの記録ファイルを選択してください。",
    IDENTITY_SCHEMA: "照合記録の形式・登録情報の版が一致しません。",
    IDENTITY_CRYPTO: "破損確認を利用できません。localhostまたはHTTPSで開いてください。",
    IDENTITY_STALE: "入力が変わりました。もう一度内容を確認してください。",
    IDENTITY_REVIEW_REQUIRED: "先に登録情報を表示して確認してください。",
    IDENTITY_NO_RESULT: "保存または比較する照合結果がありません。",
    IDENTITY_IMPORT_AGENT: "この記録は別のトークンのカード用です。",
    IDENTITY_COMPARISON_CONTEXT: "同じWallet・トークン・ネットワーク・参照元の記録を比較してください。",
    IDENTITY_COMPARISON_ORDER: "基準記録のブロックが新しすぎます。",
    IDENTITY_BLOCK_CONFLICT: "同じ高さのブロックハッシュが一致しません。",
    IDENTITY_OBSERVATION_CONFLICT: "同じブロックの観測内容が一致しません。",
    IDENTITY_DOWNLOAD: "ファイル保存を開始できませんでした。",
  };
  return messages[code] ?? "照合を完了できませんでした。接続と入力を確認してください。";
}
