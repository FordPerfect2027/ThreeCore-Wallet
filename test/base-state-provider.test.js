import test from "node:test";
import assert from "node:assert/strict";
import { createBaseStateProvider } from "../src/base-state-provider.js";
import { readStateRpcJson, STATE_RPC_RESPONSE_LIMIT, STATE_RPC_TIMEOUT_MS } from "../src/state-rpc-http.js";
const A = "0x1111111111111111111111111111111111111111";
const HASH = "0x" + "ab".repeat(32);
const request = { method: "eth_getBalance", params: [A, { blockHash: HASH, requireCanonical: true }] };
function provider(fetchImpl) { return createBaseStateProvider({ agent: "DAT", account: A, siteOrigin: "http://127.0.0.1:4230", fetchImpl }); }

test("state transport uses only the fixed same-origin route with no credentials", async () => {
  let seen;
  const p = provider(async (url, options) => { seen = { url, options }; return Response.json({ result: "0x2a" }); });
  assert.equal(await p.request(request), "0x2a");
  assert.equal(seen.url, "http://127.0.0.1:4230/rpc/base-mainnet");
  assert.equal(seen.options.credentials, "omit");
  assert.equal(seen.options.redirect, "error");
  assert.deepEqual(JSON.parse(seen.options.body), { agent: "DAT", account: A, request });
});
for (const method of ["eth_accounts", "eth_requestAccounts", "personal_sign", "eth_sendTransaction", "wallet_switchEthereumChain"]) {
  test(`state transport refuses ${method} before any HTTP request`, async () => {
    let calls = 0; const p = provider(async () => { calls++; });
    await assert.rejects(p.request({ method })); assert.equal(calls, 0);
  });
}
test("wrong account and unpinned selectors are refused before HTTP", async () => {
  let calls = 0; const p = provider(async () => { calls++; });
  await assert.rejects(p.request({ ...request, params: ["0x" + "22".repeat(20), request.params[1]] }));
  await assert.rejects(p.request({ ...request, params: [A, "0x1"] }));
  await assert.rejects(p.request({ ...request, params: [A, { blockHash: HASH, requireCanonical: false }] }));
  assert.equal(calls, 0);
});
test("transport errors are bounded local text, not provider instructions", async () => {
  for (const response of [new Response("secret instruction", { status: 502 }), Response.json({ result: "0x1", extra: "secret" }),
    Response.json({ error: { message: "secret" } }), new Response('{"result":"0x1","result":"0x2"}')]) {
    await assert.rejects(provider(async () => response).request(request), error =>
      error.code === "STATE_RPC_UNAVAILABLE" && !error.message.includes("secret"));
  }
});
test("oversized advertised response is cancelled without reading it", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }),
    { headers: { "content-length": String(STATE_RPC_RESPONSE_LIMIT + 1) } });
  await assert.rejects(readStateRpcJson(response)); assert.equal(cancelled, true);
});
test("streaming response cannot evade the byte limit by omitting content-length", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(STATE_RPC_RESPONSE_LIMIT + 1));
  }, cancel() { cancelled = true; } }));
  await assert.rejects(readStateRpcJson(response)); assert.equal(cancelled, true);
});
test("state-provider deadline stops a stalled body and does not await its cancel promise",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});let cancelled=false;
  const stream=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;return new Promise(()=>{});}});
  const pending=provider(async()=>new Response(stream)).request(request);
  const rejected=assert.rejects(pending,{code:"STATE_RPC_UNAVAILABLE"});
  await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(STATE_RPC_TIMEOUT_MS);await rejected;
  assert.equal(cancelled,true);
});
test("failed HTTP response cannot stall state-provider error reporting during cancel",async()=>{
  let cancelled=false;
  await assert.rejects(provider(async()=>({ok:false,body:{cancel(){cancelled=true;return new Promise(()=>{});}}})).request(request),
    {code:"STATE_RPC_UNAVAILABLE"});
  assert.equal(cancelled,true);
});
