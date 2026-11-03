import test from 'node:test';
import assert from 'node:assert/strict';
import {consumeCleanup} from '../src/file-read-policy.js';
import {createSecureDeadline} from '../src/secure-deadline.js';
import {createWalletReadScope} from '../src/wallet-read-scope.js';
import {createWalletCardController} from '../src/wallet-card-controller.js';
import {fetchStateRpcResponse,readStateRpcJson} from '../src/state-rpc-http.js';
import {createPublicBaseRpcReader} from '../src/public-base-rpc.js';
const tick=()=>new Promise(setImmediate);
const broken=()=>({async then(){throw Error('malformed asynchronous observer');}});
for(const make of [()=>Promise.reject(Error('ordinary cleanup rejection')),broken])test('file cleanup consumes rejected asynchronous adapter results: '+(make===broken?'malformed':'native'),async()=>{
 let called=0;consumeCleanup(()=>{called++;return make();});await tick();assert.equal(called,1);
});
test('secure expiry consumes malformed asynchronous notification and remains expired',async()=>{
 let now=0,calls=0;const deadline=createSecureDeadline({now:()=>now,timeoutMs:10,schedule:()=>1,unschedule(){},onExpire(){calls++;return broken();}});
 try{assert.equal(deadline.arm(),true);now=11;assert.equal(deadline.check(),false);await tick();assert.equal(deadline.state().phase,'expired');assert.equal(calls,1);}finally{deadline.dispose();}
});
test('read-scope eligibility rejection is consumed without invoking a wallet method',async()=>{
 let invoked=0;const scope=createWalletReadScope({isCurrent:broken});
 try{await assert.rejects(scope.invoke(()=>{invoked++;return 1;}),{code:'STALE_VIEW'});await tick();assert.equal(invoked,0);assert.equal(scope.state().closed,true);}finally{scope.cancel();}
});
test('read completion observer failure cannot escape or replace the method result',async()=>{
 let settled=0;const scope=createWalletReadScope({isCurrent:()=>true,onSettled(){settled++;return broken();}});
 try{assert.equal(await scope.invoke(()=>42),42);await tick();assert.equal(settled,1);assert.equal(scope.state().pending,0);}finally{scope.cancel();}
});
test('wallet card view notification failure is consumed after disconnect',async()=>{
 let changes=0;const controller=createWalletCardController({agent:'DAT',siteOrigin:'http://localhost:4173',onChange(){changes++;return broken();}});
 try{controller.disconnect();await tick();assert.equal(changes,1);assert.equal(controller.state.phase,'disconnected');}finally{controller.dispose();}
});
test('wallet card asynchronous access result cannot create a wallet session',async()=>{
 let created=0;const controller=createWalletCardController({agent:'DAT',siteOrigin:'http://localhost:4173',isAccessAllowed:broken,createSession(){created++;throw Error('must not connect');}});
 try{await controller.connect({provider:{request(){}},account:'0x'+'11'.repeat(20),chainId:8453});await tick();assert.equal(created,0);}finally{controller.dispose();}
});
test('discarded HTTP headers consume malformed body-cancellation failures',async()=>{
 let cancelled=0;const controller=new AbortController();
 await assert.rejects(fetchStateRpcResponse(async()=>({ok:false,body:{cancel(){cancelled++;return broken();}}}),'https://example.invalid',{signal:controller.signal}),{code:'STATE_RPC_UNAVAILABLE'});
 await tick();assert.equal(cancelled,1);
});
test('pre-aborted body reads consume cancellation failures without reading',async()=>{
 const controller=new AbortController();controller.abort();let reads=0;
 await assert.rejects(readStateRpcJson({body:{cancel:broken,getReader(){reads++;}}},{signal:controller.signal}),{code:'STATE_RPC_UNAVAILABLE'});await tick();assert.equal(reads,0);
});
test('oversized declared responses consume body-cancellation failures before opening a reader',async()=>{
 let reads=0;await assert.rejects(readStateRpcJson({headers:{get:()=>String(3*1024*1024)},body:{cancel:broken,getReader(){reads++;}}}),{code:'STATE_RPC_UNAVAILABLE'});await tick();assert.equal(reads,0);
});
for(const method of ['cancel','releaseLock'])test('HTTP reader '+method+' failure cannot escape a rejected response',async()=>{
 let cleanup=0;const reader={read:async()=>{throw Error('body failure');},cancel(){},releaseLock(){},[method](){cleanup++;return method==='releaseLock'?Promise.reject(Error('release failed')):broken();}};
 await assert.rejects(readStateRpcJson({headers:{get:()=>null},body:{getReader:()=>reader}}),{code:'STATE_RPC_UNAVAILABLE'});await tick();assert.equal(cleanup,1);
});
test('public RPC response cleanup cannot escape its transport error',async()=>{
 let calls=0;const read=createPublicBaseRpcReader({rpcUrl:'https://mainnet.base.org',fetchImpl:async()=>{calls++;return{ok:false,body:{cancel:broken}};}});
 await assert.rejects(read('eth_chainId'),{code:'HTTP_ERROR'});await tick();assert.equal(calls,1);
});
