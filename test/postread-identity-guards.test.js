import test from "node:test";
import assert from "node:assert/strict";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";

const ACCOUNT = "0x" + "11".repeat(20);
const OTHER = "0x" + "22".repeat(20);
const TOKEN = "0x" + "33".repeat(20);
const SPENDER = "0x" + "44".repeat(20);
const HEADER = { number: "0x2a", hash: "0x" + "ab".repeat(32) };
const WORD = "0x" + "0".repeat(63) + "a";
const READS = [
  ["block", "eth_getBlockByNumber", w => w.getBlockSnapshot()],
  ["native balance", "eth_getBalance", w => w.getNativeBalance()],
  ["token balance", "eth_call", w => w.getTokenBalance(TOKEN)],
  ["allowance", "eth_call", w => w.getTokenAllowance(TOKEN, SPENDER)],
  ["code", "eth_getCode", w => w.getContractCode(TOKEN)],
];

function fixture({ flipMethod, flip, override, readTimeoutMs = 100 } = {}) {
  const calls = [];
  const state = { chain: "0x2105", accounts: [ACCOUNT], flipped: false };
  const provider = {
    on() {},
    removeListener() {},
    request({ method }) {
      calls.push(method);
      if (override) {
        const changed = override(method, state);
        if (changed !== undefined) return Promise.resolve(changed);
      }
      if (method === "eth_chainId") return Promise.resolve(state.chain);
      if (method === "eth_accounts" || method === "eth_requestAccounts") {
        return Promise.resolve([...state.accounts]);
      }
      const values = {
        eth_getBlockByNumber: HEADER,
        eth_getBalance: "0xa",
        eth_call: WORD,
        eth_getCode: "0x6000",
      };
      if (!(method in values)) throw Error("Forbidden provider method: " + method);
      if (!state.flipped && flipMethod === method) {
        state.flipped = true;
        flip(state); // No EIP-1193 event: identity changed during the RPC.
      }
      return Promise.resolve(values[method]);
    },
  };
  const wallet = new ThreeCoreWalletSession({
    provider, agent: "DAT", siteOrigin: "https://dex.example",
    approvedOrigins: ["https://dex.example"], expectedAccount: ACCOUNT,
    chainId: 8453, readTimeoutMs,
  });
  return { wallet, state, calls };
}

for (const [label, method, read] of READS) {
  test(`${label}: silent chain change discards completed read`, async () => {
    const f = fixture({ flipMethod: method, flip: s => { s.chain = "0x1"; } });
    await f.wallet.connect();
    f.calls.length = 0;
    await assert.rejects(read(f.wallet), { code: "WRONG_CHAIN" });
    assert.equal(f.wallet.state.connected, false);
    assert.equal(f.wallet.state.account, null);
    assert.equal(f.calls.filter(m => m === method).length, 1);
    assert.ok(f.calls.every(m => ["eth_chainId", "eth_accounts", method].includes(m)));
    await assert.rejects(read(f.wallet), { code: "NOT_CONNECTED" });
  });

  test(`${label}: silent account change discards completed read`, async () => {
    const f = fixture({ flipMethod: method, flip: s => { s.accounts = [OTHER]; } });
    await f.wallet.connect();
    f.calls.length = 0;
    await assert.rejects(read(f.wallet), { code: "ACCOUNT_CHANGED" });
    assert.equal(f.wallet.state.connected, false);
    assert.equal(f.wallet.state.account, null);
    assert.equal(f.calls.filter(m => m === method).length, 1);
    assert.ok(f.calls.every(m => ["eth_chainId", "eth_accounts", method].includes(m)));
  });
}

test("stable chain/account remain connected and use read-only RPC only", async () => {
  const f = fixture();
  await f.wallet.connect();
  const outputs = [];
  for (const [, , read] of READS) outputs.push(await read(f.wallet));
  assert.deepEqual(outputs, [
    HEADER, 10n, 10n, 10n,
    { address: TOKEN.toLowerCase(), deployed: true },
  ]);
  assert.equal(f.wallet.state.connected, true);
  assert.equal(f.calls.filter(m => m === "eth_requestAccounts").length, 1);
  assert.ok(f.calls.every(m => [
    "eth_chainId", "eth_accounts", "eth_requestAccounts",
    "eth_getBlockByNumber", "eth_getBalance", "eth_call", "eth_getCode",
  ].includes(m)));
  f.wallet.disconnect();
});

test("unresponsive post-read chain confirmation times out without exposing data", async () => {
  let stall = false;
  const f = fixture({
    readTimeoutMs: 10,
    override(method) {
      if (stall && method === "eth_chainId") return new Promise(() => {});
      if (method === "eth_getBalance") stall = true;
    },
  });
  await f.wallet.connect();
  await assert.rejects(f.wallet.getNativeBalance(), { code: "READ_TIMEOUT" });
  assert.equal(f.wallet.state.connected, false);
  assert.equal(f.calls.filter(m => m === "eth_getBalance").length, 1);
});
