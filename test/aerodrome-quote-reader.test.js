import test from 'node:test';
import assert from 'node:assert/strict';
import { readAerodromeQuote,encodeClassicRouterQuote,CLASSIC_QUOTE_SELECTORS as S } from '../src/aerodrome-quote-reader.js';
import { AERODROME_BASE,THREECORE_BASE_TOKENS } from '../src/aerodrome-readonly.js';
import { BASE_NATIVE_USDC } from '../src/aerodrome-pools.js';
import { quoteFixture,quoteRpc,word,abiAddress,QUOTE_HASH } from './helpers/aerodrome-quote-fixture.js';
const request=q=>({agent:q.agent,direction:q.direction,inputBaseUnits:q.inputBaseUnits,slippageBps:q.slippageBps});
test('all three agents and both quote directions compare pool, router and reserve arithmetic at one hash',async()=>{
  for(const agent of ['DAT','EMA','CAWELON'])for(const direction of ['buy','sell']){
    const q=quoteFixture({agent,direction}),rpc=quoteRpc({quote:q,reverse:direction==='buy'}),r=await readAerodromeQuote({...request(q),fetchImpl:rpc.fetchImpl});
    assert.deepEqual({...r,observedAtSeconds:q.observedAtSeconds},q);
    for(const call of rpc.calls.filter(c=>['eth_call','eth_getCode'].includes(c.method)))assert.deepEqual(call.params[1],{blockHash:QUOTE_HASH,requireCanonical:true});
    assert.equal(rpc.calls.filter(c=>c.method==='eth_chainId').length,2);assert.equal(rpc.calls.filter(c=>c.method==='eth_getBlockByNumber').length,2);
    assert(rpc.calls.every(c=>['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_call','eth_getCode'].includes(c.method)));
  }
});
test('single-route encoding matches independently generated viem 2.56.6 ABI vector',()=>{
  const expected='0x5509a1ac'+word(1)+word(64)+word(1)+'0000000000000000000000006c83dd253f2f882b9884fd1ac3a7754ed6405de5'+'000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913'+word(0)+'000000000000000000000000420dd381b31aef6683db6b902084cb0ffece40da';
  assert.equal(encodeClassicRouterQuote('1',THREECORE_BASE_TOKENS.DAT,BASE_NATIVE_USDC),expected);
});
test('invalid amounts, source options and cancellation fail before network access',async()=>{
  const q=quoteFixture();let calls=0,coercions=0;const fetchImpl=()=>{calls++;throw Error('unexpected');};
  for(const input of [{agent:'OTHER'},{inputBaseUnits:'0'},{inputBaseUnits:String(1n<<256n)},{direction:'swap'},{slippageBps:10000},{blockNumber:'01'},{agent:{toString(){coercions++;return 'DAT';}}},{timeoutMs:0},{requestTimeoutMs:0},{signal:{aborted:false}}])await assert.rejects(readAerodromeQuote({...request(q),fetchImpl,...input}));
  const controller=new AbortController();controller.abort();await assert.rejects(readAerodromeQuote({...request(q),fetchImpl,signal:controller.signal}),{code:'QUOTE_CANCELLED'});
  const getter={...request(q)};Object.defineProperty(getter,'agent',{get(){coercions++;return 'DAT';}});await assert.rejects(readAerodromeQuote(getter));assert.equal(calls,0);assert.equal(coercions,0);
});
test('explicit historical height skips latest and still rechecks its exact canonical hash',async()=>{
  const q=quoteFixture(),rpc=quoteRpc({quote:q});await readAerodromeQuote({...request(q),blockNumber:'42',fetchImpl:rpc.fetchImpl});assert.equal(rpc.calls.some(c=>c.method==='eth_blockNumber'),false);
});
test('identity, empty pool, decimals, output, timestamps and network transitions cannot produce a quote',async()=>{
  const cases=[
    [c=>{if(c.request.method==='eth_chainId')c.result='0x1';},'QUOTE_NETWORK'],
    [c=>{if(c.chainCalls===2&&c.request.method==='eth_chainId')c.result='0x1';},'QUOTE_NETWORK_CHANGED'],
    [c=>{if(c.request.method==='eth_getCode')c.result='0x';},'QUOTE_CONTRACT_MISSING'],
    [c=>{if(c.headers===2&&c.request.method==='eth_getBlockByNumber')c.result.hash='0x'+'cd'.repeat(32);},'QUOTE_BLOCK_CHANGED'],
    [c=>{if(c.request.method==='eth_getBlockByNumber')delete c.result.timestamp;},'INVALID_RPC_RESPONSE'],
    [c=>{if(c.request.params[0]?.data===S.isPaused)c.result='0x'+word(1);},'QUOTE_FACTORY_PAUSED'],
    [c=>{if(c.request.params[0]?.data===S.defaultFactory)c.result=abiAddress('0x'+'77'.repeat(20));},'QUOTE_ROUTER_FACTORY'],
    [c=>{if(c.request.params[0]?.data?.startsWith(S.getPool))c.result=abiAddress('0x'+'00'.repeat(20));},'QUOTE_POOL_MISSING'],
    [c=>{if(c.request.params[0]?.data===S.stable)c.result='0x'+word(1);},'QUOTE_POOL_FACTORY_OR_TYPE'],
    [c=>{if(c.request.params[0]?.data===S.token1)c.result=abiAddress(THREECORE_BASE_TOKENS.DAT);},'QUOTE_PAIR'],
    [c=>{if(c.request.params[0]?.data===S.decimals)c.result='0x'+word(19);},'QUOTE_DECIMALS'],
    [c=>{if(c.request.params[0]?.data===S.reserves)c.result='0x'+word(0)+word(100)+word(1);},'QUOTE_EMPTY'],
    [c=>{if(c.request.params[0]?.data?.startsWith(S.getFee))c.result='0x'+word(301);},'QUOTE_FEE'],
    [c=>{if(c.request.params[0]?.data?.startsWith(S.poolQuote))c.result='0x'+word(1);},'QUOTE_OUTPUT_MISMATCH'],
    [c=>{if(c.request.params[0]?.data?.startsWith(S.routerQuote))c.result='0x'+word(32)+word(2)+word(99)+word(1);},'QUOTE_ROUTER_ABI']
  ];for(const [modify,code] of cases){const q=quoteFixture(),rpc=quoteRpc({quote:q,modify});await assert.rejects(readAerodromeQuote({...request(q),fetchImpl:rpc.fetchImpl}),{code});}
});
test('stalled requests, body timeout and mid-read cancellation settle and never fall back to an unpinned read',async()=>{
  const q=quoteFixture(),controller=new AbortController();let entered;const start=new Promise(resolve=>{entered=resolve;});
  const pending=readAerodromeQuote({...request(q),signal:controller.signal,fetchImpl:async()=>{entered();return new Promise(()=>{});}});await start;controller.abort();await assert.rejects(pending,{code:'QUOTE_CANCELLED'});
  await assert.rejects(readAerodromeQuote({...request(q),timeoutMs:100,fetchImpl:async()=>new Promise(()=>{})}),{code:'QUOTE_TIMEOUT'});
  await assert.rejects(readAerodromeQuote({...request(q),requestTimeoutMs:100,fetchImpl:async()=>new Response(new ReadableStream({start(){}}))}),{code:'RPC_TIMEOUT'});
  const rpc=quoteRpc({onRequest(c){if(c.method==='eth_call')throw Error('unsupported EIP-1898');}});
  await assert.rejects(readAerodromeQuote({...request(q),fetchImpl:rpc.fetchImpl}),{code:'RPC_TRANSPORT'});
  assert(rpc.calls.filter(c=>c.method==='eth_call').every(c=>typeof c.params[1]==='object'));
});
