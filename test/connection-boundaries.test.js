import test from "node:test";
import assert from "node:assert/strict";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const WORD = "0x" + "2a".padStart(64, "0");

function fixture(agent = "DAT") {
  const listeners = new Map();
  const calls = [];
  const provider = {
    accounts: [ACCOUNT],
    chain: "0x2105",
    result: WORD,
    async request({ method }) {
      calls.push(method);
      if (method === "eth_chainId") return this.chain;
      if (["eth_accounts", "eth_requestAccounts"].includes(method)) return [...this.accounts];
      if (method === "eth_call") return this.result;
      if (method === "eth_getBalance") return "0x2a";
      throw new Error("Unexpected method: " + method);
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
    },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
  };
  const wallet = new ThreeCoreWalletSession({
    provider, agent, expectedAccount: ACCOUNT, chainId: 8453,
    siteOrigin: "https://dex.example", approvedOrigins: ["https://dex.example"],
  });
  return { wallet, provider, listeners, calls };
}

function deferNext(provider, method) {
  const request = provider.request.bind(provider);
  let started, resolve;
  const start = new Promise(r => { started = r; });
  const gate = new Promise(r => { resolve = r; });
  let held = false;
  provider.request = async args => {
    if (args.method === method && !held) {
      held = true;
      started();
      return gate;
    }
    return request(args);
  };
  return { start, resolve };
}

const code = expected => error => error.code === expected;

for (const [event, payload] of [
  ["disconnect", { code: 4900 }],
  ["accountsChanged", [OTHER]],
  ["accountsChanged", []],
  ["chainChanged", "0x1"],
]) {
  test("pending permission is invalidated by " + event + " " + JSON.stringify(payload), async () => {
    const { wallet, provider, listeners } = fixture();
    const gate = deferNext(provider, "eth_requestAccounts");
    const pending = wallet.connect();
    await gate.start;
    provider.emit(event, payload);
    gate.resolve([ACCOUNT]);
    await assert.rejects(pending, code("SESSION_CANCELLED"));
    assert.equal(wallet.state.connected, false);
    assert.ok([...listeners.values()].every(set => set.size === 0));
  });
}

test("connection rechecks the exposed account after the permission response", async () => {
  const { wallet, provider } = fixture();
  const request = provider.request.bind(provider);
  let chainReads = 0;
  provider.request = async args => {
    if (args.method === "eth_chainId" && ++chainReads === 2) {
      provider.accounts = [OTHER]; // No event: the preflight must still detect this.
    }
    return request(args);
  };
  await assert.rejects(wallet.connect(), code("WRONG_ACCOUNT"));
  assert.equal(wallet.state.connected, false);
});

test("partial event registration failure leaves no connected session or live listeners", async () => {
  const { wallet, provider, listeners } = fixture();
  const on = provider.on.bind(provider);
  provider.on = (event, listener) => {
    if (event === "chainChanged") throw Error("Listener registration failed");
    on(event, listener);
  };
  await assert.rejects(wallet.connect(), /registration failed/);
  assert.equal(wallet.state.connected, false);
  assert.ok([...listeners.values()].every(set => set.size === 0));
});

test("a provider cleanup exception cannot retain local authorization", async () => {
  const { wallet, provider } = fixture();
  await wallet.connect();
  provider.removeListener = () => { throw Error("Extension cleanup failed"); };
  assert.doesNotThrow(() => wallet.disconnect());
  assert.equal(wallet.state.connected, false);
  await assert.rejects(wallet.getNativeBalance(), code("NOT_CONNECTED"));
});

test("a stale wrong-chain response cannot disconnect a newer explicit connection", async () => {
  const { wallet, provider } = fixture();
  await wallet.connect();
  const gate = deferNext(provider, "eth_chainId");
  const stale = wallet.getNativeBalance();
  await gate.start;
  wallet.disconnect();
  await wallet.connect();
  gate.resolve("0x1");
  await assert.rejects(stale, code("SESSION_CHANGED"));
  assert.equal(wallet.state.connected, true);
  assert.equal(await wallet.getNativeBalance(), 42n);
});

test("old listeners cannot invalidate a reconnected session when provider cleanup fails", async () => {
  const { wallet, provider, listeners } = fixture();
  await wallet.connect();
  const staleListeners = [...listeners.get("disconnect")];
  provider.removeListener = () => {};
  wallet.disconnect();
  await wallet.connect();
  for (const listener of staleListeners) listener({ code: 4900 });
  assert.equal(wallet.state.connected, true);
});

test("malformed account preflight revokes the connected state", async () => {
  const { wallet, provider } = fixture();
  await wallet.connect();
  provider.accounts = ["malformed"];
  await assert.rejects(wallet.getNativeBalance());
  assert.equal(wallet.state.connected, false);
});

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test(agent + " only accepts complete single-word ERC-20 return data", async () => {
    const { wallet, provider, calls } = fixture(agent);
    await wallet.connect();
    for (const malformed of [
      "0x", "0x0", "0x2a", "0x" + "00".repeat(31),
      "0x" + "00".repeat(33), WORD + WORD.slice(2), "0x" + "g".repeat(64),
    ]) {
      provider.result = malformed;
      await assert.rejects(wallet.getTokenBalance(TOKEN), code("INVALID_RPC_RESULT"));
      await assert.rejects(wallet.getTokenAllowance(TOKEN, OTHER), code("INVALID_RPC_RESULT"));
    }
    provider.result = "0x" + "0".repeat(64);
    assert.equal(await wallet.getTokenBalance(TOKEN), 0n);
    provider.result = WORD;
    assert.equal(await wallet.getTokenAllowance(TOKEN, OTHER), 42n);
    assert.equal(await wallet.getNativeBalance(), 42n);
    assert.ok(calls.every(method => ["eth_chainId", "eth_accounts", "eth_requestAccounts",
      "eth_call", "eth_getBalance"].includes(method)));
  });
}
