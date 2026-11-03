import test from 'node:test';
import assert from 'node:assert/strict';
import { usdcFixture,usdcRpc } from './helpers/usdc-fixture.js';
import { readPublicUsdc } from '../src/public-usdc-reader.js';
import { BASE_NATIVE_USDC } from '../src/aerodrome-pools.js';
test('USDC and ETH use one account, canonical block and fixed contract; explicit height has no latest fallback',async()=>{
 for(const explicit of [false,true]){const mock=usdcRpc(),o=await readPublicUsdc({account:usdcFixture().account,fetchImpl:mock.fetchImpl,...(explicit?{blockNumber:'42'}:{})});assert.equal(o.balanceBaseUnits,'10000000');assert.equal(o.metadata.decimals,6);assert.equal(o.walletConnected,false);assert.equal(mock.calls.length,explicit?11:12);
  assert.equal(mock.calls.filter(c=>c.method==='eth_blockNumber').length,explicit?0:1);
  for(const c of mock.calls.filter(c=>['eth_call','eth_getBalance','eth_getCode'].includes(c.method))){assert.deepEqual(c.params[1],{blockHash:usdcFixture().blockHash,requireCanonical:true});if(c.method==='eth_call')assert.equal(c.params[0].to,BASE_NATIVE_USDC);}
 }
});
test('network, metadata, missing code, malformed balance and reorganization fail closed',async()=>{
 for(const modify of [c=>{if(c.request.method==='eth_chainId')c.result='0x1';},c=>{if(c.chains===2&&c.request.method==='eth_chainId')c.result='0x14a34';},c=>{if(c.request.method==='eth_getCode')c.result='0x';},c=>{if(c.request.method==='eth_call'&&c.request.params[0].data==='0x313ce567')c.result='0x'+'12'.padStart(64,'0');},c=>{if(c.headers===2&&c.request.method==='eth_getBlockByNumber')c.result={...c.result,hash:'0x'+'cd'.repeat(32)};},c=>{if(c.request.method==='eth_call'&&c.request.params[0].data.startsWith('0x70a08231'))c.result='0x0';}]){
  const mock=usdcRpc({modify});await assert.rejects(readPublicUsdc({account:usdcFixture().account,fetchImpl:mock.fetchImpl}));
 }
});
test('invalid inputs and pre-abort never dispatch; stalled fetch and body can be stopped',async()=>{
 let calls=0;const fetchImpl=()=>{calls++;throw Error();},account=usdcFixture().account;
 for(const change of [{account:'seed words'},{blockNumber:'01'},{timeoutMs:0}])await assert.rejects(readPublicUsdc({account,...change,fetchImpl}));
 const c=new AbortController();c.abort();await assert.rejects(readPublicUsdc({account,fetchImpl,signal:c.signal}));assert.equal(calls,0);
 for(const body of [false,true]){let signal;await assert.rejects(readPublicUsdc({account,requestTimeoutMs:100,fetchImpl:async(url,options)=>{signal=options.signal;return body?new Response(new ReadableStream({start(){}})):new Promise(()=>{});}}));assert.equal(signal.aborted,true);}
});
