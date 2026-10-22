import { ThreeCoreWalletSession } from "/src/wallet-session.js";
import { readTokenIdentity } from "/src/token-identity-reader.js";
import { catalogToken } from "/src/token-catalog.js";
import { describeIdentityCards } from "/src/identity-overview.js";
import { mountTokenIdentityPanel } from "/examples/token-identity-panel.js";

const agents = ["DAT", "EMA", "CAWELON"];
const states = new Map(agents.map(agent => [agent, {
  agent, phase: "idle", observation: null, provenance: null,
}]));
const disposers = [];
let requestCount = 0;
const word = value => "0x" + BigInt(value).toString(16).padStart(64, "0");
function abiString(value) {
  const bytes = new TextEncoder().encode(value);
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return word(32) + word(bytes.length).slice(2) + hex.padEnd(Math.ceil(bytes.length / 32) * 64, "0");
}
function renderSummary() {
  document.querySelector("#summary").textContent = describeIdentityCards([...states.values()]);
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function control(parent, caption, node) {
  const label = element("label", "", caption);
  label.append(node);
  parent.append(label);
}
for (const [index, agent] of agents.entries()) {
  const account = "0x" + String(index + 1).repeat(40);
  let selected = catalogToken({ agent, chainId: 8453 });
  let connected = false;
  let block = 42 + index;
  let balance = BigInt(index + 1) * 10n ** 18n + 123456789n;
  let session;
  let panel;
  const listeners = new Map();
  const section = element("section", "demo-card");
  section.dataset.agent = agent;
  section.append(element("h2", "", agent));
  section.append(element("pre", "demo-account", account));
  const chain = element("select", "demo-chain");
  for (const [value, label] of [[8453, "Base Mainnet（模擬）"], [84532, "Base Sepolia（模擬）"]]) {
    const option = element("option", "", label);
    option.value = String(value);
    chain.append(option);
  }
  control(section, "検証するネットワーク", chain);
  const scenario = element("select", "demo-scenario");
  for (const [value, label] of [["normal", "正常"], ["wrong-symbol", "シンボル不一致"],
    ["missing-code", "コードなし"], ["reorg", "ブロック変更"], ["unavailable", "読み取り失敗"]]) {
    const option = element("option", "", label);
    option.value = value;
    scenario.append(option);
  }
  control(section, "模擬応答", scenario);
  const address = element("input", "demo-token");
  address.value = selected.address;
  control(section, "トークンの契約アドレス", address);
  const connect = element("button", "demo-connect", "模擬接続");
  const disconnect = element("button", "demo-disconnect", "模擬切断");
  const next = element("button", "demo-next", "次の模擬ブロックへ（残高 +1最小単位）");
  const connection = element("p", "demo-connection", "未接続");
  section.append(connect, disconnect, next, connection);
  document.querySelector("#cards").append(section);

  // Entirely deterministic, in-process provider. No fetch or extension lookup.
  const provider = {
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
    },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
    async request(args) {
      requestCount++;
      document.querySelector("#rpc-count").textContent = "模擬RPC: " + requestCount;
      const method = args.method;
      if (method === "eth_chainId") return "0x" + selected.chainId.toString(16);
      if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [account];
      if (!connected) throw Error("Synthetic provider disconnected");
      if (scenario.value === "unavailable") throw Error("Synthetic read failure");
      const hash = "0x" + (scenario.value === "reorg" && args.params?.[0] !== "latest"
        && method === "eth_getBlockByNumber" ? "cd" : "ab").repeat(32);
      if (method === "eth_getBlockByNumber") return { number: "0x" + block.toString(16), hash };
      if (method === "eth_getCode") return scenario.value === "missing-code" ? "0x" : "0x6000";
      if (method === "eth_getBalance") return "0x" + (100000000000000000n + BigInt(index)).toString(16);
      if (method === "eth_call") {
        if (args.params[0].to !== selected.address) throw Error("Synthetic token mismatch");
        const selector = args.params[0].data;
        if (selector === "0x06fdde03") return abiString(selected.name);
        if (selector === "0x95d89b41") return abiString(scenario.value === "wrong-symbol" ? "OTHER" : selected.symbol);
        if (selector === "0x313ce567") return word(selected.decimals);
        if (selector === "0x18160ddd") return word(selected.initialSupply);
        if (selector.startsWith("0x70a08231")) return word(balance);
      }
      throw Error("Disallowed synthetic RPC");
    },
  };
  function disconnectSession() {
    connected = false;
    session?.disconnect();
    panel?.invalidate();
    connection.textContent = "未接続";
    connect.disabled = false;
  }
  function newSession() {
    return new ThreeCoreWalletSession({
      agent, chainId: selected.chainId, expectedAccount: account, provider,
      siteOrigin: location.origin, approvedOrigins: [location.origin],
    });
  }
  connect.addEventListener("click", async () => {
    connect.disabled = true;
    try {
      session?.disconnect();
      session = newSession();
      await session.connect();
      connected = true;
      connection.textContent = "模擬Wallet接続済み / " + account;
    } catch {
      disconnectSession();
      connection.textContent = "模擬接続を確認できませんでした。";
    }
  });
  disconnect.addEventListener("click", disconnectSession);
  chain.addEventListener("change", () => {
    disconnectSession();
    selected = catalogToken({ agent, chainId: Number(chain.value) });
    address.value = selected.address;
  });
  scenario.addEventListener("change", () => panel.invalidate());
  address.addEventListener("input", () => panel.invalidate());
  next.addEventListener("click", () => {
    block++;
    balance++;
    connection.textContent = (connected ? "模擬Wallet接続済み" : "未接続") + " / 次回参照ブロック: " + block;
  });
  panel = mountTokenIdentityPanel({
    document, parent: section,
    getContext: () => ({ agent, chainId: Number(chain.value), account, tokenAddress: address.value }),
    read: options => readTokenIdentity(session, options),
    applyAddress: value => { address.value = value; },
    onStateChange: state => {
      states.set(agent, { agent, phase: state.phase, observation: state.observation, provenance: state.provenance });
      renderSummary();
    },
  });
  disposers.push(() => { panel.dispose(); session?.disconnect(); });
}
renderSummary();
window.addEventListener("pagehide", () => disposers.forEach(dispose => dispose()), { once: true });
