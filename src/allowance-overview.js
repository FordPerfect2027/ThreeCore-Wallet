import { allowanceObject, allowanceFail } from "./allowance-targets.js";
import { validateAllowanceObservation, summarizeAllowances } from "./allowance-observation.js";

const agents = ["DAT", "EMA", "CAWELON"];
export function allowanceOverview(input) {
  if (!Array.isArray(input) || input.length !== 3 || Reflect.ownKeys(input).length !== 4) allowanceFail("ALLOWANCE_OVERVIEW");
  const seen = new Set();
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor)) allowanceFail("ALLOWANCE_OVERVIEW");
  }
  const cards = input.map(value => {
    allowanceObject(value, ["agent", "observation", "provenance"]);
    if (!agents.includes(value.agent) || seen.has(value.agent) ||
        ![null, "read", "imported"].includes(value.provenance)) allowanceFail("ALLOWANCE_OVERVIEW");
    seen.add(value.agent);
    if ((value.observation === null) !== (value.provenance === null)) allowanceFail("ALLOWANCE_OVERVIEW");
    if (value.observation === null) return Object.freeze({ agent: value.agent, summary: null, identity: null, provenance: null });
    const record = validateAllowanceObservation(value.observation);
    if (record.identity.agent !== value.agent) allowanceFail("ALLOWANCE_OVERVIEW");
    return Object.freeze({ agent: value.agent, summary: summarizeAllowances(record), identity: record.identity, provenance: value.provenance });
  });
  cards.sort((a, b) => agents.indexOf(a.agent) - agents.indexOf(b.agent));
  return Object.freeze({ cards: Object.freeze(cards), completeDiscovery: false,
    totalExposure: null, independentWallets: new Set(cards.filter(card => card.identity).map(card => card.identity.account)).size });
}
export function describeAllowanceOverview(input) {
  const overview = allowanceOverview(input);
  const lines = ["指定した承認先の確認状況"];
  for (const card of overview.cards) {
    lines.push("");
    if (!card.summary) { lines.push(card.agent + ": 未確認"); continue; }
    const s = card.summary, id = card.identity;
    lines.push(card.agent + ": 指定 " + s.requested + "件 / 承認額あり " + s.positiveAmounts +
      "件 / ゼロ " + s.zeroAmounts + "件 / 未確認 " + s.unknownAmounts + "件",
      id.account, (id.chainId === 84532 ? "Base Sepolia（テスト）" : "Base Mainnet") + " / block " + id.blockNumber,
      card.provenance === "read" ? "今回の読取り記録" : "保存ファイルの過去記録");
  }
  lines.push("", "記録内の異なるWalletアドレス: " + overview.independentWallets,
    "対象外の承認先は調査していません。承認額の合計を資産総額として表示しません。");
  return lines.join("\n");
}
