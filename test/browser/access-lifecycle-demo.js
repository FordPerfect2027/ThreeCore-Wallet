import { mountSecurityPanel } from "/examples/security-panel.js";
import { createWalletCardController } from "/src/wallet-card-controller.js";

const cards = [], releases = [];
let timerBroken = false;
const panel = mountSecurityPanel({ document, parent: document.querySelector("#protection"), eventTarget: window,
  lockOptions: { schedule(fn, delay) {
    if (timerBroken) throw Error("Synthetic timer failure");
    return setTimeout(fn, delay);
  } },
  onLock() {
    for (const item of cards) item.controller.disconnect();
    document.querySelector("#result").textContent = "3トークンの読み取りを停止しました。遅い応答で結果は戻りません。";
    return true;
  },
});
const labels = { connecting: "接続を確認中", connected: "接続済み", disconnected: "未接続", reading: "応答を待っています", disposed: "終了" };
for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) {
  const article = document.createElement("article");
  article.className = "token-card";
  const heading = document.createElement("h3"); heading.textContent = agent;
  const status = document.createElement("p"), count = document.createElement("p"), saved = document.createElement("p");
  article.append(heading, status, count, saved);
  document.querySelector("#cards").append(article);
  const account = "0x" + String(index + 1).repeat(40);
  let connected = false, epoch = 0, requests = 0;
  const session = {
    get state() { return { agent, connected, account: connected ? account : null, chainId: 8453,
      siteOrigin: location.origin, connectionEpoch: epoch, canSign: false, canSendTransactions: false, canBridge: false }; },
    connect() { connected = true; }, disconnect() { connected = false; epoch++; },
    async getBlockSnapshot() {
      requests++; count.textContent = "開始した読み取り: " + requests;
      await new Promise(resolve => releases.push(resolve));
      return { number: "0x2a", hash: "0x" + "ab".repeat(32) };
    },
    async getNativeBalance() { requests++; count.textContent = "開始した読み取り: " + requests; return 10n; },
  };
  const controller = createWalletCardController({ agent, siteOrigin: location.origin,
    isAccessAllowed: panel.check, createSession: () => session,
    onChange(state) {
      status.textContent = labels[state.phase];
      saved.textContent = state.result ? "結果が表示されています" : "表示する残高: なし";
    } });
  const provider = { request() { throw Error("No real provider in this preview"); } };
  cards.push({ controller, provider, account });
  status.textContent = "未接続"; count.textContent = "開始した読み取り: 0"; saved.textContent = "表示する残高: なし";
}
document.querySelector("#connect").addEventListener("click", async () => {
  const results = await Promise.all(cards.map(row => row.controller.connect({ provider: row.provider, account: row.account, chainId: 8453 })));
  document.querySelector("#result").textContent = results.every(Boolean)
    ? "テスト用の3トークンが接続できました。" : "現在は接続を停止しています。";
});
document.querySelector("#read").addEventListener("click", () => {
  for (const row of cards) row.controller.readBalances().catch(() => {});
  document.querySelector("#result").textContent = "応答待ちです。上の「3トークンの接続を停止」を押して中止できます。";
});
document.querySelector("#late").addEventListener("click", async () => {
  for (const resolve of releases.splice(0)) resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  document.querySelector("#result").textContent = cards.every(row => row.controller.state.result === null)
    ? "遅い応答を返した後も、3トークンの残高表示は復活していません。" : "読み取り結果を確認してください。";
});
document.querySelector("#fault").addEventListener("click", () => {
  if (!panel.check()) {
    document.querySelector("#result").textContent = "保護パネルで接続操作を再開してから、異常時の停止を確認できます。";
    return;
  }
  timerBroken = true;
  const select = document.querySelector(".security-idle");
  select.value = "60000";
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
window.addEventListener("pagehide", () => {
  for (const row of cards) row.controller.dispose();
  panel.dispose();
  for (const resolve of releases.splice(0)) resolve();
}, { once: true });
