import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { fetchStateRpcResponse, readStateRpcJson, STATE_RPC_RESPONSE_LIMIT } from "../src/state-rpc-http.js";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("pre-aborted read cancels body without acquiring a reader",async()=>{
  const aborter=new AbortController();aborter.abort();let cancelled=false,acquired=false;
  await assert.rejects(readStateRpcJson({body:{cancel(){cancelled=true;return Promise.resolve();},getReader(){acquired=true;}}},{signal:aborter.signal}),
    {code:"STATE_RPC_UNAVAILABLE"});
  assert.equal(cancelled,true);assert.equal(acquired,false);
});
test("abort rejects a pending read without awaiting an uncooperative cancellation",async()=>{
  const aborter=new AbortController();let cancelled=false;
  const body=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;return new Promise(()=>{});}});
  const pending=readStateRpcJson(new Response(body),{signal:aborter.signal});
  const rejected=assert.rejects(pending,{code:"STATE_RPC_UNAVAILABLE"});await tick();aborter.abort();await rejected;
  assert.equal(cancelled,true);assert.equal(getEventListeners(aborter.signal,"abort").length,0);
});
test("successful split UTF-8 read removes abort listener and releases stream lock",async()=>{
  const aborter=new AbortController(),bytes=new TextEncoder().encode('{"result":"確認"}');let index=0,cancelled=false;
  const body=new ReadableStream({pull(c){if(index===bytes.length)c.close();else c.enqueue(bytes.slice(index,++index));},cancel(){cancelled=true;}});
  assert.deepEqual(await readStateRpcJson(new Response(body),{signal:aborter.signal}),{result:"確認"});
  assert.equal(body.locked,false);assert.equal(getEventListeners(aborter.signal,"abort").length,0);
  aborter.abort();assert.equal(cancelled,false);
});
test("declared oversize rejection is not delayed by body cancellation",async()=>{
  await assert.rejects(readStateRpcJson({headers:new Headers({"content-length":String(STATE_RPC_RESPONSE_LIMIT+1)}),
    body:{cancel(){return new Promise(()=>{});}}}),{code:"STATE_RPC_UNAVAILABLE"});
});
test("parsing failure also cleans up listener and lock",async()=>{
  const aborter=new AbortController(),response=new Response('{"result":');
  await assert.rejects(readStateRpcJson(response,{signal:aborter.signal}),{code:"STATE_RPC_UNAVAILABLE"});
  assert.equal(response.body.locked,false);assert.equal(getEventListeners(aborter.signal,"abort").length,0);
});

test("header read rejects a pre-aborted signal without invoking fetch", async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(fetchStateRpcResponse(() => { calls++; }, "https://example.invalid", { signal: controller.signal }),
    { code: "STATE_RPC_UNAVAILABLE" });
  assert.equal(calls, 0);
});
test("header read aborts promptly and cancels a late response without retaining the listener", async () => {
  const controller = new AbortController(); let resolve, cancelled = false;
  const pending = fetchStateRpcResponse(() => new Promise(r => { resolve = r; }), "https://example.invalid",
    { signal: controller.signal });
  const rejected = assert.rejects(pending, { code: "STATE_RPC_UNAVAILABLE" });
  controller.abort(); await rejected;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  resolve({ ok: true, body: { cancel() { cancelled = true; return new Promise(() => {}); } } });
  await tick(); assert.equal(cancelled, true);
});
test("late header rejection is consumed after the caller has aborted", async () => {
  const controller = new AbortController(); let reject;
  const pending = fetchStateRpcResponse(() => new Promise((_resolve, r) => { reject = r; }),
    "https://example.invalid", { signal: controller.signal });
  const rejected = assert.rejects(pending, { code: "STATE_RPC_UNAVAILABLE" });
  controller.abort(); await rejected; reject(new Error("private transport message")); await tick();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
test("accepted headers remove their listener without cancelling the body", async () => {
  const controller = new AbortController(), response = Response.json({ result: "0x1" });
  assert.equal(await fetchStateRpcResponse(async () => response, "https://example.invalid",
    { signal: controller.signal }), response);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.deepEqual(await readStateRpcJson(response, { signal: controller.signal }), { result: "0x1" });
});
test("redirected headers are cancelled even if the transport ignored redirect policy", async () => {
  const controller = new AbortController(); let cancelled = false;
  await assert.rejects(fetchStateRpcResponse(async () => ({ ok: true, redirected: true,
    body: { cancel() { cancelled = true; return new Promise(() => {}); } } }),
  "https://example.invalid", { signal: controller.signal }), { code: "STATE_RPC_UNAVAILABLE" });
  assert.equal(cancelled, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
