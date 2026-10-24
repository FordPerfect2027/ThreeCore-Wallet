import test from "node:test";
import assert from "node:assert/strict";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
import { inspectDappSpender } from "../src/dapp-preflight.js";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const SPENDER = "0x3333333333333333333333333333333333333333";
const HASH = "0x" + "ab".repeat(32);
const OTHER_HASH = "0x" + "cd".repeat(32);
const BLOCK = Object.freeze({ number: "0x2a", hash: HASH });
const options = { tokenAddress: TOKEN, spenderAddress: SPENDER };
const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const isStateRead = ({ method }) => ["eth_getCode", "eth_call", "eth_getBalance"].includes(method);

function setup(override = () => undefined) {
  const calls = [];
  const provider = {
    async request(args) {
      calls.push(args);
      const custom = await override(args);
      if (custom !== undefined) return custom;
      switch (args.method) {
        case "eth_chainId": return "0x2105";
        case "eth_requestAccounts":
        case "eth_accounts": return [ACCOUNT];
        case "eth_getBlockByNumber": return { ...BLOCK };
        case "eth_getCode": return "0x6000";
        case "eth_getBalance": return "0x64";
        case "eth_call": {
          const balance = args.params[0].data.startsWith("0x70a08231");
          const pinned = args.params[1]?.blockHash === HASH;
          return word(balance ? (pinned ? 100 : 90) : (pinned ? 10 : 20));
        }
        default: throw new Error("Forbidden RPC: " + args.method);
      }
    },
  };
  const wallet = new ThreeCoreWalletSession({
    provider, agent: "DAT", siteOrigin: "https://dapp.example",
    approvedOrigins: ["https://dapp.example"], expectedAccount: ACCOUNT, chainId: 8453,
  });
  return { wallet, calls };
}

test("preflight pins every code/balance/allowance read to one canonical block hash", async () => {
  const { wallet, calls } = setup();
  await wallet.connect();
  const result = await inspectDappSpender(wallet, options);
  assert.equal(result.tokenBalanceBaseUnits, "100");
  assert.equal(result.existingAllowanceBaseUnits, "10");
  assert.equal(result.blockNumber, "42");
  assert.equal(result.blockHash, HASH);
  assert.deepEqual(calls.filter(isStateRead).map(({ params }) => params[1]),
    Array(4).fill({ blockHash: HASH, requireCanonical: true }));
  assert.deepEqual(calls.filter(({ method }) => method === "eth_getBlockByNumber").map(({ params }) => params),
    [["latest", false], [BLOCK.number, false]]);
});

test("a newer head does not change the selected historical block", async () => {
  let headers = 0;
  const { wallet } = setup(({ method, params }) => {
    if (method === "eth_getBlockByNumber") {
      headers++;
      if (headers > 1 && params[0] === "latest") return { number: "0x2b", hash: OTHER_HASH };
      return { ...BLOCK };
    }
  });
  await wallet.connect();
  const result = await inspectDappSpender(wallet, options);
  assert.equal(result.blockHash, HASH);
  assert.equal(result.tokenBalanceBaseUnits, "100");
  assert.equal(headers, 2);
});

test("a reorganized block at the selected height discards the whole report", async () => {
  let headers = 0;
  const { wallet } = setup(({ method }) => {
    if (method === "eth_getBlockByNumber") return ++headers === 1 ? { ...BLOCK } : { ...BLOCK, hash: OTHER_HASH };
  });
  await wallet.connect();
  await assert.rejects(inspectDappSpender(wallet, options), { code: "BLOCK_CHANGED" });
});

test("unsupported hash selectors fail without retrying against latest or a block number", async () => {
  const unsupported = Object.assign(new Error("Hash selector not supported"), { code: -32602 });
  const { wallet, calls } = setup((args) => {
    if (isStateRead(args)) throw unsupported;
  });
  await wallet.connect();
  await assert.rejects(inspectDappSpender(wallet, options), error =>
    error !== unsupported && error.code === -32602 && !error.message.includes("Hash selector"));
  assert.equal(calls.filter(isStateRead).length, 1);
  assert.deepEqual(calls.filter(isStateRead)[0].params[1], { blockHash: HASH, requireCanonical: true });
});

test("an unavailable or noncanonical state stops preflight without a partial report", async () => {
  for (const code of [-32000, -32001]) {
    const missing = Object.assign(new Error("Selected state unavailable"), { code });
    const { wallet, calls } = setup(({ method, params }) => {
      if (method === "eth_call" && params[0].data.startsWith("0xdd62ed3e")) throw missing;
    });
    await wallet.connect();
    await assert.rejects(inspectDappSpender(wallet, options), error =>
      error !== missing && error.code === code && !error.message.includes("Selected state"));
    assert.equal(calls.filter(({ method }) => method === "eth_call").length, 2);
  }
});

test("a missing initial block prevents all state reads", async () => {
  const { wallet, calls } = setup(({ method }) => method === "eth_getBlockByNumber" ? null : undefined);
  await wallet.connect();
  await assert.rejects(inspectDappSpender(wallet, options), { code: "BLOCK_UNAVAILABLE" });
  assert.equal(calls.some(isStateRead), false);
});

test("a missing final canonical block prevents a successful report", async () => {
  let headers = 0;
  const { wallet } = setup(({ method }) => {
    if (method === "eth_getBlockByNumber") return ++headers === 1 ? { ...BLOCK } : null;
  });
  await wallet.connect();
  await assert.rejects(inspectDappSpender(wallet, options), { code: "BLOCK_UNAVAILABLE" });
});

test("malformed header numbers and hashes fail before state reads", async () => {
  for (const header of [
    {}, [], { ...BLOCK, number: null }, { ...BLOCK, hash: null },
    { ...BLOCK, number: "0x00" }, { ...BLOCK, number: "0x" },
    { ...BLOCK, number: "0x1" + "0".repeat(64) }, { ...BLOCK, hash: "0xab" },
    { ...BLOCK, hash: "0x" + "ab".repeat(33) },
  ]) {
    const { wallet, calls } = setup(({ method }) => method === "eth_getBlockByNumber" ? header : undefined);
    await wallet.connect();
    const boundaryCode = Array.isArray(header) ? "RPC_RESULT_SHAPE"
      : header.number?.length > 66 || header.hash?.length > 66 ? "RPC_RESULT_LIMIT" : "INVALID_RPC_RESULT";
    await assert.rejects(inspectDappSpender(wallet, options), { code: boundaryCode });
    assert.equal(calls.some(isStateRead), false);
  }
});

test("explicit block lookups reject headers for a different requested height", async () => {
  const { wallet } = setup();
  await wallet.connect();
  await assert.rejects(wallet.getBlockSnapshot("0x29"), { code: "INVALID_RPC_RESULT" });
});

test("block lookups accept genesis and preserve uint256 precision", async () => {
  for (const number of ["0x0", "0x" + "f".repeat(64)]) {
    const { wallet } = setup(({ method }) => method === "eth_getBlockByNumber" ? { ...BLOCK, number } : undefined);
    await wallet.connect();
    const result = await inspectDappSpender(wallet, options);
    assert.equal(result.blockNumber, BigInt(number).toString());
  }
});

test("block hash case is normalized for comparisons and report output", async () => {
  let headers = 0;
  const { wallet } = setup(({ method }) => {
    if (method === "eth_getBlockByNumber") return { ...BLOCK, hash: ++headers === 1 ? "0x" + "AB".repeat(32) : HASH };
  });
  await wallet.connect();
  assert.equal((await inspectDappSpender(wallet, options)).blockHash, HASH);
});

test("explicit hash reads support ETH and ERC-20 while omitted hashes retain latest reads", async () => {
  const { wallet, calls } = setup();
  await wallet.connect();
  assert.equal(await wallet.getNativeBalance(HASH), 100n);
  assert.equal(await wallet.getTokenBalance(TOKEN, HASH), 100n);
  assert.equal(await wallet.getTokenAllowance(TOKEN, SPENDER, HASH), 10n);
  assert.equal((await wallet.getContractCode(TOKEN, HASH)).deployed, true);
  assert.equal(await wallet.getTokenBalance(TOKEN), 90n);
  const blocks = calls.filter(isStateRead).map(({ params }) => params[1]);
  assert.deepEqual(blocks.slice(0, 4), Array(4).fill({ blockHash: HASH, requireCanonical: true }));
  assert.equal(blocks[4], "latest");
});

test("invalid block selectors cannot silently downgrade to latest", async () => {
  const { wallet, calls } = setup();
  await wallet.connect();
  for (const hash of [null, "", "latest", "0x2a", OTHER_HASH + "ab", { blockHash: HASH }, 42]) {
    for (const read of [
      () => wallet.getNativeBalance(hash), () => wallet.getTokenBalance(TOKEN, hash),
      () => wallet.getTokenAllowance(TOKEN, SPENDER, hash), () => wallet.getContractCode(TOKEN, hash),
    ]) await assert.rejects(read(), { code: "INVALID_BLOCK_HASH" });
  }
  for (const number of [null, "", "pending", "safe", 42, "0x00", HASH + "ff"]) {
    await assert.rejects(wallet.getBlockSnapshot(number), { code: "INVALID_BLOCK_NUMBER" });
  }
  assert.equal(calls.some(isStateRead), false);
  assert.equal(calls.some(({ method }) => method === "eth_getBlockByNumber"), false);
});

test("a late header after reconnect cannot invalidate or satisfy the new session", async () => {
  let finish, started;
  const ready = new Promise((resolve) => { started = resolve; });
  const { wallet } = setup(({ method }) => {
    if (method === "eth_getBlockByNumber") {
      started();
      return new Promise((resolve) => { finish = resolve; });
    }
  });
  await wallet.connect();
  const pending = wallet.getBlockSnapshot();
  const rejected = assert.rejects(pending, { code: "SESSION_CHANGED" });
  await ready;
  wallet.disconnect();
  await wallet.connect();
  finish(null);
  await rejected;
  assert.equal(wallet.state.connected, true);
});

for (const boundary of [1, 2]) {
  test(`same-account reconnect after header ${boundary} discards preflight`, async () => {
    const { wallet } = setup();
    await wallet.connect();
    const original = wallet.getBlockSnapshot.bind(wallet);
    let reads = 0;
    wallet.getBlockSnapshot = async (...args) => {
      const result = await original(...args);
      if (++reads === boundary) {
        wallet.disconnect();
        await wallet.connect();
      }
      return result;
    };
    await assert.rejects(inspectDappSpender(wallet, options), { code: "SESSION_CHANGED" });
    assert.equal(wallet.state.connected, true);
  });
}
