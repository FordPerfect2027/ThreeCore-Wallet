import { mountWalletDemo } from "/examples/wallet-demo.js";
import { createCheckpointStorage } from "/src/checkpoint-storage.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";
import { encodeWorkspace, workspaceFromDraft } from "/src/workspace-format.js";

const agents = ["DAT", "EMA", "CAWELON"];
const token = "0x" + "44".repeat(20);
const draft = agents.map((agent, index) => {
  const account = "0x" + ["11", "22", "33"][index].repeat(20);
  const history = createPortfolioHistory();
  history.add({
    agent, account, chainId: 84532, siteOrigin: location.origin,
    connectionEpoch: 1, blockNumber: "42", blockHash: "0x" + "ab".repeat(32),
    nativeBalanceBaseUnits: String(16 + index),
    holdings: [{ address: token, hasCode: true, balanceBaseUnits: String(42 + index), notice: null }],
    readOnly: true, securityAudit: false,
  });
  return { agent, account, chainId: 84532, tokenAddress: token,
    tokens: token, history: history.exportText() };
});
const start = () => mountWalletDemo({
  document, eventTarget: new EventTarget(), siteOrigin: location.origin,
  getLegacyProvider: () => undefined,
  checkpointStorage: createCheckpointStorage({ indexedDB,
    name: "threecore-test-checkpoint-manual-v1" }),
});
let app = start();
document.querySelector("#prepare-synthetic").addEventListener("click", () => {
  const field = document.querySelector(".workspace-json");
  field.value = encodeWorkspace(workspaceFromDraft(draft));
  field.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector("#manual-status").textContent =
    "模擬データを入力しました。一括復元の変更内容を確認してから適用してください。まだ保存していません。";
});
window.addEventListener("pagehide", () => { app?.dispose(); app = null; });
window.addEventListener("pageshow", () => { if (!app) app = start(); });

