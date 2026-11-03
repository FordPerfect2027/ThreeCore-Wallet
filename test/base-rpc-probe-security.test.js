import test from "node:test";
import assert from "node:assert/strict";
import { probeBaseRpc, BaseRpcProbeError } from "../src/base-rpc-probe.js";
import { STATE_RPC_RESPONSE_LIMIT } from "../src/state-rpc-http.js";
import { RPC_SECURITY_LIMITS } from "../src/security-rpc.js";
const contract="0x"+"1".repeat(40),tick=()=>new Promise(resolve=>setImmediate(resolve));
const fails=code=>error=>error instanceof BaseRpcProbeError&&error.code===code;
function transport(values={}) {const calls=[];return {calls,fetchImpl:async(url,options)=>{
  const request=JSON.parse(options.body);calls.push({url,...request,options});
  return new Response(JSON.stringify({jsonrpc:"2.0",id:request.id,
    result:({eth_chainId:"0x14a34",eth_blockNumber:"0x1234",eth_getCode:"0x6000",...values})[request.method]}));
}};}
test("inherited network names and coercion objects cannot choose a transport target",async()=>{
  let called=false,coerced=false;
  for(const network of ["toString","constructor","__proto__",{toString(){coerced=true;return "mainnet";}}])
    await assert.rejects(probeBaseRpc({network,fetchImpl:()=>{called=true;}}),fails("UNSUPPORTED_NETWORK"));
  assert.equal(called,false);assert.equal(coerced,false);
});
test("quantities reject noncanonical and oversized values before further requests",async()=>{
  for(const value of ["0x00","0x0123","0x","0x"+"f".repeat(65),"12","0X12"]){
    const t=transport({eth_blockNumber:value});
    await assert.rejects(probeBaseRpc({...t,contractAddress:contract}),fails("INVALID_RPC_RESPONSE"));
    assert.equal(t.calls.length,2);
  }
  const t=transport({eth_blockNumber:"0x0"});const r=await probeBaseRpc({...t,contractAddress:contract});
  assert.equal(r.observedBlockNumber,"0");assert.deepEqual(t.calls[2].params,[contract,"0x0"]);
});
test("oversized advertised bodies are cancelled before reading",async()=>{
  let cancelled=false,read=false;
  await assert.rejects(probeBaseRpc({fetchImpl:async()=>({ok:true,headers:new Headers({"content-length":String(STATE_RPC_RESPONSE_LIMIT+1)}),
    body:{cancel(){cancelled=true;return Promise.resolve();},getReader(){read=true;}}})}),fails("INVALID_RPC_RESPONSE"));
  assert.equal(cancelled,true);assert.equal(read,false);
});
test("unadvertised stream overflow stops and cancels the response",async()=>{
  let cancelled=false;
  const body=new ReadableStream({pull(c){c.enqueue(new Uint8Array(STATE_RPC_RESPONSE_LIMIT+1).fill(32));},cancel(){cancelled=true;}});
  await assert.rejects(probeBaseRpc({fetchImpl:async()=>new Response(body)}),fails("INVALID_RPC_RESPONSE"));
  assert.equal(cancelled,true);assert.equal(body.locked,false);
});
test("invalid UTF-8, duplicate fields and mixed result/error envelopes cannot succeed",async()=>{
  for(const body of [new Uint8Array([255]),'{"jsonrpc":"2.0","id":1,"result":"0x1","result":"0x14a34"}',
    '{"jsonrpc":"2.0","id":1,"result":"0x14a34","error":null}',
    '{"jsonrpc":"2.0","id":1,"result":"0x14a34","error":false}',
    '{"jsonrpc":"2.0","id":"1","result":"0x14a34"}',
    '{"jsonrpc":"2.0","id":1,"result":"0x14a34","__proto__":{}}']){
    await assert.rejects(probeBaseRpc({fetchImpl:async()=>new Response(body)}),fails("INVALID_RPC_RESPONSE"));
  }
});
test("contract bytecode has a separate bounded limit even within the JSON byte budget",async()=>{
  const t=transport({eth_getCode:"0x"+"00".repeat(RPC_SECURITY_LIMITS.contractCodeCharacters/2)});
  await assert.rejects(probeBaseRpc({...t,contractAddress:contract}),fails("INVALID_RPC_RESPONSE"));
});
test("hard deadline returns even if fetch ignores cancellation, and late response is discarded",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});let release,signal,cancelled=false,calls=0;
  const pending=probeBaseRpc({timeoutMs:100,fetchImpl:(_url,options)=>{calls++;signal=options.signal;return new Promise(resolve=>{release=resolve;});}});
  const rejected=assert.rejects(pending,fails("RPC_TIMEOUT"));
  t.mock.timers.tick(100);await rejected;assert.equal(signal.aborted,true);
  release({ok:true,body:{cancel(){cancelled=true;return Promise.resolve();}}});await tick();
  assert.equal(cancelled,true);assert.equal(calls,1);
});
test("deadline also covers a response body that never finishes and whose cancel never resolves",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});let cancelled=false,calls=0;
  const body=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;return new Promise(()=>{});}});
  const pending=probeBaseRpc({timeoutMs:100,fetchImpl:async()=>{calls++;return new Response(body);}});
  const rejected=assert.rejects(pending,fails("RPC_TIMEOUT"));await tick();t.mock.timers.tick(100);await rejected;
  assert.equal(cancelled,true);assert.equal(calls,1);
});
test("transport errors do not echo endpoint response text into diagnostic errors",async()=>{
  await assert.rejects(probeBaseRpc({fetchImpl:async()=>{throw new Error("PRIVATE_TRANSPORT_DETAIL");}}),error=>{
    assert.equal(error.code,"RPC_TRANSPORT");assert.doesNotMatch(error.message,/PRIVATE_TRANSPORT_DETAIL/);return true;
  });
});
test("non-OK and redirected responses are cancelled and never followed",async()=>{
  for(const response of [{ok:false},{ok:true,redirected:true}]){let cancelled=false;
    await assert.rejects(probeBaseRpc({fetchImpl:async()=>({...response,body:{cancel(){cancelled=true;return new Promise(()=>{});}}})}),fails("HTTP_ERROR"));
    assert.equal(cancelled,true);
  }
});
test("success uses no credentials or redirects and binds code lookup to the observed block",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});const f=transport({eth_blockNumber:"0xAB"});
  const result=await probeBaseRpc({...f,contractAddress:contract,timeoutMs:100});
  assert.equal(result.contractCodeBlockNumber,"171");assert.deepEqual(f.calls[2].params,[contract,"0xab"]);
  for(const {options} of f.calls){assert.equal(options.credentials,"omit");assert.equal(options.redirect,"error");
    assert.equal(options.cache,"no-store");assert.equal(options.referrerPolicy,"no-referrer");assert.equal(options.signal.aborted,true);}
  t.mock.timers.tick(1000);await tick();assert.equal(f.calls.length,3);
});
