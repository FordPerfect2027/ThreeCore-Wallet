import { mountSecurityPanel } from "/examples/security-panel.js";
import { createWalletCardController } from "/src/wallet-card-controller.js";

const rows = [], controllers = [], calls = [];
const guard = mountSecurityPanel({ document, parent: document.querySelector("#protection"), eventTarget: window,
  onLock() { for (const controller of controllers) controller.disconnect("保護のため接続を停止しました。"); },
  onChange() { for (const row of rows) render(row, row.controller.state); },
});

function render(row, state) {
  const connected = state.connection?.connected === true;
  row.connect.disabled = !guard.state().canRead || state.phase === "connecting";
  row.read.disabled = !connected || state.phase === "reading";
  row.output.textContent = row.agent + " / " + (connected ? "模擬Walletに接続済み" : "未接続") +
    (state.result ? "\n確認用の残高: " + state.result.nativeBalanceBaseUnits + " wei\n架空の数値です" : "") +
    (state.error ? "\n" + state.error : "");
}

for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) {
  const account = "0x" + String(index + 1).repeat(40), listeners = new Map();
  const provider = {
    async request(args) {
      calls.push({ agent, method: args.method });
      document.querySelector("#calls").textContent = "模擬Walletへの要求: " + calls.length +
        "件 / 最後の要求: " + agent + " " + args.method + " / 署名・送金: 0件";
      if (args.method === "eth_chainId") return "0x14a34";
      if (["eth_accounts", "eth_requestAccounts"].includes(args.method)) return [account];
      if (args.method === "eth_getBlockByNumber") return { number: "0x2a", hash: "0x" + "ab".repeat(32) };
      if (args.method === "eth_getBalance") return "0x" + ((index + 1) * 100).toString(16);
      throw Error("Unsupported synthetic read");
    },
    on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(listener); },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
  };
  const card = document.createElement("section"); card.className = "card";
  card.setAttribute("aria-label", agent + "確認用Wallet");
  const heading = document.createElement("h2"); heading.textContent = agent;
  const output = document.createElement("output");
  const connect = document.createElement("button"); connect.textContent = agent + "を模擬接続";
  const read = document.createElement("button"); read.textContent = agent + "の残高を確認";
  const row = { agent, card, output, connect, read, controller: null };
  row.controller = createWalletCardController({ agent, siteOrigin: location.origin,
    isAccessAllowed: guard.check, onChange: state => render(row, state) });
  connect.addEventListener("click", () => row.controller.connect({ provider, account, chainId: 84532 }));
  read.addEventListener("click", () => row.controller.readBalances());
  card.append(heading, output, connect, read); document.querySelector("#cards").append(card);
  rows.push(row); controllers.push(row.controller); render(row, row.controller.state);
}
