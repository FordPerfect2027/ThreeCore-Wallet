import test from "node:test";
import assert from "node:assert/strict";
import { CHAINS, ThreeCoreWalletSession, WalletConnectionError } from "../src/wallet-session.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const SPENDER = "0x3333333333333333333333333333333333333333";
const SITE = "https://dex.example";
const HEADER = { number: "0x10", hash: "0x" + "ab".repeat(32) };
const UINT = "0x" + "0".repeat(63) + "a";

class SwitchingProvider {
  constructor(switchDuring = null) {
    this.chain = CHAINS.BASE_SEPOLIA.hex;
    this.switchDuring = switchDuring;
    this.calls = [];
  }

  async request({ method }) {
    this.calls.push(method);
    if (method === "eth_chainId") return this.chain;
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [ACCOUNT];
    const result = {
      eth_getBlockByNumber: HEADER,
      eth_getBalance: "0xa",
      eth_call: UINT,
      eth_getCode: "0x6000",
    }[method];
    if (result === undefined) throw new Error("Unexpected RPC: " + method);
    // Deliberately do not send a chainChanged event.
    if (this.switchDuring === method) this.chain = "0x1";
    return result;
  }
}

function wallet(provider) {
  return new ThreeCoreWalletSession({
    provider,
    agent: "DAT",
    siteOrigin: SITE,
    approvedOrigins: [SITE],
    expectedAccount: ACCOUNT,
    chainId: CHAINS.BASE_SEPOLIA.id,
  });
}

const reads = [
  ["eth_getBlockByNumber", (session) => session.getBlockSnapshot()],
  ["eth_getBalance", (session) => session.getNativeBalance()],
  ["eth_call:balanceOf", (session) => session.getTokenBalance(TOKEN)],
  ["eth_call:allowance", (session) => session.getTokenAllowance(TOKEN, SPENDER)],
  ["eth_getCode", (session) => session.getContractCode(TOKEN)],
];

for (const [label, read] of reads) {
  const method = label.startsWith("eth_call:") ? "eth_call" : label;
  test(label + ": silent RPC chain swap fails closed after the read", async () => {
    const provider = new SwitchingProvider(method);
    const session = wallet(provider);
    await session.connect();
    provider.calls.length = 0;
    await assert.rejects(read(session), (error) =>
      error instanceof WalletConnectionError && error.code === "WRONG_CHAIN");
    assert.equal(session.state.connected, false);
    assert.deepEqual(provider.calls, [
      "eth_chainId", "eth_accounts", method, "eth_chainId",
    ]);
    assert.equal(provider.calls.some((name) =>
      /sign|sendTransaction|writeContract|approve|switchEthereumChain/i.test(name)), false);
  });
}

test("stable RPC chain stays connected for all read-only operations", async () => {
  const provider = new SwitchingProvider();
  const session = wallet(provider);
  await session.connect();
  for (const [, read] of reads) {
    provider.calls.length = 0;
    await read(session);
    assert.equal(provider.calls.filter((name) => name === "eth_chainId").length, 2);
  }
  assert.equal(session.state.connected, true);
  assert.equal(provider.calls.some((name) => name === "eth_sendTransaction"), false);
});
