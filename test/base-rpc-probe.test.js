import test from "node:test";
import assert from "node:assert/strict";
import {
  BASE_NETWORKS, BaseRpcProbeError, probeBaseRpc,
} from "../src/base-rpc-probe.js";

const CONTRACT = "0x1111111111111111111111111111111111111111";
function transport({
  chainId = "0x14a34",
  block = "0x1234",
  code = "0x60006000",
  error = null,
  invalidResponse = false,
  httpOk = true,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, args) => {
    assert.equal(args.method, "POST");
    assert.equal(args.headers["content-type"], "application/json");
    assert.ok(args.signal);
    const body = JSON.parse(args.body);
    calls.push({ url, ...body });
    return {
      ok: httpOk,
      async json() {
        if (invalidResponse) return { jsonrpc: "2.0", id: body.id + 1, result: "0x1" };
        if (error) return { jsonrpc: "2.0", id: body.id, error };
        const result = {
          eth_chainId: chainId,
          eth_blockNumber: block,
          eth_getCode: code,
        }[body.method];
        if (result == null) throw new Error("Unallowed RPC method: " + body.method);
        return { jsonrpc: "2.0", id: body.id, result };
      },
    };
  };
  return { calls, fetchImpl };
}

function code(value) {
  return (error) => error instanceof BaseRpcProbeError && error.code === value;
}

test("expected Base RPC endpoints are fixed to official public HTTPS hosts", () => {
  assert.equal(BASE_NETWORKS.mainnet.rpcUrl, "https://mainnet.base.org");
  assert.equal(BASE_NETWORKS.sepolia.rpcUrl, "https://sepolia.base.org");
  assert.equal(BASE_NETWORKS.mainnet.chainId, 8453);
  assert.equal(BASE_NETWORKS.sepolia.chainId, 84532);
  assert.ok(Object.isFrozen(BASE_NETWORKS));
});

test("checks Base Sepolia chain and latest block without touching wallets", async () => {
  const { calls, fetchImpl } = transport();
  const result = await probeBaseRpc({ fetchImpl });
  assert.deepEqual(result, {
    network: "sepolia",
    chainId: 84532,
    rpcUrl: BASE_NETWORKS.sepolia.rpcUrl,
    observedBlockNumber: "4660",
    readOnly: true,
    walletConnected: false,
    externalDappIntegrated: false,
  });
  assert.deepEqual(calls.map((item) => item.method), ["eth_chainId", "eth_blockNumber"]);
  assert.ok(calls.every((item) => item.url === BASE_NETWORKS.sepolia.rpcUrl));
  assert.ok(Object.isFrozen(result));
});

test("checks Base Mainnet chain without transactions or account access", async () => {
  const { calls, fetchImpl } = transport({ chainId: "0x2105" });
  const result = await probeBaseRpc({ network: "mainnet", fetchImpl });
  assert.equal(result.chainId, 8453);
  assert.deepEqual(calls.map((item) => item.method), ["eth_chainId", "eth_blockNumber"]);
});

test("optionally checks deployed contract code by public address", async () => {
  const { calls, fetchImpl } = transport();
  const result = await probeBaseRpc({ fetchImpl, contractAddress: CONTRACT.toUpperCase().replace("0X", "0x") });
  assert.equal(result.contractAddress, CONTRACT);
  assert.equal(result.contractCodePresent, true);
  assert.deepEqual(calls[2].params, [CONTRACT, "latest"]);
  assert.deepEqual(calls.map((x) => x.method), ["eth_chainId", "eth_blockNumber", "eth_getCode"]);
});

test("empty address code does not indicate a deployed contract", async () => {
  const { fetchImpl } = transport({ code: "0x" });
  const result = await probeBaseRpc({ fetchImpl, contractAddress: CONTRACT });
  assert.equal(result.contractCodePresent, false);
});

test("wrong RPC chain fails closed before reading block or contract", async () => {
  const { calls, fetchImpl } = transport({ chainId: "0x1" });
  await assert.rejects(probeBaseRpc({ fetchImpl, contractAddress: CONTRACT }), code("CHAIN_MISMATCH"));
  assert.deepEqual(calls.map((x) => x.method), ["eth_chainId"]);
});

test("rejects unsupported network before any request", async () => {
  const { calls, fetchImpl } = transport();
  await assert.rejects(probeBaseRpc({ network: "ethereum", fetchImpl }), code("UNSUPPORTED_NETWORK"));
  assert.equal(calls.length, 0);
});

test("invalid contract address stops before a network request", async () => {
  const { calls, fetchImpl } = transport();
  await assert.rejects(probeBaseRpc({ contractAddress: "not-an-address", fetchImpl }), code("INVALID_ADDRESS"));
  assert.equal(calls.length, 0);
});

test("rejects invalid timeout and transport before a request", async () => {
  await assert.rejects(probeBaseRpc({ timeoutMs: 99999 }), code("INVALID_TIMEOUT"));
  await assert.rejects(probeBaseRpc({ fetchImpl: null }), code("INVALID_TRANSPORT"));
});

test("rejects malformed and mismatched RPC response IDs", async () => {
  const { fetchImpl } = transport({ invalidResponse: true });
  await assert.rejects(probeBaseRpc({ fetchImpl }), code("INVALID_RPC_RESPONSE"));
});

test("rejects JSON-RPC errors and failed HTTP status", async () => {
  await assert.rejects(probeBaseRpc({ fetchImpl: transport({ error: { code: -32000, message: "failed" } }).fetchImpl }), code("INVALID_RPC_RESPONSE"));
  await assert.rejects(probeBaseRpc({ fetchImpl: transport({ httpOk: false }).fetchImpl }), code("HTTP_ERROR"));
});

test("rejects invalid block and contract bytecode responses", async () => {
  await assert.rejects(probeBaseRpc({ fetchImpl: transport({ block: "INVALID" }).fetchImpl }), code("INVALID_RPC_RESPONSE"));
  await assert.rejects(probeBaseRpc({ fetchImpl: transport({ code: "0x12f" }).fetchImpl, contractAddress: CONTRACT }), code("INVALID_RPC_RESPONSE"));
});

test("all paths use only three read-only public JSON-RPC methods", async () => {
  const { calls, fetchImpl } = transport();
  await probeBaseRpc({ fetchImpl, contractAddress: CONTRACT });
  for (const call of calls) {
    assert.ok(["eth_chainId", "eth_blockNumber", "eth_getCode"].includes(call.method));
    assert.ok(!/send|sign|approve|personal/i.test(call.method));
  }
});
