import { createRpcSupervisor } from "/src/rpc-supervisor.js";
import { createWalletCardController } from "/src/wallet-card-controller.js";
import { ThreeCoreWalletSession } from "/src/wallet-session.js";
import { mountRpcStatusPanel } from "/examples/rpc-status-panel.js";
import { mountSecurityPanel } from "/examples/security-panel.js";

const supervisor = createRpcSupervisor({ perProvider: 2, perPage: 6 });
const rows = [];
const trace = { issued: 0, forbidden: 0, deferred: 0, returned: 0, rejected: 0, events: 0 };
function traceView() {
  const state = supervisor.state();
  document.querySelector("#evidence").textContent = [
    "模擬Walletへの要求: " + trace.issued,
    "保留中の応答: " + trace.deferred,
    "返した応答: " + trace.returned + " / エラーとして返した応答: " + trace.rejected,
    "通知を発生させた回数: " + trace.events,
    "署名・送金・承認要求: " + trace.forbidden,
    "現在の未完了: " + state.pending + " / 待機終了後も未完了: " + state.abandoned,
    "時間切れ: " + state.timedOut + " / 受付拒否: " + state.denied + " / 遅い結果の破棄: " + state.late,
  ].join("\n");
}
supervisor.subscribe(traceView);
const protection = mountSecurityPanel({ document, parent: document.querySelector("#protection"),
  eventTarget: window,
  canResume: () => supervisor.state().canStart === true,
  onLock() {
    for (const row of rows) row.controller.disconnect("保護のため接続を停止しました。");
    return true;
  },
  onChange() { for (const row of rows) render(row, row.controller.state); },
});
mountRpcStatusPanel({ document, parent: document.querySelector("#monitor"), supervisor,
  onFault: () => protection.lock("clock") });
function render(row, state) {
  const connected = state.connection?.connected === true;
  row.connect.disabled = !protection.state().canRead || state.phase === "connecting";
  row.read.disabled = !connected || state.phase === "reading";
  row.stop.disabled = !connected && state.phase !== "connecting" && state.phase !== "reading";
  row.output.textContent = row.agent + " / " + (connected ? "接続済み" : "未接続") +
    (state.phase === "connecting" ? "\n接続応答の待機中" : "") +
    (state.phase === "reading" ? "\n残高応答の待機中" : "") +
    (state.result ? "\n架空の残高: " + state.result.nativeBalanceBaseUnits + " wei" : "") +
    (state.error ? "\n" + state.error : "");
}
function button(parent, text, action, secondary = false) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  if (secondary) element.className = "secondary";
  element.addEventListener("click", action);
  parent.append(element);
  return element;
}
for (const [index, agent] of ["DAT", "EMA", "CAWELON"].entries()) {
  const account = "0x" + String(index + 1).repeat(40);
  const listeners = new Map(), pending = [];
  const card = document.createElement("section");
  card.className = "card"; card.dataset.agent = agent;
  card.setAttribute("aria-label", agent + "模擬Wallet");
  const title = document.createElement("h2"); title.textContent = agent;
  const output = document.createElement("output"); output.setAttribute("aria-live", "polite");
  const label = document.createElement("label"); label.textContent = agent + "の模擬応答";
  const mode = document.createElement("select");
  for (const [value, text] of [["normal", "通常の応答"], ["balance", "残高の応答を保留"], ["all", "全要求の応答を保留"]]) {
    const option = document.createElement("option"); option.value = value; option.textContent = text; mode.append(option);
  }
  label.append(mode); card.append(title, output, label);
  function answer(method) {
    if (method === "eth_chainId") return "0x14a34";
    if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [account];
    if (method === "eth_getBalance") return "0x" + ((index + 1) * 100).toString(16);
    if (method === "eth_getBlockByNumber") return { number: "0x2a", hash: "0x" + "ab".repeat(32) };
    trace.forbidden++; traceView();
    throw Error("Unsupported synthetic request");
  }
  const provider = {
    async request({ method }) {
      trace.issued++;
      const value = answer(method);
      if (mode.value === "all" || (mode.value === "balance" && method === "eth_getBalance")) {
        trace.deferred++;
        traceView();
        return new Promise((resolve, reject) => pending.push({ resolve, reject, value }));
      }
      traceView();
      return value;
    },
    on(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    },
    removeListener(name, callback) { listeners.get(name)?.delete(callback); },
  };
  const row = { agent, output, controller: null, connect: null, read: null, stop: null };
  row.connect = button(card, agent + "を模擬接続", () => row.controller.connect({ provider, account, chainId: 84532 }));
  row.read = button(card, agent + "の残高確認", () => row.controller.readBalances());
  row.stop = button(card, agent + "のこのカードを停止", () => row.controller.disconnect("このカードを停止しました。"), true);
  function settle(error = false) {
    const queued = pending.splice(0);
    trace.deferred -= queued.length;
    for (const operation of queued) {
      if (error) { trace.rejected++; operation.reject(Object.assign(Error("synthetic private detail"), { code: 4900 })); }
      else { trace.returned++; operation.resolve(operation.value); }
    }
    traceView();
  }
  button(card, agent + "の保留した応答を返す", () => settle(), true);
  button(card, agent + "の保留をエラーで返す", () => settle(true), true);
  button(card, agent + "の通知過多を模擬確認", () => {
    for (let i = 0; i < 257; i++) {
      trace.events++;
      for (const callback of [...listeners.get("accountsChanged") ?? []]) callback([account]);
    }
    traceView();
  }, true);
  row.controller = createWalletCardController({ agent, siteOrigin: location.origin,
    rpcSupervisor: supervisor, isAccessAllowed: protection.check,
    createSession: options => new ThreeCoreWalletSession({ ...options,
      readTimeoutMs: 15_000, connectTimeoutMs: 15_000, permissionTimeoutMs: 15_000 }),
    onChange: state => render(row, state) });
  rows.push(row);
  document.querySelector("#cards").append(card);
  render(row, row.controller.state);
}
traceView();
