import test from "node:test";
import assert from "node:assert/strict";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const HASH = "0x" + "ab".repeat(32);
const SITE = "https://wallet.example";
function wallet() {
  const events = new Map();
  return { calls: [], chain: "0x2105", accounts: [A],
    async request(args) {
      this.calls.push(args);
      if (args.method === "eth_chainId") return this.chain;
      if (["eth_accounts", "eth_requestAccounts"].includes(args.method)) return [...this.accounts];
      // Reproduce a wallet transport which cannot accept EIP-1898 objects.
      throw new TypeError("c.slice is not a function");
    },
    on(name, fn) { const set = events.get(name) ?? new Set(); set.add(fn); events.set(name, set); },
    removeListener(name, fn) { events.get(name)?.delete(fn); },
    emit(name, value) { for (const fn of events.get(name) ?? []) fn(value); },
  };
}
function reader() {
  return { calls: [], chain: "0x2105", async request(args) {
    this.calls.push(args);
    if (args.method === "eth_chainId") return this.chain;
    if (args.method === "eth_getBlockByNumber") return { number: "0x100", hash: HASH };
    if (args.method === "eth_getBalance") return "0x2a";
    if (args.method === "eth_getCode") return "0x6000";
    if (args.method === "eth_call") return "0x" + "00".repeat(32);
    if (args.method === "eth_getLogs") return [];
    throw Error("Unexpected method");
  } };
}
function session(provider, stateProvider, extra = {}) {
  return new ThreeCoreWalletSession({ provider, stateProvider, agent: "DAT", expectedAccount: A,
    chainId: 8453, siteOrigin: SITE, approvedOrigins: [SITE], ...extra });
}

test("Base uses pinned state reads without sending block objects through MetaMask", async () => {
  const provider = wallet(), state = reader(), s = session(provider, state);
  try {
    await s.connect(); assert.equal(state.calls.length, 0);
    const block = await s.getBlockSnapshot();
    assert.equal(await s.getNativeBalance(block.hash), 42n);
    assert.deepEqual(state.calls.find(c => c.method === "eth_getBalance").params,
      [A, { blockHash: HASH, requireCanonical: true }]);
    assert.ok(provider.calls.every(c => ["eth_accounts", "eth_requestAccounts", "eth_chainId"].includes(c.method)));
    assert.ok(!state.calls.some(c => c.method.includes("Accounts") || c.method === "eth_accounts"));
  } finally { s.disconnect(); }
});

for (const agent of ["DAT", "EMA", "CAWELON"]) test(`${agent} complete controller balance read remains on one pinned block`, async () => {
  const provider = wallet(), state = reader();
  const controller = createWalletCardController({ agent, siteOrigin: SITE,
    createSession: options => new ThreeCoreWalletSession({ ...options, stateProvider: state }) });
  try {
    assert.equal(await controller.connect({ provider, account: A, chainId: 8453 }), true);
    assert.equal(await controller.readBalances(), true);
    assert.equal(controller.state.result.nativeBalanceBaseUnits, "42");
    assert.equal(controller.state.result.blockHash, HASH);
  } finally { controller.dispose(); }
});

test("unconnected, stopped or wrong-wallet-chain sessions never contact state RPC", async () => {
  const provider = wallet(), state = reader(), s = session(provider, state);
  await assert.rejects(s.getNativeBalance(HASH), { code: "NOT_CONNECTED" });
  provider.chain = "0x14a34";
  await assert.rejects(s.connect(), { code: "WRONG_CHAIN" });
  assert.equal(state.calls.length, 0);
  s.disconnect();
});

test("separate reader cannot be silently enabled for another chain", () => {
  assert.throws(() => session(wallet(), reader(), { chainId: 84532 }), { code: "UNSUPPORTED_STATE_PROVIDER" });
});

test("wrong state RPC chain stops before querying the account balance", async () => {
  const state = reader(), s = session(wallet(), state); state.chain = "0x1";
  await s.connect();
  await assert.rejects(s.getNativeBalance(HASH), { code: "STATE_RPC_WRONG_CHAIN" });
  assert.deepEqual(state.calls.map(c => c.method), ["eth_chainId"]);
  assert.equal(s.state.connected, false);
});

test("a state chain change after the response cannot publish a balance", async () => {
  const state = reader(), original = state.request;
  state.request = async function(args) {
    const value = await original.call(this, args);
    if (args.method === "eth_getBalance") this.chain = "0x1";
    return value;
  };
  const s = session(wallet(), state); await s.connect();
  await assert.rejects(s.getNativeBalance(HASH), { code: "STATE_RPC_WRONG_CHAIN" });
  assert.equal(s.state.connected, false);
});

test("malformed state chain invalidates the session without querying balances", async () => {
  const state = reader(), s = session(wallet(), state); state.chain = "not-a-chain";
  await s.connect();
  await assert.rejects(s.getNativeBalance(HASH), { code: "INVALID_CHAIN" });
  assert.equal(s.state.connected, false);
  assert.deepEqual(state.calls.map(c => c.method), ["eth_chainId"]);
});

for (const change of ["stop", "account", "chain"]) test(`pending state read is discarded after ${change}`, async () => {
  const provider = wallet(), state = reader(), original = state.request;
  const entered = Promise.withResolvers(), finish = Promise.withResolvers();
  state.request = async function(args) {
    if (args.method === "eth_getBalance") { entered.resolve(); return finish.promise; }
    return original.call(this, args);
  };
  const s = session(provider, state); await s.connect();
  const pending = s.getNativeBalance(HASH);
  const rejection = assert.rejects(pending, { code: "SESSION_CHANGED" });
  await entered.promise;
  if (change === "stop") s.disconnect();
  else if (change === "account") { provider.accounts = [B]; provider.emit("accountsChanged", [B]); }
  else { provider.chain = "0x1"; provider.emit("chainChanged", "0x1"); }
  const callsAtStop = state.calls.length;
  finish.resolve("0x2a"); await rejection;
  assert.equal(state.calls.length, callsAtStop);
  assert.equal(s.state.connected, false);
});

test("silent wallet authorization loss after a state response is rejected", async () => {
  const provider = wallet(), state = reader(), original = state.request;
  state.request = async function(args) {
    const value = await original.call(this, args);
    if (args.method === "eth_getBalance") provider.accounts = [];
    return value;
  };
  const s = session(provider, state); await s.connect();
  await assert.rejects(s.getNativeBalance(HASH), { code: "ACCOUNT_CHANGED" });
  assert.equal(s.state.connected, false);
});

test("state failure never retries via wallet or latest", async () => {
  const provider = wallet(), state = reader(), original = state.request;
  state.request = async function(args) {
    if (args.method === "eth_getBalance") throw Object.assign(Error("untrusted remote text"), { code: "STATE_RPC_UNAVAILABLE" });
    return original.call(this, args);
  };
  const s = session(provider, state); await s.connect();
  try {
    await assert.rejects(s.getNativeBalance(HASH), { code: "STATE_RPC_UNAVAILABLE" });
    assert.ok(provider.calls.every(c => ["eth_accounts", "eth_requestAccounts", "eth_chainId"].includes(c.method)));
  } finally { s.disconnect(); }
});
