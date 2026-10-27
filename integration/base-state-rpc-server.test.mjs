import test from "node:test";
import assert from "node:assert/strict";
import { createDemoServer } from "../examples/dev-server.js";
import { createBaseStateProvider } from "../src/base-state-provider.js";
import { ThreeCoreWalletSession } from "../src/wallet-session.js";
const A = "0x1111111111111111111111111111111111111111";
const HASH = "0x" + "ab".repeat(32);
const rpc = { method: "eth_getBalance", params: [A, { blockHash: HASH, requireCanonical: true }] };
const envelope = request => ({ agent: "DAT", account: A, request });
async function withServer(upstream, fn) {
  const server = createDemoServer({ stateFetch: upstream });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const post = (base, data, extra = {}) => fetch(base + "/rpc/base-mainnet", { method: "POST",
  headers: { origin: base, "content-type": "application/json", ...extra }, body: typeof data === "string" ? data : JSON.stringify(data) });

test("RPC relay targets only official Base and preserves the canonical hash selector", async () => {
  let seen;
  await withServer(async (url, options) => { seen = { url, options }; return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2a" }); }, async base => {
    const result = await post(base, envelope(rpc));
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { result: "0x2a" });
    assert.equal(seen.url, "https://mainnet.base.org");
    assert.equal(seen.options.redirect, "error"); assert.equal(seen.options.credentials, "omit");
    assert.deepEqual(JSON.parse(seen.options.body), { jsonrpc: "2.0", id: 1, ...rpc });
  });
});

test("origin, permission/write methods, destination injection and malformed input cannot reach upstream", async () => {
  let calls = 0;
  await withServer(async () => { calls++; }, async base => {
    assert.equal((await post(base, envelope(rpc), { origin: "https://evil.example" })).status, 403);
    assert.equal((await fetch(base + "/rpc/base-mainnet", { method: "POST", body: JSON.stringify(envelope(rpc)), headers: { "content-type": "application/json" } })).status, 403);
    for (const method of ["eth_accounts", "eth_requestAccounts", "eth_sendTransaction", "personal_sign", "wallet_switchEthereumChain"]) {
      assert.equal((await post(base, envelope({ method }))).status, 400, method);
    }
    assert.equal((await post(base, { ...envelope(rpc), url: "https://evil.example" })).status, 400);
    assert.equal((await post(base, { ...envelope(rpc), agent: "unknown" })).status, 400);
    assert.equal((await post(base, '{"agent":"DAT","agent":"EMA"}')).status, 400);
    assert.equal((await post(base, "x".repeat(8193))).status, 413);
    assert.equal(calls, 0);
  });
});

test("remote failures and mismatched response IDs never become a successful result", async () => {
  for (const reply of [{ jsonrpc: "2.0", id: 2, result: "0x1" },
    { jsonrpc: "2.0", id: 1, error: { message: "secret malicious instructions" } }]) {
    await withServer(async () => Response.json(reply), async base => {
      const result = await post(base, envelope(rpc)); assert.equal(result.status, 502);
      assert.deepEqual(await result.json(), { error: "STATE_RPC_UNAVAILABLE" });
    });
  }
});

test("full wallet + HTTP state path succeeds although the wallet rejects all state calls", async () => {
  const walletCalls = [], stateCalls = [];
  await withServer(async (_url, options) => {
    const request = JSON.parse(options.body); stateCalls.push(request);
    const result = request.method === "eth_chainId" ? "0x2105" : request.method === "eth_getBlockByNumber"
      ? { number: "0x100", hash: HASH } : "0x2a";
    return Response.json({ jsonrpc: "2.0", id: request.id, result });
  }, async base => {
    const provider = { async request(args) {
      walletCalls.push(args);
      if (args.method === "eth_chainId") return "0x2105";
      if (["eth_accounts", "eth_requestAccounts"].includes(args.method)) return [A];
      throw TypeError("c.slice is not a function");
    } };
    const stateProvider = createBaseStateProvider({ agent: "DAT", account: A, siteOrigin: base,
      fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, origin: base } }) });
    const session = new ThreeCoreWalletSession({ provider, stateProvider, agent: "DAT", siteOrigin: base,
      approvedOrigins: [base], expectedAccount: A, chainId: 8453 });
    try {
      await session.connect(); const block = await session.getBlockSnapshot();
      assert.equal(await session.getNativeBalance(block.hash), 42n);
      assert.ok(walletCalls.every(r => ["eth_chainId", "eth_accounts", "eth_requestAccounts"].includes(r.method)));
      assert.deepEqual(stateCalls.find(r => r.method === "eth_getBalance").params[1], { blockHash: HASH, requireCanonical: true });
    } finally { session.disconnect(); }
  });
});

test("relay caps concurrent upstream work and releases capacity after completion", async () => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  let calls = 0, released = false;
  await withServer(async () => {
    calls++; if (calls === 12) entered.resolve();
    if (!released) await release.promise;
    return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2a" });
  }, async base => {
    const pending = Array.from({ length: 12 }, () => post(base, envelope(rpc)));
    try {
      await entered.promise;
      assert.equal((await post(base, envelope(rpc))).status, 429);
      assert.equal(calls, 12);
    } finally { released = true; release.resolve(); }
    for (const response of await Promise.all(pending)) {
      assert.equal(response.status, 200); await response.text();
    }
    const next = await post(base, envelope(rpc));
    assert.equal(next.status, 200); await next.text(); assert.equal(calls, 13);
  });
});

test("closing the client aborts outstanding upstream work", async () => {
  const entered = Promise.withResolvers(), aborted = Promise.withResolvers();
  let calls = 0;
  await withServer(async (_url, options) => {
    if (++calls > 1) return Response.json({ jsonrpc: "2.0", id: 1, result: "0x2a" });
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => { aborted.resolve(); reject(Error("aborted")); }, { once: true });
      entered.resolve();
    });
  }, async base => {
    const aborter = new AbortController();
    const pending = fetch(base + "/rpc/base-mainnet", { method: "POST", signal: aborter.signal,
      headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(envelope(rpc)) });
    const rejected = assert.rejects(pending);
    await entered.promise; aborter.abort(); await rejected; await aborted.promise;
    const next = await post(base, envelope(rpc)); assert.equal(next.status, 200); await next.text();
  });
});
