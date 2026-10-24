import test from "node:test";
import assert from "node:assert/strict";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";

const ACCOUNT = "0x" + "11".repeat(20);
const TOKEN = "0x" + "22".repeat(20);
const SPENDER = "0x" + "33".repeat(20);
const BLOCK = { number: "0x2a", hash: "0x" + "ab".repeat(32) };
const terminalCodes = [4100, 4900, 4901];
const fault = code => Object.assign(new Error("Synthetic provider failure"), { code, data: { fixture: true } });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const calls = [], listeners = new Map();
  let override = () => undefined;
  const provider = {
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
    },
    removeListener(event, listener) { listeners.get(event)?.delete(listener); },
    request(args) {
      calls.push(args);
      const value = override(args);
      if (value !== undefined) return Promise.resolve(value);
      switch (args.method) {
        case "eth_chainId": return Promise.resolve("0x2105");
        case "eth_accounts":
        case "eth_requestAccounts": return Promise.resolve([ACCOUNT]);
        case "eth_getBlockByNumber": return Promise.resolve({ ...BLOCK });
        case "eth_getBalance": return Promise.resolve("0x2a");
        case "eth_getCode": return Promise.resolve("0x6000");
        case "eth_call": return Promise.resolve("0x" + "2a".padStart(64, "0"));
        default: throw Error("Forbidden fixture RPC: " + args.method);
      }
    },
  };
  const wallet = new ThreeCoreWalletSession({
    provider, agent: "DAT", siteOrigin: "https://dex.example",
    approvedOrigins: ["https://dex.example"], expectedAccount: ACCOUNT, chainId: 8453,
  });
  return { wallet, calls, listeners, setOverride: fn => { override = fn; } };
}

const reads = [
  ["chain precheck", "eth_chainId", wallet => wallet.getNativeBalance(BLOCK.hash)],
  ["account precheck", "eth_accounts", wallet => wallet.getNativeBalance(BLOCK.hash)],
  ["header", "eth_getBlockByNumber", wallet => wallet.getBlockSnapshot()],
  ["native balance", "eth_getBalance", wallet => wallet.getNativeBalance(BLOCK.hash)],
  ["token balance", "eth_call", wallet => wallet.getTokenBalance(TOKEN, BLOCK.hash)],
  ["allowance", "eth_call", wallet => wallet.getTokenAllowance(TOKEN, SPENDER, BLOCK.hash)],
  ["code", "eth_getCode", wallet => wallet.getContractCode(TOKEN, BLOCK.hash)],
];
for (const code of terminalCodes) {
  for (const [label, method, read] of reads) {
    test(`${code} during ${label} disables reads without waiting for an event`, async () => {
      const f = fixture();
      await f.wallet.connect();
      const epoch = f.wallet.state.connectionEpoch;
      const error = fault(code);
      f.setOverride(args => args.method === method ? Promise.reject(error) : undefined);
      await assert.rejects(read(f.wallet), actual => actual.code === code && actual !== error && !Object.hasOwn(actual, "data"));
      assert.equal(f.wallet.state.connected, false);
      assert.equal(f.wallet.state.account, null);
      assert.equal(f.wallet.state.connectionEpoch, epoch + 1);
      assert.ok([...f.listeners.values()].every(set => set.size === 0));
      const count = f.calls.length;
      await assert.rejects(read(f.wallet), { code: "NOT_CONNECTED" });
      assert.equal(f.calls.length, count, "No retry or automatic permission request");
      assert.equal(f.calls.filter(call => call.method === "eth_requestAccounts").length, 1);
      f.setOverride(() => undefined);
      assert.equal((await f.wallet.connect()).connected, true, "Explicit reconnection remains possible");
      assert.equal(await f.wallet.getNativeBalance(BLOCK.hash), 42n);
      f.wallet.disconnect();
    });
  }
  for (const method of ["eth_chainId", "eth_accounts", "eth_getBalance"]) {
    test(`delayed ${code} from ${method} cannot disconnect a newer session`, async () => {
      const f = fixture(), gate = deferred(), entered = deferred();
      await f.wallet.connect();
      f.setOverride(args => {
        if (args.method === method) { entered.resolve(); return gate.promise; }
      });
      const pending = f.wallet.getNativeBalance(BLOCK.hash);
      await entered.promise;
      f.wallet.disconnect();
      f.setOverride(() => undefined);
      await f.wallet.connect();
      const fresh = f.wallet.state;
      gate.reject(fault(code));
      await assert.rejects(pending, { code: "SESSION_CHANGED" });
      assert.deepEqual(f.wallet.state, fresh);
      assert.equal(await f.wallet.getNativeBalance(BLOCK.hash), 42n);
      f.wallet.disconnect();
    });
  }
}

for (const code of [4001, 4200, -32602, -32000, "4900"]) {
  test(`non-terminal code ${JSON.stringify(code)} preserves the session with a safe error`, async () => {
    const f = fixture();
    await f.wallet.connect();
    const state = f.wallet.state, error = fault(code);
    f.setOverride(({ method }) => method === "eth_getBalance" ? Promise.reject(error) : undefined);
    await assert.rejects(f.wallet.getNativeBalance(BLOCK.hash), actual =>
      actual.code === (typeof code === "number" ? code : "PROVIDER_FAILURE") && actual !== error);
    assert.deepEqual(f.wallet.state, state);
    f.setOverride(() => undefined);
    assert.equal(await f.wallet.getNativeBalance(BLOCK.hash), 42n);
    assert.equal(f.calls.filter(call => call.method === "eth_requestAccounts").length, 1);
    f.wallet.disconnect();
  });
}

test("a synchronous provider throw also invalidates the current connection", async () => {
  const f = fixture(), error = fault(4900);
  await f.wallet.connect();
  f.setOverride(({ method }) => { if (method === "eth_getBalance") throw error; });
  await assert.rejects(f.wallet.getNativeBalance(), actual => actual.code === 4900 && actual !== error);
  assert.equal(f.wallet.state.connected, false);
});

test("one terminal failure also discards another pending successful read", async () => {
  const f = fixture(), gate = deferred(), entered = deferred();
  await f.wallet.connect();
  f.setOverride(({ method }) => {
    if (method === "eth_getBalance") { entered.resolve(); return gate.promise; }
    if (method === "eth_getCode") return Promise.reject(fault(4901));
  });
  const pending = f.wallet.getNativeBalance();
  await entered.promise;
  await assert.rejects(f.wallet.getContractCode(TOKEN), { code: 4901 });
  gate.resolve("0x2a");
  await assert.rejects(pending, { code: "SESSION_CHANGED" });
  assert.equal(f.wallet.state.connected, false);
});
