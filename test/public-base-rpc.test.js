import test from "node:test";
import assert from "node:assert/strict";
import { createPublicBaseRpcReader, PublicBaseRpcError } from "../src/public-base-rpc.js";

const rpcUrl = "https://mainnet.base.org", address = "0x" + "1".repeat(40);
const word = address.slice(2).padStart(64, "0");
const rejects = code => error => error instanceof PublicBaseRpcError && error.code === code;

test("diagnostic endpoint validation cannot be replaced with an arbitrary URL", () => {
  let called = false;
  for (const target of ["http://mainnet.base.org", rpcUrl + "/", rpcUrl + ".invalid", "http://127.0.0.1",
    { toString() { throw new Error("must not coerce"); } }]) {
    assert.throws(() => createPublicBaseRpcReader({ rpcUrl: target, fetchImpl() { called = true; } }),
      rejects("UNSUPPORTED_ENDPOINT"));
  }
  assert.throws(() => createPublicBaseRpcReader({ rpcUrl, fetchImpl: null }), rejects("INVALID_TRANSPORT"));
  assert.throws(() => createPublicBaseRpcReader({ rpcUrl, timeoutMs: 99 }), rejects("INVALID_TIMEOUT"));
  assert.equal(called, false);
});

test("write methods, approval selectors, extra transaction fields and latest tags fail before transport", async () => {
  let called = false;
  const read = createPublicBaseRpcReader({ rpcUrl, fetchImpl() { called = true; } });
  for (const method of ["eth_sendTransaction", "eth_sendRawTransaction", "personal_sign", "eth_accounts", "wallet_requestPermissions"])
    await assert.rejects(read(method, []), rejects("METHOD_BLOCKED"));
  for (const [method, params] of [
    ["eth_chainId", [1]], ["eth_blockNumber", null],
    ["eth_getCode", [address, "latest"]], ["eth_getCode", [address, "0x01"]],
    ["eth_getCode", [address, "0x" + "f".repeat(65)]],
    ["eth_call", [{ to: address, data: "0x095ea7b3" + word + word }, "0x1"]],
    ["eth_call", [{ to: address, data: "0xa9059cbb" + word + word }, "0x1"]],
    ["eth_call", [{ to: address, data: "0x70a08231" + word, value: "0x0" }, "0x1"]],
    ["eth_call", [{ to: address, data: "0x70a08231" + word, from: address }, "0x1"]],
    ["eth_call", [{ to: address, data: "0x70a08231" + "f".repeat(64) }, "0x1"]],
    ["eth_call", [{ to: address, data: "0x79bc57d5" + word + word + "2".padStart(64, "0") }, "0x1"]],
    ["eth_call", [{ to: address, data: "0x0dfe168100" }, "0x1"]],
  ]) await assert.rejects(read(method, params), rejects("INVALID_PARAMS"));
  assert.equal(called, false);
});

test("only established read selectors are accepted with canonical ABI arguments", async () => {
  const calls = [];
  const read = createPublicBaseRpcReader({ rpcUrl, fetchImpl: async (url, options) => {
    const request = JSON.parse(options.body); calls.push(request);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0x" }));
  } });
  for (const data of ["0x0dfe1681", "0xd21220a7", "0x0902f1ac", "0x70a08231" + word,
    "0xdd62ed3e" + word + word, "0x79bc57d5" + word + word + "0".repeat(64),
    "0x79bc57d5" + word + word + "1".padStart(64, "0")])
    assert.equal(await read("eth_call", [{ to: address, data }, "0x0"]), "0x");
  assert.equal(calls.length, 7);
  assert.ok(calls.every(c => c.params[1] === "0x0"));
});
