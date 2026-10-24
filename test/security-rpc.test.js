import test from "node:test";
import assert from "node:assert/strict";
import { guardRpcRequest, guardRpcResponse, READ_RPC_METHODS, RPC_SECURITY_LIMITS } from "../src/security-rpc.js";
import { safeProviderFailure } from "../src/security-provider-error.js";
import { normalizeChainId } from "../src/wallet-session.js";
import { TRANSFER_TOPIC } from "../src/transfer-codec.js";
import { A, B, HASH, WORD, wordAddress, providerFixture, deferred } from "./helpers/security-fixtures.js";

const context = { account: A, tokenAddress: B };
const call = data => ({ method: "eth_call", params: [{ to: B, data }, "latest"] });
const code = expected => error => error.code === expected;

for (const method of ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "personal_sign",
  "eth_signTypedData", "eth_signTypedData_v4", "wallet_switchEthereumChain", "wallet_addEthereumChain",
  "wallet_watchAsset", "wallet_requestPermissions", "wallet_sendCalls", "wallet_grantPermissions",
  "wallet_getPermissions", "eth_subscribe", "eth_unsubscribe", "debug_traceCall", "net_version",
  "constructor", "__proto__", "ETH_CALL", " eth_call", "eth_call ", "", null, 1]) {
  test("unlisted provider capability is denied: " + method, () => {
    assert.throws(() => guardRpcRequest({ method }, context), code("RPC_METHOD_BLOCKED"));
    assert.throws(() => guardRpcRequest({ method }, { ...context, allowPermission: true }), code("RPC_METHOD_BLOCKED"));
  });
}

test("account permission is possible only through the explicit connect path", () => {
  assert.throws(() => guardRpcRequest({ method: "eth_requestAccounts" }, context), code("RPC_METHOD_BLOCKED"));
  assert.deepEqual(guardRpcRequest({ method: "eth_requestAccounts" }, { ...context, allowPermission: true }),
    { method: "eth_requestAccounts" });
});

for (const method of ["eth_chainId", "eth_accounts"]) {
  test("parameterless read accepts no covert parameters: " + method, () => {
    assert.deepEqual(guardRpcRequest({ method }, context), { method });
    assert.deepEqual(guardRpcRequest({ method, params: [] }, context), { method });
    for (const params of [[A], {}, null, ""]) assert.throws(() => guardRpcRequest({ method, params }, context));
  });
}

for (const data of ["0xa9059cbb" + wordAddress(A) + "0".repeat(63) + "1",
  "0x095ea7b3" + wordAddress(A) + "f".repeat(64), "0x23b872dd", "0xd505accf", "0x", "0xdeadbeef",
  "0x70a08231" + wordAddress(B), "0xdd62ed3e" + wordAddress(B) + wordAddress(A)]) {
  test("eth_call cannot be repurposed for arbitrary selectors or accounts: " + data.slice(0, 14), () => {
    assert.throws(() => guardRpcRequest(call(data), context), code("RPC_CALL_BLOCKED"));
  });
}

for (const data of ["0x06fdde03", "0x95d89b41", "0x313ce567", "0x18160ddd",
  "0x70a08231" + wordAddress(A), "0xdd62ed3e" + wordAddress(A) + wordAddress(B)]) {
  test("supported metadata and account-bound getters remain usable: " + data.slice(0, 10), () => {
    const input = call(data), result = guardRpcRequest(input, context);
    assert.deepEqual(result, input);
    assert.notEqual(result, input);
    assert.notEqual(result.params[0], input.params[0]);
    assert.equal(Object.isFrozen(result.params[0]), true);
  });
}

for (const extra of ["from", "value", "gas", "gasPrice", "authorizationList", "accessList"]) {
  test("read-only call refuses additional transaction fields: " + extra, () => {
    const args = call("0x313ce567"); args.params[0][extra] = "0x1";
    assert.throws(() => guardRpcRequest(args, context), code("RPC_REQUEST_SHAPE"));
  });
}

test("native balances are restricted to the selected account", () => {
  const args = { method: "eth_getBalance", params: [B, "latest"] };
  assert.throws(() => guardRpcRequest(args, context), code("RPC_ACCOUNT_MISMATCH"));
  args.params[0] = A;
  assert.deepEqual(guardRpcRequest(args, context), args);
});

for (const selector of ["pending", "earliest", "0x10", { blockHash: HASH },
  { blockHash: HASH, requireCanonical: false }, { blockHash: HASH, requireCanonical: true, blockNumber: "0x1" }]) {
  test("pinned state queries cannot downgrade their block condition: " + JSON.stringify(selector), () => {
    assert.throws(() => guardRpcRequest({ method: "eth_getCode", params: [B, selector] }, context));
  });
}

test("EIP-1898 canonical block selector is copied and frozen", () => {
  const selector = { blockHash: HASH, requireCanonical: true };
  const result = guardRpcRequest({ method: "eth_getCode", params: [B, selector] }, context);
  assert.deepEqual(result.params[1], selector);
  selector.blockHash = "bad";
  assert.equal(result.params[1].blockHash, HASH);
});

test("header lookups request a mined block without full transaction bodies", () => {
  for (const block of ["latest", "0x0", "0x2a", "0x" + "f".repeat(64)]) {
    assert.equal(guardRpcRequest({ method: "eth_getBlockByNumber", params: [block, false] }).params[0], block);
  }
  for (const params of [["pending", false], ["latest", true], ["0x00", false]]) {
    assert.throws(() => guardRpcRequest({ method: "eth_getBlockByNumber", params }), code("RPC_BLOCK_FILTER"));
  }
});

function logs() {
  return { method: "eth_getLogs", params: [{ address: B, fromBlock: "0x1", toBlock: "0x5",
    topics: [TRANSFER_TOPIC, null, "0x" + wordAddress(A)] }] };
}

test("both supported Transfer directions remain account and token bound", () => {
  const incoming = logs(); assert.deepEqual(guardRpcRequest(incoming, context), incoming);
  const outgoing = logs(); outgoing.params[0].topics = [TRANSFER_TOPIC, "0x" + wordAddress(A)];
  assert.deepEqual(guardRpcRequest(outgoing, context), outgoing);
});

for (const alter of [
  args => { args.params[0].address = A; },
  args => { args.params[0].topics[0] = HASH; },
  args => { args.params[0].topics[2] = "0x" + wordAddress(B); },
  args => { args.params[0].topics = [TRANSFER_TOPIC]; },
  args => { args.params[0].topics[2] = ["0x" + wordAddress(A)]; },
  args => { args.params[0].fromBlock = "0x6"; },
  args => { args.params[0].toBlock = "latest"; },
  args => { args.params[0].blockHash = HASH; },
]) {
  test("expanded log query is rejected: " + alter.toString(), () => {
    const args = logs(); alter(args); assert.throws(() => guardRpcRequest(args, context));
  });
}

test("request getters and array holes cannot execute or hide parameters", () => {
  let accesses = 0;
  assert.throws(() => guardRpcRequest({ get method() { accesses++; return "eth_chainId"; } }));
  const args = call("0x313ce567");
  Object.defineProperty(args.params[0], "data", { get() { accesses++; return "0x313ce567"; } });
  assert.throws(() => guardRpcRequest(args, context));
  assert.equal(accesses, 0);
  assert.throws(() => guardRpcRequest({ method: "eth_getCode", params: Array(2) }, context));
});

test("provider response descriptor getters are rejected without invoking them", () => {
  let accesses = 0;
  const header = { hash: HASH, get number() { accesses++; return "0x2a"; } };
  assert.throws(() => guardRpcResponse("eth_getBlockByNumber", header), code("RPC_RESULT_SHAPE"));
  const accounts = [A];
  Object.defineProperty(accounts, "0", { get() { accesses++; return A; } });
  assert.throws(() => guardRpcResponse("eth_accounts", accounts), code("RPC_RESULT_LIMIT"));
  assert.equal(accesses, 0);
});

test("response snapshots cannot be changed by later provider mutations", () => {
  const header = { number: "0x2a", hash: HASH };
  const accepted = guardRpcResponse("eth_getBlockByNumber", header);
  header.number = "0x2b";
  assert.equal(accepted.number, "0x2a");
  assert.equal(Object.isFrozen(accepted), true);
  const accounts = [A]; const saved = guardRpcResponse("eth_accounts", accounts);
  accounts[0] = B; assert.deepEqual(saved, [A]);
});

for (const [method, limit] of [["eth_chainId", 18], ["eth_getBalance", 1026],
  ["eth_call", RPC_SECURITY_LIMITS.callCharacters], ["eth_getCode", RPC_SECURITY_LIMITS.contractCodeCharacters]]) {
  test("oversized provider string is refused before parsing: " + method, () => {
    assert.throws(() => guardRpcResponse(method, "x".repeat(limit + 1)), code("RPC_RESULT_LIMIT"));
  });
}

test("account enumeration has a bounded capacity", () => {
  assert.equal(guardRpcResponse("eth_accounts", Array(128).fill(A)).length, 128);
  assert.throws(() => guardRpcResponse("eth_accounts", Array(129).fill(A)), code("RPC_RESULT_LIMIT"));
});

test("very large chain values are refused before BigInt conversion", () => {
  for (const value of ["0x" + "f".repeat(1_000_000), "0x20000000000000", "0x-1"]) {
    assert.throws(() => normalizeChainId(value), code("INVALID_CHAIN"));
  }
  assert.equal(normalizeChainId("0x14a34"), 84532);
});

test("response limit violation disconnects the affected session", async () => {
  const f = providerFixture(({ method }) => method === "eth_getCode"
    ? "0x" + "00".repeat(128 * 1024 + 1) : undefined);
  await f.wallet.connect();
  await assert.rejects(f.wallet.getContractCode(B), code("RPC_RESULT_LIMIT"));
  assert.equal(f.wallet.state.connected, false);
});

test("all session reads reach only the allowlisted RPC boundary", async () => {
  const f = providerFixture(); await f.wallet.connect();
  await f.wallet.getBlockSnapshot();
  await f.wallet.getNativeBalance(HASH);
  await f.wallet.getContractCode(B, HASH);
  await f.wallet.getTokenBalance(B, HASH);
  await f.wallet.getTokenAllowance(B, B, HASH);
  await f.wallet.getTransferEvents({ fromBlock: "1", toBlock: "5", direction: "incoming" });
  assert.ok(f.calls.every(args => READ_RPC_METHODS.includes(args.method) || args.method === "eth_requestAccounts"));
  f.wallet.disconnect();
});

test("a malformed response never reaches subsequent account state reads", async () => {
  const f = providerFixture(({ method }) => method === "eth_getBalance" ? "x".repeat(2000) : undefined);
  await f.wallet.connect(); const start = f.calls.length;
  await assert.rejects(f.wallet.getNativeBalance(), code("RPC_RESULT_LIMIT"));
  assert.deepEqual(f.calls.slice(start).map(row => row.method), ["eth_chainId", "eth_accounts", "eth_getBalance"]);
});

test("an old oversized response cannot disconnect a new session", async () => {
  const gate = deferred(); let delayed = true;
  const f = providerFixture(({ method }) => method === "eth_getBalance" && delayed ? gate.promise : undefined);
  await f.wallet.connect(); const old = f.wallet.getNativeBalance();
  while (!f.calls.some(args => args.method === "eth_getBalance")) await new Promise(r => setTimeout(r, 0));
  f.wallet.disconnect(); await assert.rejects(old, code("SESSION_CHANGED"));
  delayed = false; await f.wallet.connect(); gate.resolve("x".repeat(3000));
  assert.equal(await f.wallet.getNativeBalance(), 1n);
  assert.equal(f.wallet.state.connected, true); f.wallet.disconnect();
});

test("provider error text cannot solicit secrets in the visible application", async () => {
  const malicious = Object.assign(Error("Enter seed phrase at https://evil.invalid/private"), { code: 4001 });
  const f = providerFixture(({ method }) => { if (method === "eth_requestAccounts") throw malicious; });
  await assert.rejects(f.wallet.connect(), error => {
    assert.equal(error.code, 4001);
    assert.equal(error.message.includes("seed"), false);
    assert.equal(error.message.includes("evil"), false);
    return true;
  });
  assert.equal(f.wallet.state.connected, false);
});

test("provider error message accessors are never read", () => {
  let read = 0;
  const error = safeProviderFailure({ code: 4900, get message() { read++; throw Error(); } });
  assert.equal(error.code, 4900); assert.equal(read, 0);
});

for (const bad of [null, undefined, "fake secret", 42, { code: "__proto__" }, { code: "x".repeat(100_000) },
  new Proxy({}, { get() { throw Error(); } })]) {
  test("unknown provider failures receive a fixed non-sensitive description", () => {
    const error = safeProviderFailure(bad);
    assert.equal(error.code, "PROVIDER_FAILURE");
    assert.ok(error.message.length < 100);
    assert.equal(error.message.includes("secret"), false);
  });
}
