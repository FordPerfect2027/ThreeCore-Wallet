import test from "node:test";
import assert from "node:assert/strict";
import {
  AERODROME_BASE, THREECORE_BASE_TOKENS,
} from "../src/aerodrome-readonly.js";
import {
  BASE_NATIVE_USDC, AerodromePoolReadError, inspectAerodromePools,
} from "../src/aerodrome-pools.js";

const POOL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
function word(n) {
  return BigInt(n).toString(16).padStart(64, "0");
}
function addr(value) {
  return "0x" + value.slice(2).padStart(64, "0");
}
function mock({
  chain = "0x2105", code = "0x6000",
  poolToken0 = BASE_NATIVE_USDC, poolToken1 = THREECORE_BASE_TOKENS.DAT,
  selectedPool = "DAT:volatile",
  wrongBlock = false, corruptId = false,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, AERODROME_BASE.rpcUrl);
    const input = JSON.parse(options.body);
    calls.push(input);
    let result;
    if (input.method === "eth_chainId") result = chain;
    else if (input.method === "eth_blockNumber") result = wrongBlock ? "not-a-block" : "0x11";
    else if (input.method === "eth_getCode") result = code;
    else if (input.method === "eth_call") {
      const [{ to, data }, block] = input.params;
      assert.equal(block, "0x11");
      if (to === AERODROME_BASE.poolFactory) {
        assert.equal(data.slice(0, 10), "0x79bc57d5");
        assert.equal(data.length, 202);
        const token = "0x" + data.slice(34, 74);
        const isStable = data.slice(-1) === "1";
        const key = Object.entries(THREECORE_BASE_TOKENS).find(([, v]) => v === token)?.[0] +
          ":" + (isStable ? "stable" : "volatile");
        result = key === selectedPool ? addr(POOL) : addr("0x" + "0".repeat(40));
      } else if (to === POOL) {
        if (data === "0x0dfe1681") result = addr(poolToken0);
        else if (data === "0xd21220a7") result = addr(poolToken1);
        else if (data === "0x0902f1ac") result = "0x" + word(100n) + word(200n) + word(1700000000n);
        else throw Error("Forbidden pool selector " + data);
      } else throw Error("Unexpected eth_call contract " + to);
    } else throw Error("Forbidden RPC method " + input.method);
    return {
      ok: true,
      async json() {
        return {
          jsonrpc: "2.0",
          id: corruptId ? input.id + 1 : input.id,
          result,
        };
      },
    };
  };
  return { calls, fetchImpl };
}
function hasCode(value) {
  return (e) => e instanceof AerodromePoolReadError && e.code === value;
}

test("native Base USDC address is the one published by Circle", () => {
  assert.equal(BASE_NATIVE_USDC, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
});

test("discovers DAT/USDC volatile pair and reports correctly ordered raw reserves", async () => {
  const { calls, fetchImpl } = mock();
  const report = await inspectAerodromePools({ fetchImpl });
  assert.equal(report.chainId, 8453);
  assert.equal(report.checkedBlockNumber, "17");
  assert.equal(report.quoteTokenAddress, BASE_NATIVE_USDC);
  const dat = report.pools.DAT.volatile;
  assert.equal(dat.poolAddress, POOL);
  assert.equal(dat.contractCodePresent, true);
  assert.equal(dat.tokenReserveBaseUnits, "200");
  assert.equal(dat.usdcReserveBaseUnits, "100");
  assert.equal(dat.reserveTimestamp, "1700000000");
  assert.equal(report.pools.DAT.stable.poolAddress, null);
  assert.equal(report.pools.EMA.volatile.poolAddress, null);
  assert.equal(report.pools.CAWELON.stable.poolAddress, null);
  assert.equal(report.readOnly, true);
  assert.equal(report.walletConnected, false);
  assert.equal(report.transactionsExecuted, false);
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(dat));
  assert.equal(calls.filter(c => c.method === "eth_getCode").length, 1);
  assert.equal(calls.filter(c => c.method === "eth_call").length, 9);
});

test("stable pair is tracked separately from volatile pair", async () => {
  const { fetchImpl } = mock({
    selectedPool: "EMA:stable",
    poolToken0: THREECORE_BASE_TOKENS.EMA,
    poolToken1: BASE_NATIVE_USDC,
  });
  const report = await inspectAerodromePools({ fetchImpl });
  assert.equal(report.pools.EMA.volatile.poolAddress, null);
  assert.equal(report.pools.EMA.stable.poolAddress, POOL);
  assert.equal(report.pools.EMA.stable.tokenReserveBaseUnits, "100");
  assert.equal(report.pools.EMA.stable.usdcReserveBaseUnits, "200");
});

test("absent pools are reported as null and reserve reads are not attempted", async () => {
  const { calls, fetchImpl } = mock({ selectedPool: "none" });
  const result = await inspectAerodromePools({ fetchImpl });
  assert.ok(Object.values(result.pools).every(p => p.stable.poolAddress === null &&
    p.volatile.poolAddress === null));
  assert.equal(calls.length, 8);
  assert.equal(calls.some(c => c.method === "eth_getCode"), false);
});

test("pool address with no deployed code has unknown reserves", async () => {
  const { calls, fetchImpl } = mock({ code: "0x" });
  const result = await inspectAerodromePools({ fetchImpl });
  const pool = result.pools.DAT.volatile;
  assert.equal(pool.poolAddress, POOL);
  assert.equal(pool.contractCodePresent, false);
  assert.equal(pool.tokenReserveBaseUnits, null);
  assert.equal(pool.usdcReserveBaseUnits, null);
  assert.equal(calls.some(c => c.method === "eth_call" &&
    c.params[0].to === POOL), false);
});

test("incorrect pool token identity fails closed", async () => {
  const { fetchImpl } = mock({ poolToken1: OTHER });
  await assert.rejects(inspectAerodromePools({ fetchImpl }), hasCode("POOL_TOKEN_MISMATCH"));
});

test("chain mismatch fails before discovering any pools", async () => {
  const { fetchImpl, calls } = mock({ chain: "0x14a34" });
  await assert.rejects(inspectAerodromePools({ fetchImpl }), hasCode("WRONG_CHAIN"));
  assert.deepEqual(calls.map(c => c.method), ["eth_chainId"]);
});

test("invalid block number and mismatched JSON-RPC ID are rejected", async () => {
  await assert.rejects(inspectAerodromePools({
    fetchImpl: mock({ wrongBlock: true }).fetchImpl,
  }), hasCode("INVALID_RPC_RESULT"));
  await assert.rejects(inspectAerodromePools({
    fetchImpl: mock({ corruptId: true }).fetchImpl,
  }), hasCode("INVALID_RPC_RESULT"));
});

test("transport and timeout validation happens before network access", async () => {
  const { fetchImpl, calls } = mock();
  await assert.rejects(inspectAerodromePools({ fetchImpl: null }), hasCode("NO_TRANSPORT"));
  await assert.rejects(inspectAerodromePools({ fetchImpl, timeoutMs: 40000 }), hasCode("INVALID_TIMEOUT"));
  assert.equal(calls.length, 0);
});

test("all operations use only read-only RPC methods at one block", async () => {
  const { calls, fetchImpl } = mock();
  await inspectAerodromePools({ fetchImpl });
  assert.ok(calls.every(c => ["eth_chainId", "eth_blockNumber", "eth_call", "eth_getCode"].includes(c.method)));
  assert.ok(calls.filter(c => ["eth_call", "eth_getCode"].includes(c.method))
    .every(c => c.params.at(-1) === "0x11"));
  assert.equal(calls.some(c => /sign|sendTransaction|approve|personal/i.test(c.method)), false);
});
