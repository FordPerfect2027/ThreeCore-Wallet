import { identityObject, identityFail } from "./token-identity-codec.js";
import { validateTokenObservation, assessTokenObservation } from "./token-identity-model.js";

const AGENTS = ["DAT", "EMA", "CAWELON"];
const PHASES = ["idle", "reading", "loading", "preparing", "ready", "error", "cancelled", "disposed"];

/** Aggregates verification status, never sums unrelated token amounts. */
export function summarizeIdentityCards(input) {
  if (!Array.isArray(input) || input.length !== 3 || Reflect.ownKeys(input).length !== 4) {
    identityFail("IDENTITY_OVERVIEW_SHAPE");
  }
  const rows = [];
  for (let index = 0; index < 3; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor)) identityFail("IDENTITY_OVERVIEW_SHAPE");
    const row = descriptor.value;
    identityObject(row, ["agent", "phase", "provenance", "observation"]);
    if (!AGENTS.includes(row.agent) || !PHASES.includes(row.phase) ||
        ![null, "read", "imported"].includes(row.provenance)) identityFail("IDENTITY_OVERVIEW_SHAPE");
    if (row.observation === null && row.provenance !== null) identityFail("IDENTITY_OVERVIEW_SHAPE");
    const observation = row.observation === null ? null : validateTokenObservation(row.observation);
    if (observation && (observation.agent !== row.agent || row.provenance === null)) {
      identityFail("IDENTITY_OVERVIEW_SHAPE");
    }
    if (observation && !["ready", "preparing"].includes(row.phase)) identityFail("IDENTITY_OVERVIEW_SHAPE");
    rows.push({ ...row, observation });
  }
  if (new Set(rows.map(row => row.agent)).size !== 3) identityFail("IDENTITY_OVERVIEW_SHAPE");
  const cards = AGENTS.map(agent => {
    const row = rows.find(item => item.agent === agent);
    const result = row.observation ? assessTokenObservation(row.observation) : null;
    return Object.freeze({
      agent,
      phase: row.phase,
      provenance: row.provenance,
      status: result?.status ?? "unavailable",
      account: row.observation?.account ?? null,
      chainId: row.observation?.chainId ?? null,
      siteOrigin: row.observation?.siteOrigin ?? null,
      blockNumber: row.observation?.blockNumber ?? null,
      amount: result?.tokenAmount ?? null,
      testnet: result?.expected.testnet ?? null,
    });
  });
  const observed = cards.filter(row => row.account !== null);
  const matching = observed.filter(row => row.status === "matched");
  const accounts = new Set(observed.map(row => row.account));
  const duplicateAccounts = [...accounts].filter(account => observed.filter(row => row.account === account).length > 1);
  return Object.freeze({
    schema: "threecore-identity-overview-v1",
    cards: Object.freeze(cards),
    observedCards: observed.length,
    matchedCards: matching.length,
    readCards: observed.filter(row => row.provenance === "read").length,
    importedCards: observed.filter(row => row.provenance === "imported").length,
    distinctObservedAccounts: accounts.size,
    duplicateAccounts: Object.freeze(duplicateAccounts),
    mixedNetworks: new Set(observed.map(row => row.chainId)).size > 1,
    mixedOrigins: new Set(observed.map(row => row.siteOrigin)).size > 1,
    simultaneousSnapshot: false,
    securityAudit: false,
    provesCurrentConnection: false,
    monetaryTotal: null,
  });
}

export function describeIdentityCards(input) {
  const result = summarizeIdentityCards(input);
  const lines = [
    "3トークンの照合状況",
    "公式情報と一致: " + result.matchedCards + " / 3",
    "今回の読取り: " + result.readCards + " / 保存ファイル: " + result.importedCards,
    "記録に含まれる異なるWalletアドレス: " + result.distinctObservedAccounts,
    "",
  ];
  for (const card of result.cards) {
    const pending = ["reading", "loading", "preparing"].includes(card.phase);
    const status = pending ? "処理中" : card.status === "matched" ? "登録情報と一致" :
      card.status === "missing-code" ? "契約コードなし" : card.status === "mismatch" ? "不一致あり" : "未照合";
    lines.push(card.agent + ": " + status);
    if (card.account) {
      lines.push("  " + card.account,
        "  " + (card.testnet ? "Base Sepolia（テスト）" : "Base Mainnet") + " / block " + card.blockNumber,
        "  " + (card.provenance === "read" ? "今回読み取った記録" : "保存ファイルの記録"),
        "  残高: " + (card.amount === null ? "照合未完了" : card.amount + " " + card.agent));
    }
  }
  if (result.duplicateAccounts.length) lines.push("同じWalletアドレスを含む記録があります。3つの独立したWalletの確認とは扱いません。");
  if (result.mixedNetworks) lines.push("本番とテストネットの記録が混在しています。");
  if (result.mixedOrigins) lines.push("参照元が異なる記録を含みます。");
  lines.push("各記録のブロックは別です。同時点の一括残高や、現在の接続を証明する表示ではありません。");
  return lines.join("\n");
}
