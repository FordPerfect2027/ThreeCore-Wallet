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

test("public batch additions permit only explicit native-balance and argument-free metadata reads", async () => {
  const calls=[];const read=createPublicBaseRpcReader({rpcUrl,fetchImpl:async(url,options)=>{const q=JSON.parse(options.body);calls.push(q);
    return Response.json({jsonrpc:"2.0",id:q.id,result:q.method==="eth_getBalance"?"0x0":"0x"});}});
  assert.equal(await read("eth_getBalance",[address,"0x1"]),"0x0");
  for(const data of ["0x06fdde03","0x95d89b41","0x313ce567","0x18160ddd"])
    await read("eth_call",[{to:address,data},{blockHash:"0x"+"ab".repeat(32),requireCanonical:true}]);
  const count=calls.length;
  for(const params of [[address,"latest"],["bad","0x1"],[address,"0x01"],[address,"0x1","extra"]])
    await assert.rejects(read("eth_getBalance",params),rejects("INVALID_PARAMS"));
  await assert.rejects(read("eth_call",[{to:address,data:"0x313ce56700"},"0x1"]),rejects("INVALID_PARAMS"));
  assert.equal(calls.length,count);
});

test("canonical hash selectors require complete own data and cannot execute accessors", async () => {
  let calls = 0, getterCalls = 0;
  const read = createPublicBaseRpcReader({ rpcUrl, fetchImpl: async (_url, options) => {
    calls++; const request = JSON.parse(options.body);
    assert.deepEqual(request.params[1], { blockHash: "0x" + "ab".repeat(32), requireCanonical: true });
    return Response.json({ jsonrpc: "2.0", id: request.id, result: "0x6000" });
  } });
  const hash = "0x" + "ab".repeat(32);
  for (const selector of [{ blockHash: hash, requireCanonical: false },
    { blockHash: hash }, { blockHash: "0x12", requireCanonical: true },
    { blockHash: hash, requireCanonical: true, blockNumber: "0x1" },
    { get blockHash() { getterCalls++; return hash; }, requireCanonical: true }])
    await assert.rejects(read("eth_getCode", [address, selector]), rejects("INVALID_PARAMS"));
  assert.equal(calls, 0); assert.equal(getterCalls, 0);
  assert.equal(await read("eth_getCode", [address, { blockHash: hash, requireCanonical: true }]), "0x6000");
  assert.equal(calls, 1);
});
test("header reads reject latest, full transaction requests and a mismatched returned height", async () => {
  let calls = 0;
  const read = createPublicBaseRpcReader({ rpcUrl, fetchImpl: async (_url, options) => {
    calls++; const request = JSON.parse(options.body);
    return Response.json({ jsonrpc: "2.0", id: request.id, result: { number: "0x2", hash: "0x" + "ab".repeat(32) } });
  } });
  for (const params of [["latest", false], ["0x1", true], ["0x01", false]])
    await assert.rejects(read("eth_getBlockByNumber", params), rejects("INVALID_PARAMS"));
  assert.equal(calls, 0);
  await assert.rejects(read("eth_getBlockByNumber", ["0x1", false]), rejects("INVALID_RPC_RESPONSE"));
  assert.equal(calls, 1);
});
