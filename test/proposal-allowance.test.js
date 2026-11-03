import test from 'node:test';
import assert from 'node:assert/strict';
import { allowanceFixture,allowanceRpc } from './helpers/proposal-allowance-fixture.js';
import { inspectProposalAllowance,prepareProposalAllowanceReview,inspectProposalAllowanceReviewFile,validateProposalAllowance } from '../src/proposal-allowance.js';
import { readProposalAllowance } from '../src/proposal-allowance-reader.js';
import { requestProposalAllowance } from '../src/proposal-allowance-client.js';
test('DAT sell and all three USDC buy proposals retain exact amount, original source, expiry and replay',async()=>{
 for(const input of [{},...['DAT','EMA','CAWELON'].map(agent=>({buy:true,agent}))]) {
  const f=await allowanceFixture(input),saved=await prepareProposalAllowanceReview(f.files,f.options),decoded=await inspectProposalAllowanceReviewFile(saved.text);
  assert.equal(saved.result.checksSatisfied,true,JSON.stringify(saved.result.reasons));assert.equal(saved.result.authorizesExecution,false);assert.equal(saved.result.allowanceShortfallBaseUnits,'0');assert.deepEqual(decoded.files,f.files);
  const expired=await inspectProposalAllowance(f.files.quoteReviewFile,f.observation,{...f.options,nowSeconds:f.options.nowSeconds+601});assert.equal(expired.checksSatisfied,false);assert(expired.reasons.includes('QUOTE_CONDITIONS_UNSATISFIED'));assert(expired.reasons.includes('ALLOWANCE_STALE'));
 }
});
test('amount insufficiency, unknown code, wrong context, reorg, stale/future times and differing balance cannot pass',async()=>{
 const f=await allowanceFixture();
 for(const [change,reason]of [[{allowanceBaseUnits:'1'},'ALLOWANCE_SHORTFALL'],[{tokenHasCode:false,tokenBalanceBaseUnits:null,allowanceBaseUnits:null},'ALLOWANCE_UNKNOWN'],[{spenderHasCode:false},'ALLOWANCE_SPENDER_CODE_MISSING'],[{account:'0x'+'22'.repeat(20)},'ALLOWANCE_PROPOSAL_MISMATCH'],[{blockHash:'0x'+'cd'.repeat(32)},'ALLOWANCE_BLOCK_MISMATCH'],[{observedAtSeconds:f.options.nowSeconds-61},'ALLOWANCE_STALE'],[{observedAtSeconds:f.options.nowSeconds+1},'ALLOWANCE_FUTURE_TIME'],[{tokenBalanceBaseUnits:'0'},'ALLOWANCE_BALANCE_SHORTFALL'],[{nativeBalanceBaseUnits:'1'},'ALLOWANCE_BUDGET_STATE_MISMATCH']]) {
  const r=await inspectProposalAllowance(f.files.quoteReviewFile,{...f.observation,...change},f.options);assert(r.reasons.includes(reason),reason);assert.equal(r.checksSatisfied,false);
 }
 const large={...f.observation,allowanceBaseUnits:((1n<<256n)-1n).toString()};assert.equal((await inspectProposalAllowance(f.files.quoteReviewFile,large,f.options)).allowanceShortfallBaseUnits,'0');
 for(const change of [{allowanceBaseUnits:'-1'},{allowanceBaseUnits:'01'},{allowanceBaseUnits:(1n<<256n).toString()},{readOnly:false},{tokenAddress:'0x'+'33'.repeat(20)},{spenderAddress:'0x'+'44'.repeat(20)}])assert.throws(()=>validateProposalAllowance({...f.observation,...change}));
});
test('saved result, observation hash and recorded time cannot be silently changed',async()=>{
 const f=await allowanceFixture(),saved=await prepareProposalAllowanceReview(f.files,f.options);
 for(const mutate of [d=>{d.result.checksSatisfied=false;},d=>{d.observation.allowanceBaseUnits='0';},d=>{d.evaluatedAtSeconds=null;},d=>{d.result.authorizesExecution=true;},d=>{d.extra=true;}]){const d=JSON.parse(saved.text);mutate(d);await assert.rejects(inspectProposalAllowanceReviewFile(JSON.stringify(d)));}
 const c=new AbortController();c.abort();await assert.rejects(prepareProposalAllowanceReview(f.files,{...f.options,signal:c.signal}));
});
test('reader fixes RPC, contracts and canonical hash for every state read and rechecks chain/header',async()=>{
 for(const buy of [false,true]){const f=await allowanceFixture({buy}),rpc=allowanceRpc(f.observation),result=await readProposalAllowance(f.request,{fetchImpl:rpc.fetchImpl});assert.equal(result.allowanceBaseUnits,f.observation.allowanceBaseUnits);assert.equal(rpc.calls.length,9);
  for(const call of rpc.calls.filter(c=>['eth_getCode','eth_getBalance','eth_call'].includes(c.method)))assert.deepEqual(call.params[1],{blockHash:f.request.blockHash,requireCanonical:true});
  assert.equal(rpc.calls.filter(c=>c.method==='eth_call'&&c.params[0].data.startsWith('0xdd62ed3e')).length,1);
 }
});
test('reader rejects changed blocks/chains, malformed amounts and unrequested target without latest fallback',async()=>{
 const f=await allowanceFixture();
 for(const modify of [c=>{if(c.headers===1&&c.request.method==='eth_getBlockByNumber')c.result.hash='0x'+'cd'.repeat(32);},c=>{if(c.headers===2&&c.request.method==='eth_getBlockByNumber')c.result.timestamp='0x1';},c=>{if(c.chains===2&&c.request.method==='eth_chainId')c.result='0x1';},c=>{if(c.request.method==='eth_call')c.result='0x';}]) {const rpc=allowanceRpc(f.observation,modify);await assert.rejects(readProposalAllowance(f.request,{fetchImpl:rpc.fetchImpl}));assert(!rpc.calls.some(c=>c.params.includes('latest')));}
 let calls=0;for(const change of [{rpcUrl:'http://invalid'},{spenderAddress:'0x'+'11'.repeat(20)},{blockNumber:'01'},{direction:'swap'}])await assert.rejects(readProposalAllowance({...f.request,...change},{fetchImpl:()=>{calls++;}}));assert.equal(calls,0);
 const missing={...f.observation,tokenHasCode:false,tokenBalanceBaseUnits:null,allowanceBaseUnits:null},rpc=allowanceRpc(missing),result=await readProposalAllowance(f.request,{fetchImpl:rpc.fetchImpl});assert.equal(result.allowanceBaseUnits,null);assert(!rpc.calls.some(c=>c.method==='eth_call'));
});
test('reader/client cancellation and deadlines release stalled requests; client binds each request field',async()=>{
 const f=await allowanceFixture();let signal;
 await assert.rejects(readProposalAllowance(f.request,{timeoutMs:100,fetchImpl:async(_u,o)=>{signal=o.signal;return new Promise(()=>{});}}),{code:'ALLOWANCE_TIMEOUT'});assert.equal(signal.aborted,true);
 const c=new AbortController();c.abort();await assert.rejects(readProposalAllowance(f.request,{signal:c.signal}));
 const result=await requestProposalAllowance(f.request,{fetchImpl:async(url,o)=>{assert.equal(url,'/rpc/proposal-allowance');assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');return Response.json(f.observation);}});assert.deepEqual(result,f.observation);
 for(const change of [{account:'0x'+'22'.repeat(20)},{blockNumber:'43'},{blockHash:'0x'+'cd'.repeat(32)}])await assert.rejects(requestProposalAllowance({...f.request,...change},{fetchImpl:async()=>Response.json(f.observation)}),{code:'ALLOWANCE_RESPONSE_CONTEXT'});
 for(const body of [false,true])await assert.rejects(requestProposalAllowance(f.request,{timeoutMs:10,fetchImpl:async()=>body?new Response(new ReadableStream({start(){}})):new Promise(()=>{})}));
});
