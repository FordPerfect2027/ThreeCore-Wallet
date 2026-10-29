import test from "node:test";
import assert from "node:assert/strict";
import { inspectAerodromeBase, AerodromeReadError, AERODROME_BASE } from "../src/aerodrome-readonly.js";
import { inspectAerodromePools, AerodromePoolReadError } from "../src/aerodrome-pools.js";
import { STATE_RPC_RESPONSE_LIMIT } from "../src/state-rpc-http.js";
import { RPC_SECURITY_LIMITS } from "../src/security-rpc.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
const wallet = "0x" + "1".repeat(40), pool = "0x" + "a".repeat(40);
const addressWord = "0x" + pool.slice(2).padStart(64, "0");
const entries = [
  ["holdings", inspectAerodromeBase, AerodromeReadError],
  ["pools", inspectAerodromePools, AerodromePoolReadError],
];
for (const [name, inspect, ErrorType] of entries) {
  const fails = code => error => error instanceof ErrorType && error.code === code;
  function mock(change = () => undefined) {
    const calls = [];
    const fetchImpl = async (url, options) => {
      assert.equal(url, AERODROME_BASE.rpcUrl);
      const request = JSON.parse(options.body); calls.push({ ...request, options });
      const replacement = change(request);
      if (replacement !== undefined) return replacement;
      const result = request.method === "eth_chainId" ? "0x2105" :
        request.method === "eth_blockNumber" ? "0x1234" :
        request.method === "eth_getCode" ? "0x6000" : "0x" + "0".repeat(64);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
    };
    return { fetchImpl, calls };
  }
  test(name + ": noncanonical and oversized block values stop state reads", async () => {
    for (const result of ["0x00", "0x0123", "0x" + "f".repeat(65), "0X12", "0x"]) {
      const m = mock(r => r.method === "eth_blockNumber" ?
        new Response(JSON.stringify({ jsonrpc: "2.0", id: r.id, result })) : undefined);
      await assert.rejects(inspect(m), fails("INVALID_RPC_RESULT"));
      assert.equal(m.calls.length, 2);
    }
  });
  test(name + ": advertised and streamed overflow are cancelled without returning a report", async () => {
    for (const declared of [true, false]) {
      let cancelled = false, read = false;
      const body = declared ? { cancel() { cancelled = true; }, getReader() { read = true; } } :
        new ReadableStream({ pull(c) { read = true; c.enqueue(new Uint8Array(STATE_RPC_RESPONSE_LIMIT + 1)); },
          cancel() { cancelled = true; } });
      await assert.rejects(inspect({ fetchImpl: async () => declared ? {
        ok: true, headers: new Headers({ "content-length": String(STATE_RPC_RESPONSE_LIMIT + 1) }), body,
      } : new Response(body) }), fails("INVALID_RPC_RESULT"));
      assert.equal(cancelled, true); assert.equal(read, !declared);
    }
  });
  test(name + ": malformed envelopes and unsafe JSON cannot become empty readings", async () => {
    for (const raw of [new Uint8Array([255]),
      '{"jsonrpc":"2.0","id":1,"result":"0x2105","result":"0x2105"}',
      '{"jsonrpc":"2.0","id":1,"result":"0x2105","error":null}',
      '{"jsonrpc":"2.0","id":1,"result":"0x2105","error":false}',
      '{"jsonrpc":"2.0","id":"1","result":"0x2105"}',
      '{"jsonrpc":"2.0","id":1,"result":"0x2105","constructor":{}}']) {
      await assert.rejects(inspect({ fetchImpl: async () => new Response(raw) }), fails("INVALID_RPC_RESULT"));
    }
  });
  test(name + ": timeout stops an uncooperative initial fetch and cancels a late response", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let release, signal, cancelled = false, calls = 0;
    const pending = inspect({ timeoutMs: 100, fetchImpl: (_url, options) => {
      signal = options.signal; calls++; return new Promise(resolve => { release = resolve; });
    } });
    const rejected = assert.rejects(pending, fails("RPC_TIMEOUT"));
    t.mock.timers.tick(100); await rejected; assert.equal(signal.aborted, true);
    release({ ok: true, body: { cancel() { cancelled = true; return new Promise(() => {}); } } });
    await tick(); assert.equal(cancelled, true); assert.equal(calls, 1);
  });
  test(name + ": timeout includes a stalled body even when cancellation never resolves", async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let cancelled = false, calls = 0;
    const stream = new ReadableStream({ pull() { return new Promise(() => {}); },
      cancel() { cancelled = true; return new Promise(() => {}); } });
    const pending = inspect({ timeoutMs: 100, fetchImpl: async () => { calls++; return new Response(stream); } });
    const rejected = assert.rejects(pending, fails("RPC_TIMEOUT"));
    await tick(); t.mock.timers.tick(100); await rejected;
    assert.equal(cancelled, true); assert.equal(calls, 1);
  });
  test(name + ": HTTP refusal and redirect do not parse a body or return a partial report", async () => {
    for (const status of [{ ok: false }, { ok: true, redirected: true }]) {
      let cancelled = false;
      await assert.rejects(inspect({ fetchImpl: async () => ({ ...status,
        body: { cancel() { cancelled = true; return new Promise(() => {}); } },
      }) }), fails("HTTP_ERROR"));
      assert.equal(cancelled, true);
    }
  });
  test(name + ": transport errors are sanitized, with no fallback to zero", async () => {
    const m = mock(r => { if (r.method !== "eth_chainId") throw new Error("PRIVATE_PROVIDER_DETAIL"); });
    await assert.rejects(inspect(m), error => {
      assert.ok(error instanceof ErrorType); assert.equal(error.code, "RPC_TRANSPORT");
      assert.doesNotMatch(error.message, /PRIVATE_PROVIDER_DETAIL/); return true;
    });
    assert.equal(m.calls.length, 2);
  });
  test(name + ": oversized code is rejected before later inspection calls", async () => {
    const m = mock(r => {
      if (r.method === "eth_call") return new Response(JSON.stringify({ jsonrpc: "2.0", id: r.id, result: addressWord }));
      if (r.method === "eth_getCode") return new Response(JSON.stringify({ jsonrpc: "2.0", id: r.id,
        result: "0x" + "00".repeat(RPC_SECURITY_LIMITS.contractCodeCharacters / 2) }));
    });
    await assert.rejects(inspect(m), fails("INVALID_RPC_RESULT"));
    assert.equal(m.calls.at(-1).method, "eth_getCode");
  });
  test(name + ": successful reads exclude credentials and pin every state call to one block", async () => {
    const m = mock();
    await inspect({ ...m, publicWalletAddress: wallet });
    for (const r of m.calls) {
      assert.equal(r.options.credentials, "omit"); assert.equal(r.options.redirect, "error");
      assert.equal(r.options.cache, "no-store"); assert.equal(r.options.referrerPolicy, "no-referrer");
      assert.equal(r.options.signal.aborted, true);
      if (["eth_call", "eth_getCode"].includes(r.method)) assert.equal(r.params[1], "0x1234");
    }
    assert.equal(m.calls.length, name === "holdings" ? 14 : 8);
  });
  test(name + ": a failure on the last read discards earlier successful observations", async () => {
    const finalId = name === "holdings" ? 14 : 8;
    const m = mock(r => r.id === finalId ? new Response(JSON.stringify({
      jsonrpc: "2.0", id: r.id, error: { code: -32000, message: "upstream unavailable" },
    })) : undefined);
    let report;
    await assert.rejects(async () => { report = await inspect({ ...m, publicWalletAddress: wallet }); },
      fails("INVALID_RPC_RESULT"));
    assert.equal(m.calls.length, finalId);
    assert.equal(report, undefined);
  });
}
