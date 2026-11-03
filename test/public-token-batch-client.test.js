import test from "node:test";
import assert from "node:assert/strict";
import { requestPublicTokenBatch } from "../src/public-token-batch-client.js";
import { publicBatchFixture } from "./helpers/public-batch-fixture.js";
const request = () => ({chainId:84532,account:publicBatchFixture().account,blockNumber:null});

test("client uses only the local batch endpoint and binds response to submitted account/network/height",async()=>{
  let calls=0;
  const batch=await requestPublicTokenBatch(request(),{fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,"/rpc/public-token-batch");assert.equal(options.credentials,"omit");assert.equal(options.redirect,"error");
    assert.deepEqual(JSON.parse(options.body),request());return Response.json(publicBatchFixture());
  }});
  assert.equal(calls,1);assert.equal(batch.blockNumber,"42");assert.ok(Object.isFrozen(batch));
  for(const change of [{account:"0x"+"2".repeat(40)},{chainId:8453},{blockNumber:"43"}])
    await assert.rejects(requestPublicTokenBatch({...request(),...change},{fetchImpl:async()=>Response.json(publicBatchFixture())}),{code:"BATCH_RESPONSE_CONTEXT"});
});
test("invalid or extra request fields and pre-aborted signals never start HTTP",async()=>{
  let calls=0;const fetchImpl=()=>{calls++;throw Error();};
  for(const change of [{account:"secret"},{chainId:1},{blockNumber:"01"},{rpcUrl:"https://evil.invalid"},{method:"eth_sendTransaction"}])
    await assert.rejects(requestPublicTokenBatch({...request(),...change},{fetchImpl}));
  const c=new AbortController();c.abort();await assert.rejects(requestPublicTokenBatch(request(),{fetchImpl,signal:c.signal}));assert.equal(calls,0);
});
test("unresponsive response headers are interrupted by cancel and deadline",async()=>{
  for(const cancel of [true,false]){
    const c=new AbortController();let signal;
    const pending=requestPublicTokenBatch(request(),{signal:c.signal,timeoutMs:cancel?1000:10,fetchImpl:async(_url,options)=>{signal=options.signal;return new Promise(()=>{});}});
    const rejected=assert.rejects(pending);if(cancel)c.abort();await rejected;assert.equal(signal.aborted,true);
  }
});
test("malformed, redirected and oversized replies never produce a batch",async()=>{
  for(const response of [new Response('{'),new Response('unavailable',{status:503}),
    new Response('{}',{headers:{'content-length':'3000000'}}),Response.json({...publicBatchFixture(),walletConnected:true})])
    await assert.rejects(requestPublicTokenBatch(request(),{fetchImpl:async()=>response}));
});
