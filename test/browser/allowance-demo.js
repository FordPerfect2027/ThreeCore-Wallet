import { ThreeCoreWalletSession } from "/src/wallet-session.js";
import { catalogToken } from "/src/token-catalog.js";
import { readAllowanceSnapshot } from "/src/allowance-reader.js";
import { describeAllowanceOverview } from "/src/allowance-overview.js";
import { mountAllowancePanel } from "/examples/allowance-panel.js";
import { mountAllowanceBundlePanel } from "/examples/allowance-bundle-panel.js";

const agents = ["DAT", "EMA", "CAWELON"];
const states = new Map(agents.map(agent => [agent, { agent, observation: null, provenance: null }]));
const S1 = "0x" + "55".repeat(20), S2 = "0x" + "66".repeat(20);
const word = value => "0x" + BigInt(value).toString(16).padStart(64, "0");
const max = 2n ** 256n - 1n;
let rpcCount = 0;
const disposers = [];
function textWord(value) {
  const bytes = new TextEncoder().encode(value);
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return word(32) + word(bytes.length).slice(2) + hex.padEnd(Math.ceil(bytes.length / 32) * 64, "0");
}
function node(tag, className, text) {
  const result = document.createElement(tag);
  result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
function renderSummary() {
  document.querySelector("#summary").textContent = describeAllowanceOverview([...states.values()]);
}
for (const [index, agent] of agents.entries()) {
  const account = "0x" + String(index + 1).repeat(40);
  const token = catalogToken({ agent, chainId: 8453 });
  let connected = false;
  let block = 42 + index;
  let amount = [10n, max, 1000000000000000000n][index];
  let panel;
  const section = node("section", "demo-card");
  section.dataset.agent = agent;
  section.append(node("h2", "", agent), node("pre", "demo-account", account));
  const connect = node("button", "demo-connect", "模擬Walletを接続");
  const disconnect = node("button", "demo-disconnect", "模擬Walletを切断");
  const next = node("button", "demo-next", "次の模擬ブロックへ");
  const connection = node("p", "demo-connection", "未接続");
  const scenarioLabel = node("label", "", "模擬応答");
  const scenario = node("select", "demo-scenario");
  for (const [value, title] of [
    ["normal", "正常"], ["partial", "片方の承認額が取得できない"],
    ["no-code", "相手にコードなし"], ["reorg", "読取り中にブロック変更"],
  ]) {
    const option = node("option", "", title);
    option.value = value;
    scenario.append(option);
  }
  scenarioLabel.append(scenario);
  section.append(connect, disconnect, next, connection, scenarioLabel);
  document.querySelector("#cards").append(section);
  const listeners = new Map();
  let blockCalls = 0;
  const provider = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
    },
    removeListener(event, handler) { listeners.get(event)?.delete(handler); },
    async request(args) {
      rpcCount++;
      document.querySelector("#rpc-count").textContent = "模擬RPC: " + rpcCount;
      if (args.method === "eth_chainId") return "0x2105";
      if (["eth_accounts", "eth_requestAccounts"].includes(args.method)) return [account];
      if (!connected) throw Error("Synthetic wallet disconnected");
      if (args.method === "eth_getBlockByNumber") {
        blockCalls++;
        return { number: "0x" + block.toString(16),
          hash: "0x" + (scenario.value === "reorg" && blockCalls % 3 === 0 ? "cd" : "ab").repeat(32) };
      }
      if (args.method === "eth_getCode") {
        return scenario.value === "no-code" && args.params[0] === S2 ? "0x" : "0x6000";
      }
      if (args.method === "eth_getBalance") return "0x16345785d8a0000";
      if (args.method !== "eth_call") throw Error("Forbidden synthetic method");
      if (args.params[0].to !== token.address) throw Error("Unexpected token");
      const data = args.params[0].data;
      if (data === "0x06fdde03") return textWord(token.name);
      if (data === "0x95d89b41") return textWord(token.symbol);
      if (data === "0x313ce567") return word(token.decimals);
      if (data === "0x18160ddd") return word(token.initialSupply);
      if (data.startsWith("0x70a08231")) return word(BigInt(index + 1) * 10n ** 18n);
      if (data.startsWith("0xdd62ed3e")) {
        const spender = "0x" + data.slice(-40);
        if (![S1, S2].includes(spender)) throw Error("Unexpected synthetic spender");
        if (scenario.value === "partial" && spender === S2) throw Error("Synthetic allowance failure");
        return word(spender === S1 ? 0n : amount);
      }
      throw Error("Forbidden synthetic selector");
    },
  };
  const session = new ThreeCoreWalletSession({
    provider, agent, chainId: 8453, expectedAccount: account,
    siteOrigin: location.origin, approvedOrigins: [location.origin],
  });
  panel = mountAllowancePanel({
    document, parent: section,
    getContext: () => ({ agent, chainId: 8453, account, tokenAddress: token.address }),
    read: (plan, options) => { blockCalls = 0; return readAllowanceSnapshot(session, plan, options); },
    onStateChange(state) {
      states.set(agent, { agent, observation: state.observation, provenance: state.provenance });
      renderSummary();
    },
  });
  section.querySelector(".allowance-draft").value = S1 + " | Mock exchange A\n" + S2 + " | Mock exchange B";
  connect.addEventListener("click", async () => {
    connected = true;
    try { await session.connect(); connection.textContent = "模擬接続済み / " + agent; }
    catch { connected = false; connection.textContent = "模擬接続できませんでした。"; }
  });
  disconnect.addEventListener("click", () => {
    connected = false;
    session.disconnect();
    panel.invalidate();
    connection.textContent = "未接続";
  });
  next.addEventListener("click", () => {
    block++;
    amount = amount === max ? max - 1n : amount + 1n;
    connection.textContent = (connected ? "模擬接続済み" : "未接続") + " / 次のblock " + block + " を再読取りしてください。";
  });
  scenario.addEventListener("change", () => panel.invalidate());
  disposers.push(() => { panel.dispose(); session.disconnect(); });
}
renderSummary();
const bundlePanel = mountAllowanceBundlePanel({
  document, parent: document.querySelector("#bundle"),
  readRecords: () => agents.map(agent => states.get(agent).observation),
});
disposers.push(() => bundlePanel.dispose());
window.addEventListener("pagehide", () => disposers.forEach(dispose => dispose()), { once: true });
