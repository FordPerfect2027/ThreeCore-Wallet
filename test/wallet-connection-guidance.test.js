import test from "node:test";
import assert from "node:assert/strict";
import { validateConnectionAccount, walletConnectionGuidance } from "../src/wallet-connection-guidance.js";
import { createWalletCardController } from "../src/wallet-card-controller.js";
import { createRpcSupervisor } from "../src/rpc-supervisor.js";

const A = "0x" + "ab".repeat(20), B = "0x" + "cd".repeat(20);
const upper = value => "0x" + value.slice(2).toUpperCase();

for (const unfinished of ["", "0x", "0xab...1234", "unfinished", "0x123"]) {
  test(`another card's unfinished address does not block a valid assignment: ${unfinished}`, () => {
    assert.equal(validateConnectionAccount(upper(A), [unfinished, B]), A);
  });
  test(`this card's unfinished address is still refused: ${unfinished}`, () => {
    assert.throws(() => validateConnectionAccount(unfinished, [A, B]), { code: "INVALID_ADDRESS" });
  });
}

for (const peers of [[A], [upper(A)], [B, A], ["unfinished", upper(A)]]) {
  test(`valid duplicate address is refused regardless of case or other incomplete fields: ${peers}`, () => {
    assert.throws(() => validateConnectionAccount(A, peers), { code: "DUPLICATE_ACCOUNT" });
  });
}

test("assignment validation does not mutate the other cards", () => {
  const peers = Object.freeze([upper(B), "0x"]);
  assert.equal(validateConnectionAccount(A, peers), A);
  assert.deepEqual(peers, [upper(B), "0x"]);
});

for (const code of ["constructor", "__proto__", "unknown", null, undefined, {}]) {
  test(`unknown connection code has no inferred guidance: ${String(code)}`, () => {
    assert.equal(walletConnectionGuidance(code), null);
  });
}

test("guidance never reflects invalid agent, address or chain text", () => {
  const untrusted = "<script>send secrets</script>";
  for (const code of ["INVALID_ADDRESS", "WRONG_ACCOUNT", "WRONG_CHAIN", "NO_ACCOUNTS"]) {
    const text = walletConnectionGuidance(code, { agent: untrusted, account: untrusted, chainId: untrusted });
    assert(!text.includes(untrusted));
    assert(text.length < 600);
  }
});

function fixture(t, agent, chainId, answer) {
  const calls = [];
  const supervisor = createRpcSupervisor();
  const provider = { on() {}, removeListener() {}, async request(args) {
    calls.push(args.method);
    return answer(args.method);
  } };
  const controller = createWalletCardController({ agent, siteOrigin: "http://127.0.0.1:4173",
    rpcSupervisor: supervisor });
  t.after(() => { controller.dispose(); supervisor.dispose(); });
  const options = Object.freeze({ provider, account: A, chainId });
  return { calls, controller, options, connect: () => controller.connect(options) };
}

for (const agent of ["DAT", "EMA", "CAWELON"]) {
  for (const chainId of [8453, 84532]) {
    const chainHex = "0x" + chainId.toString(16);
    test(`${agent}/${chainId}: wrong account explains site permission without changing assignment or reading funds`, async t => {
      const f = fixture(t, agent, chainId, method => method === "eth_chainId" ? chainHex : [B]);
      assert.equal(await f.connect(), false);
      assert.equal(f.controller.state.phase, "disconnected");
      assert.equal(f.controller.state.result, null);
      assert.match(f.controller.state.error, /このサイトへの接続許可/);
      assert(f.controller.state.error.includes(agent + "の設定アドレス: " + A));
      assert(!f.controller.state.error.includes(B), "Unverified wallet identity must not be displayed as assigned");
      assert.equal(f.options.account, A);
      assert.deepEqual(f.calls, ["eth_chainId", "eth_requestAccounts"]);
    });
    test(`${agent}/${chainId}: wrong chain is explained before requesting account permission`, async t => {
      const f = fixture(t, agent, chainId, () => "0x1");
      assert.equal(await f.connect(), false);
      assert(f.controller.state.error.includes(String(chainId)));
      assert(f.controller.state.error.includes(chainId === 8453 ? "Base Mainnet" : "Base Sepolia"));
      assert.deepEqual(f.calls, ["eth_chainId"]);
      assert.equal(f.controller.state.connection, null);
    });
    test(`${agent}/${chainId}: explicit retry succeeds only after the provider exposes the assigned account`, async t => {
      let selected = B;
      const f = fixture(t, agent, chainId, method => method === "eth_chainId" ? chainHex : [selected]);
      assert.equal(await f.connect(), false);
      const previousCalls = f.calls.length;
      selected = A;
      await Promise.resolve();
      assert.equal(f.calls.length, previousCalls);
      assert.equal(await f.connect(), true);
      assert.equal(f.controller.state.error, null);
      assert.equal(f.controller.state.connection.account, A);
      assert(f.calls.every(method => ["eth_chainId", "eth_requestAccounts", "eth_accounts"].includes(method)));
    });
  }
}

test("empty approved account list identifies permission as incomplete, not a zero balance", async t => {
  const f = fixture(t, "EMA", 8453, method => method === "eth_chainId" ? "0x2105" : []);
  assert.equal(await f.connect(), false);
  assert.match(f.controller.state.error, /接続許可/);
  assert.equal(f.controller.state.result, null);
  assert.deepEqual(f.calls, ["eth_chainId", "eth_requestAccounts"]);
});
