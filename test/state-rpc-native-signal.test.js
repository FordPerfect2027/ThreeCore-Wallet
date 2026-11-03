import test from 'node:test';import assert from 'node:assert/strict';import {getEventListeners} from 'node:events';
import {fetchStateRpcResponse,readStateRpcJson} from '../src/state-rpc-http.js';
const call=(phase,signal,response=Response.json({result:'ok'}))=>phase==='headers'?fetchStateRpcResponse(async()=>response,'https://example.invalid',{signal}):readStateRpcJson(response,{signal});
for(const phase of ['headers','body']){
 for(const field of ['aborted','addEventListener','removeEventListener'])test('state RPC '+phase+' ignores instance '+field,async()=>{
  const abort=new AbortController();let gets=0;Object.defineProperty(abort.signal,field,{get(){gets++;throw Error('private override');}});const response=Response.json({result:'ok'});
  const value=await call(phase,abort.signal,response);assert.equal(gets,0);assert.equal(getEventListeners(abort.signal,'abort').length,0);if(phase==='headers'){assert.equal(value,response);await response.body.cancel();}else{assert.deepEqual(value,{result:'ok'});assert.equal(response.body.locked,false);}
 });
 test('state RPC '+phase+' uses native pre-cancellation before I/O',async()=>{
  const abort=new AbortController();abort.abort();Object.defineProperty(abort.signal,'aborted',{value:false});let calls=0,cancels=0;
  const response={headers:{get(){calls++;return null;}},body:{cancel(){cancels++;},getReader(){calls++;return{read:async()=>({done:true}),releaseLock(){}};}}};
  const pending=phase==='headers'?fetchStateRpcResponse(async()=>{calls++;return Response.json({});},'https://example.invalid',{signal:abort.signal}):readStateRpcJson(response,{signal:abort.signal});
  await assert.rejects(pending,{code:'STATE_RPC_UNAVAILABLE'});assert.equal(calls,0);if(phase==='body')assert.equal(cancels,1);
 });
 test('state RPC '+phase+' ignores artificial events but genuine abort releases a pending read',async()=>{
  const abort=new AbortController();let release,settled=false,cancels=0,unlocks=0;
  const response={ok:true,redirected:false,headers:{get:()=>null},body:{cancel(){cancels++;},getReader(){return{read:()=>new Promise(r=>{release=r;}),cancel(){cancels++;},releaseLock(){unlocks++;}};}}};
  const work=phase==='headers'?fetchStateRpcResponse(()=>new Promise(r=>{release=r;}),'https://example.invalid',{signal:abort.signal}):readStateRpcJson(response,{signal:abort.signal});
  const observed=work.then(value=>{settled=true;return{value};},error=>{settled=true;return{code:error.code};});
  try{abort.signal.dispatchEvent(new Event('abort'));await new Promise(r=>setTimeout(r,0));assert.equal(settled,false);abort.abort();assert.deepEqual(await observed,{code:'STATE_RPC_UNAVAILABLE'});assert.equal(getEventListeners(abort.signal,'abort').length,0);release(phase==='headers'?response:{done:true});await new Promise(r=>setTimeout(r,0));assert(cancels>0);if(phase==='body')assert.equal(unlocks,1);}finally{abort.abort();release?.(phase==='headers'?response:{done:true});await observed;}
 });
 test('state RPC '+phase+' invalid native signal gives a bounded diagnostic',async()=>{await assert.rejects(call(phase,Object.create(AbortSignal.prototype)),{code:'STATE_RPC_UNAVAILABLE'});});
 test('state RPC '+phase+' options accessor is not executed',async()=>{
  let gets=0;const options={get signal(){gets++;throw Error('private getter');}};
  await assert.rejects(phase==='headers'?fetchStateRpcResponse(async()=>Response.json({}),'https://example.invalid',options):readStateRpcJson(Response.json({}),options),{code:'STATE_RPC_UNAVAILABLE'});assert.equal(gets,0);
 });
}
test('abort during reader acquisition still cancels the newly acquired lock owner',async()=>{
 const abort=new AbortController();let cancels=0;const stream=new ReadableStream({cancel(){cancels++;}}),body={cancel:()=>stream.cancel(),getReader(){const reader=stream.getReader();abort.abort();return reader;}};
 await assert.rejects(readStateRpcJson({headers:new Headers(),body},{signal:abort.signal}),{code:'STATE_RPC_UNAVAILABLE'});assert.equal(cancels,1);assert.equal(stream.locked,false);assert.equal(getEventListeners(abort.signal,'abort').length,0);
});
test('header inspection exception cancels the received body and hides raw diagnostics',async()=>{
 const abort=new AbortController();let cancels=0;await assert.rejects(fetchStateRpcResponse(async()=>({get ok(){throw Error('private');},body:{cancel(){cancels++;}}}),'https://example.invalid',{signal:abort.signal}),{code:'STATE_RPC_UNAVAILABLE'});assert.equal(cancels,1);assert.equal(getEventListeners(abort.signal,'abort').length,0);
});
test('body header exception cancels without acquiring a reader',async()=>{
 const abort=new AbortController();let cancels=0,reads=0;await assert.rejects(readStateRpcJson({headers:{get(){throw Error('private');}},body:{cancel(){cancels++;},getReader(){reads++;}}},{signal:abort.signal}),{code:'STATE_RPC_UNAVAILABLE'});assert.equal(cancels,1);assert.equal(reads,0);assert.equal(getEventListeners(abort.signal,'abort').length,0);
});
