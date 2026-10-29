import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readStateRpcJson, STATE_RPC_RESPONSE_LIMIT } from "../src/state-rpc-http.js";
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
