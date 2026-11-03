import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteFixture } from './helpers/aerodrome-quote-fixture.js';
import { requestAerodromeQuote } from '../src/aerodrome-quote-client.js';
const request=()=>({agent:'DAT',direction:'sell',inputBaseUnits:quoteFixture().inputBaseUnits,slippageBps:50,blockNumber:null});
test('client binds response to agent, direction, amount, slippage and requested block using only the local endpoint',async()=>{
 const result=await requestAerodromeQuote(request(),{fetchImpl:async(url,options)=>{assert.equal(url,'/rpc/aerodrome-quote');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.deepEqual(JSON.parse(options.body),request());return Response.json(quoteFixture());}});assert.equal(result.agent,'DAT');
 for(const change of [{agent:'EMA'},{direction:'buy'},{inputBaseUnits:'1'},{slippageBps:49},{blockNumber:'43'}])await assert.rejects(requestAerodromeQuote({...request(),...change},{fetchImpl:async()=>Response.json(quoteFixture())}),{code:'QUOTE_RESPONSE_CONTEXT'});
});
test('unsupported request fields and pre-cancellation never start transport; malformed, forged and oversized replies fail',async()=>{
 let calls=0;const fetchImpl=()=>{calls++;throw Error();};
 for(const change of [{agent:'__proto__'},{direction:'swap'},{inputBaseUnits:'0'},{blockNumber:'01'},{slippageBps:10000},{rpcUrl:'https://unrelated.invalid'},{method:'eth_sendTransaction'}])await assert.rejects(requestAerodromeQuote({...request(),...change},{fetchImpl}));
 const c=new AbortController();c.abort();await assert.rejects(requestAerodromeQuote(request(),{fetchImpl,signal:c.signal}));assert.equal(calls,0);
 for(const response of [new Response('{'),new Response('{}',{status:502}),new Response('{}',{headers:{'content-length':'3000000'}}),Response.json({...quoteFixture(),readOnly:false})])await assert.rejects(requestAerodromeQuote(request(),{fetchImpl:async()=>response}));
});
test('deadline and caller cancellation interrupt stalled response headers and body',async()=>{
 for(const body of [false,true])for(const cancel of [false,true]){
  const c=new AbortController();let signal;const pending=requestAerodromeQuote(request(),{signal:c.signal,timeoutMs:cancel?1000:10,fetchImpl:async(_url,options)=>{signal=options.signal;return body?new Response(new ReadableStream({start(){}})):new Promise(()=>{});}});
  const rejected=assert.rejects(pending);if(cancel)c.abort();await rejected;assert.equal(signal.aborted,true);
 }
});
