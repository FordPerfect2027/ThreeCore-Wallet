import test from "node:test";
import assert from "node:assert/strict";
import { guardRpcRequest, guardRpcResponse } from "../src/security-rpc.js";
import { TRANSFER_TOPIC, addressTopic } from "../src/transfer-codec.js";
import { ACCOUNT, OTHER, event, rawLog, providerFixture } from "./helpers/transfer-fixtures.js";

const ownOnly = value => new Proxy(value, { get(target, key) {
  if (key === "then") return undefined;
  throw Error("Unexpected live array read: " + String(key));
} });

test("RPC request parameters use bounded own data before normalizing selectors", () => {
  const args = { method: "eth_getBalance", params: [ACCOUNT, "latest"] };
  assert.deepEqual(guardRpcRequest({ ...args, params: ownOnly(args.params) }, { account: ACCOUNT }), args);
});

test("RPC log-filter topics do not invoke live array reads", () => {
  const filter = { address: OTHER, fromBlock: "0x1", toBlock: "0x5", topics: [TRANSFER_TOPIC, null, addressTopic(ACCOUNT)] };
  assert.deepEqual(guardRpcRequest({ method: "eth_getLogs", params: [{ ...filter, topics: ownOnly(filter.topics) }] },
    { account: ACCOUNT, tokenAddress: OTHER }), { method: "eth_getLogs", params: [filter] });
});

test("RPC account results are copied without reading a live length", () => {
  assert.deepEqual(guardRpcResponse("eth_accounts", ownOnly([ACCOUNT])), [ACCOUNT]);
});

test("RPC log rows and nested topics use captured array descriptors", () => {
  const raw = rawLog();
  assert.deepEqual(guardRpcResponse("eth_getLogs", ownOnly([{ ...raw, topics: ownOnly(raw.topics) }])), [raw]);
});

for (const [method, rows, threshold] of [["eth_accounts", [ACCOUNT], 3], ["eth_getLogs", [rawLog()], 4]]) {
  test("a shrinking length cannot turn a nonempty " + method + " result into zero rows", () => {
    let reads = 0;
    const value = new Proxy(rows, { get(target, key, receiver) {
      return key === "length" ? ++reads < threshold ? 1 : 0 : Reflect.get(target, key, receiver);
    } });
    assert.deepEqual(guardRpcResponse(method, value), rows);
    assert.equal(reads, 0);
  });
}

for (const method of ["eth_accounts", "eth_getLogs"]) {
  test("revoked " + method + " arrays receive a bounded public error", () => {
    const { proxy, revoke } = Proxy.revocable([], {}); revoke();
    assert.throws(() => guardRpcResponse(method, proxy), { code: "RPC_RESULT_LIMIT" });
  });
}

test("wallet read cannot publish empty logs because provider length changes", async () => {
  let reads = 0;
  const rows = new Proxy([rawLog()], { get(target, key, receiver) {
    if (key === "length") return ++reads < 4 ? 1 : 0;
    return Reflect.get(target, key, receiver);
  } });
  const fixture = providerFixture({ override: async args => args.method === "eth_getLogs" ? rows : undefined });
  await fixture.session.connect();
  try {
    assert.deepEqual(await fixture.session.getTransferEvents({ fromBlock: "30", toBlock: "42", direction: "incoming" }), [event()]);
    assert.equal(reads, 0);
  } finally { fixture.session.disconnect(); }
});

test("oversized raw logs retain the session's existing public limit error", async () => {
  const fixture = providerFixture({ override: async args => args.method === "eth_getLogs" ? Array(501).fill(rawLog()) : undefined });
  await fixture.session.connect();
  try {
    await assert.rejects(fixture.session.getTransferEvents({ fromBlock: "30", toBlock: "42", direction: "incoming" }),
      { code: "TRANSFER_EVENT_LIMIT" });
  } finally { fixture.session.disconnect(); }
});
