import test from "node:test";
import assert from "node:assert/strict";
import {
  AERODROME_BASE, THREECORE_BASE_TOKENS,
  AerodromeReadError, inspectAerodromeBase,
} from "../src/aerodrome-readonly.js";

const WALLET = "0x1111111111111111111111111111111111111111";

function mockTransport({
  chain = "0x2105",
  block = "0x1234",
  bytecode = "0x6000",
  balance = "0x" + "64".padStart(64, "0"),
  allowance = "0x" + "0".repeat(64),
  corruptId = false,
  httpOk = true,
  rpcError = false,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(url, AERODROME_BASE.rpcUrl);
    assert.equal(options.method, "POST");
    const input = JSON.parse(options.body);
    calls.push(input);
    let result;
    switch (input.method) {
      case "eth_chainId": result = chain; break;
      case "eth_blockNumber": result = block; break;
      case "eth_getCode": result = bytecode; break;
      case "eth_call":
        result = input.params[0].data.startsWith("0xdd62ed3e") ? allowance : balance;
        break;
      default: throw Error("Forbidden RPC method " + input.method);
    }
    return {
      ok: httpOk,
      async json() {
        return rpcError ? {
          jsonrpc: "2.0", id: input.id, error: { code: -32000 },
        } : {
          jsonrpc: "2.0", id: input.id + (corruptId ? 1 : 0), result,
        };
      },
    };
  };
  return { calls, fetchImpl };
}

function expectCode(value) {
  return (e) => e instanceof AerodromeReadError && e.code === value;
}

test("published contract manifest covers all three ThreeCore tokens", () => {
  assert.deepEqual(Object.keys(THREECORE_BASE_TOKENS), ["DAT", "EMA", "CAWELON"]);
  assert.equal(AERODROME_BASE.chainId, 8453);
  assert.equal(AERODROME_BASE.source, "https://aerodrome.finance/security");
  assert.ok(Object.isFrozen(AERODROME_BASE));
  assert.ok(Object.isFrozen(THREECORE_BASE_TOKENS));
  for (const value of [
    AERODROME_BASE.router, AERODROME_BASE.poolFactory,
    AERODROME_BASE.factoryRegistry, ...Object.values(THREECORE_BASE_TOKENS),
  ]) {
    assert.match(value, /^0x[0-9a-f]{40}$/);
  }
});

test("reads Base chain, block and code for six published addresses", async () => {
  const { fetchImpl, calls } = mockTransport();
  const result = await inspectAerodromeBase({ fetchImpl });
  assert.equal(result.chainId, 8453);
  assert.equal(result.blockNumber, "4660");
  assert.equal(result.readOnly, true);
  assert.equal(result.userWalletConnected, false);
  assert.equal(result.tradePerformed, false);
  assert.equal(result.externalDappWalletConnected, false);
  assert.equal(result.contractSecurityAudited, false);
  assert.equal(result.tokenReadings, null);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.codePresent));
  assert.deepEqual(Object.keys(result.codePresent), [
    "aerodromeRouter", "aerodromePoolFactory",
    "aerodromeFactoryRegistry", "DAT", "EMA", "CAWELON",
  ]);
  assert.ok(Object.values(result.codePresent).every(Boolean));
  assert.deepEqual(calls.map(c => c.method), [
    "eth_chainId", "eth_blockNumber",
    ...Array(6).fill("eth_getCode"),
  ]);
  assert.deepEqual(
    calls.filter(c => c.method === "eth_getCode").map(c => c.params[0]),
    Object.values(result.contractAddresses),
  );
});

test("a wallet address is strictly optional and never requested from a provider", async () => {
  const { fetchImpl, calls } = mockTransport();
  const result = await inspectAerodromeBase({ fetchImpl });
  assert.equal(result.walletAddress, null);
  assert.equal(result.tokenReadings, null);
  assert.equal(calls.some(c => /accounts|send|sign|approve/i.test(c.method)), false);
});

test("reads balances and existing Aerodrome classic-router allowances for all three tokens", async () => {
  const { fetchImpl, calls } = mockTransport({ allowance: "0x" + "2a".padStart(64, "0") });
  const result = await inspectAerodromeBase({ fetchImpl, publicWalletAddress: WALLET });
  assert.equal(result.walletAddress, WALLET);
  assert.deepEqual(Object.keys(result.tokenReadings), ["DAT", "EMA", "CAWELON"]);
  for (const item of Object.values(result.tokenReadings)) {
    assert.deepEqual(item, {
      balanceBaseUnits: "100",
      classicRouterAllowanceBaseUnits: "42",
    });
    assert.ok(Object.isFrozen(item));
  }
  const ethCalls = calls.filter(c => c.method === "eth_call");
  assert.equal(ethCalls.length, 6);
  const words = (value) => value.slice(2).padStart(64, "0");
  for (const [agent, token] of Object.entries(THREECORE_BASE_TOKENS)) {
    assert.ok(ethCalls.some(c =>
      c.params[0].to === token &&
      c.params[0].data === "0x70a08231" + words(WALLET)
    ), agent + " balanceOf encoding");
    assert.ok(ethCalls.some(c =>
      c.params[0].to === token &&
      c.params[0].data === "0xdd62ed3e" + words(WALLET) + words(AERODROME_BASE.router)
    ), agent + " allowance encoding");
  }
  assert.equal(calls.some(c => c.method === "eth_sendTransaction"), false);
});

test("zero deployed bytecode is reported missing, not certified safe", async () => {
  const { fetchImpl } = mockTransport({ bytecode: "0x" });
  const result = await inspectAerodromeBase({ fetchImpl });
  assert.ok(Object.values(result.codePresent).every(v => v === false));
  assert.equal(result.contractSecurityAudited, false);
});

test("rejects RPC chain mismatch before inspecting any contracts", async () => {
  const { fetchImpl, calls } = mockTransport({ chain: "0x14a34" });
  await assert.rejects(inspectAerodromeBase({ fetchImpl }), expectCode("WRONG_CHAIN"));
  assert.deepEqual(calls.map(c => c.method), ["eth_chainId"]);
});

test("invalid wallet address is rejected before any RPC calls", async () => {
  const { fetchImpl, calls } = mockTransport();
  await assert.rejects(inspectAerodromeBase({
    fetchImpl, publicWalletAddress: "not-an-address",
  }), expectCode("INVALID_ADDRESS"));
  assert.equal(calls.length, 0);
});

test("rejects invalid fetch functions and timeouts without network usage", async () => {
  await assert.rejects(inspectAerodromeBase({ fetchImpl: null }), expectCode("NO_TRANSPORT"));
  const { fetchImpl, calls } = mockTransport();
  await assert.rejects(inspectAerodromeBase({ fetchImpl, timeoutMs: -1 }), expectCode("INVALID_TIMEOUT"));
  assert.equal(calls.length, 0);
});

test("rejects malformed block response rather than returning a snapshot", async () => {
  const { fetchImpl } = mockTransport({ block: "latest" });
  await assert.rejects(inspectAerodromeBase({ fetchImpl }), expectCode("INVALID_RPC_RESULT"));
});

test("rejects malformed or odd-length EVM bytecode", async () => {
  const { fetchImpl } = mockTransport({ bytecode: "0x777" });
  await assert.rejects(inspectAerodromeBase({ fetchImpl }), expectCode("INVALID_RPC_RESULT"));
});

test("rejects malformed token balance and allowance responses", async () => {
  await assert.rejects(inspectAerodromeBase({
    fetchImpl: mockTransport({ balance: "bad" }).fetchImpl,
    publicWalletAddress: WALLET,
  }), expectCode("INVALID_RPC_RESULT"));
  await assert.rejects(inspectAerodromeBase({
    fetchImpl: mockTransport({ allowance: "bad" }).fetchImpl,
    publicWalletAddress: WALLET,
  }), expectCode("INVALID_RPC_RESULT"));
});

test("rejects mismatched response IDs, JSON-RPC errors and HTTP errors", async () => {
  await assert.rejects(inspectAerodromeBase({
    fetchImpl: mockTransport({ corruptId: true }).fetchImpl,
  }), expectCode("INVALID_RPC_RESULT"));
  await assert.rejects(inspectAerodromeBase({
    fetchImpl: mockTransport({ rpcError: true }).fetchImpl,
  }), expectCode("INVALID_RPC_RESULT"));
  await assert.rejects(inspectAerodromeBase({
    fetchImpl: mockTransport({ httpOk: false }).fetchImpl,
  }), expectCode("HTTP_ERROR"));
});

test("all network operations are read-only and do not request wallet credentials", async () => {
  const { fetchImpl, calls } = mockTransport();
  await inspectAerodromeBase({ fetchImpl, publicWalletAddress: WALLET });
  assert.equal(calls.length, 14);
  assert.ok(calls.every(c =>
    ["eth_chainId", "eth_blockNumber", "eth_getCode", "eth_call"].includes(c.method)
  ));
  assert.equal(calls.some(c => /sign|sendTransaction|requestAccounts|privateKey|approve/i.test(c.method)), false);
});

test("code, balances and allowances share the reported block despite advancing latest", async () => {
  const { fetchImpl, calls } = mockTransport({ block: "0x1234" });
  await inspectAerodromeBase({ fetchImpl, publicWalletAddress: WALLET });
  const stateReads = calls.filter(c => ["eth_getCode", "eth_call"].includes(c.method));
  assert.equal(stateReads.length, 12);
  assert.ok(stateReads.every(c => c.params[1] === "0x1234"));
});

test("overflow balances and allowances cannot produce a snapshot", async () => {
  const overflow = "0x1" + "0".repeat(64);
  for (const overrides of [{ balance: overflow }, { allowance: overflow }]) {
    await assert.rejects(inspectAerodromeBase({
      fetchImpl: mockTransport(overrides).fetchImpl, publicWalletAddress: WALLET,
    }), expectCode("INVALID_RPC_RESULT"));
  }
});

test("truncated and trailing ERC-20 return data cannot produce a snapshot", async () => {
  for (const malformed of ["0x0", "0x64", "0x" + "00".repeat(31),
    "0x" + "00".repeat(33), "0x" + "00".repeat(64)]) {
    for (const overrides of [{ balance: malformed }, { allowance: malformed }]) {
      await assert.rejects(inspectAerodromeBase({
        fetchImpl: mockTransport(overrides).fetchImpl, publicWalletAddress: WALLET,
      }), expectCode("INVALID_RPC_RESULT"));
    }
  }
});
