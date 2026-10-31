import test from "node:test";import assert from "node:assert/strict";import{getEventListeners}from"node:events";
import {createPublicBaseRpcReader} from "../src/public-base-rpc.js";
import {probeBaseRpc} from "../src/base-rpc-probe.js";
import {inspectAerodromeBase} from "../src/aerodrome-readonly.js";
import {inspectAerodromePools} from "../src/aerodrome-pools.js";
const rpcUrl="https://mainnet.base.org",tick=()=>new Promise(setImmediate);
function gate(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const cancelled=error=>error.code==="RPC_CANCELLED"&&!error.message.includes("PRIVATE");
test("pre-aborted diagnostic signals prevent transport even if aborted is shadowed",async()=>{
 const abort=new AbortController();abort.abort();Object.defineProperty(abort.signal,"aborted",{value:false});let calls=0;
 const read=createPublicBaseRpcReader({rpcUrl,signal:abort.signal,fetchImpl(){calls++;throw Error("PRIVATE");}});
 await assert.rejects(read("eth_chainId"),cancelled);assert.equal(calls,0);
});
test("caller cancellation ends a hanging fetch, aborts its transport signal and consumes late failure",async()=>{
 const abort=new AbortController(),pending=gate();let signal;
 const read=createPublicBaseRpcReader({rpcUrl,signal:abort.signal,fetchImpl(_url,options){signal=options.signal;return pending.promise;}});
 const result=read("eth_chainId");abort.abort();await assert.rejects(result,cancelled);assert.equal(signal.aborted,true);
 pending.reject(Error("PRIVATE late failure"));await tick();await assert.rejects(read("eth_blockNumber"),cancelled);
});
test("late headers after cancellation release their unread body",async()=>{
 const abort=new AbortController(),pending=gate();let cancelledBodies=0;
 const read=createPublicBaseRpcReader({rpcUrl,signal:abort.signal,fetchImpl:()=>pending.promise});
 const result=read("eth_chainId");abort.abort();await assert.rejects(result,cancelled);
 pending.resolve({ok:true,redirected:false,body:{cancel(){cancelledBodies++;}}});await tick();assert.equal(cancelledBodies,1);
});
test("cancellation during response-body reading does not return an empty or zero result",async()=>{
 const abort=new AbortController();let bodyStarted=gate(),bodyCancelled=0;
 const read=createPublicBaseRpcReader({rpcUrl,signal:abort.signal,fetchImpl:async()=>new Response(new ReadableStream({pull(){bodyStarted.resolve();return new Promise(()=>{});},cancel(){bodyCancelled++;}}))});
 const result=read("eth_chainId");await bodyStarted.promise;abort.abort();await assert.rejects(result,cancelled);await tick();assert.equal(bodyCancelled,1);
});
test("request capture that cancels cannot start a subsequent fetch",async()=>{
 const abort=new AbortController();let calls=0;
 const params=new Proxy([],{ownKeys(target){abort.abort();return Reflect.ownKeys(target);}});
 const read=createPublicBaseRpcReader({rpcUrl,signal:abort.signal,fetchImpl(){calls++;throw Error("unexpected");}});
 await assert.rejects(read("eth_chainId",params),cancelled);assert.equal(calls,0);
});
test("completed reads release cancellation listeners and preserve reusable transport",async()=>{
 const abort=new AbortController();let calls=0;
 const read=createPublicBaseRpcReader({rpcUrl,signal:abort.signal,fetchImpl:async(_url,options)=>{calls++;const request=JSON.parse(options.body);return Response.json({jsonrpc:"2.0",id:request.id,result:"0x2105"});}});
 for(let i=0;i<24;i++){assert.equal(await read("eth_chainId"),"0x2105");assert.equal(getEventListeners(abort.signal,"abort").length,0);}assert.equal(calls,24);abort.abort();await assert.rejects(read("eth_chainId"),cancelled);assert.equal(calls,24);
});
test("per-request timeout remains distinguishable from later caller cancellation",async()=>{
 const abort=new AbortController(),pending=gate();const read=createPublicBaseRpcReader({rpcUrl,signal:abort.signal,timeoutMs:100,fetchImpl:()=>pending.promise});
 await assert.rejects(read("eth_chainId"),{code:"RPC_TIMEOUT"});abort.abort();pending.reject(Error("late"));await tick();
});
test("invalid signal and accessor options fail before transport",()=>{
 let reads=0;const revoked=Proxy.revocable(new AbortController().signal,{});revoked.revoke();for(const signal of[null,{},true,revoked.proxy])assert.throws(()=>createPublicBaseRpcReader({rpcUrl,signal}),{code:"INVALID_SIGNAL"});
 assert.throws(()=>createPublicBaseRpcReader({rpcUrl,get signal(){reads++;return new AbortController().signal;}}),{code:"INVALID_OPTIONS"});assert.equal(reads,0);
});
for(const[name,run,extra]of[["network",probeBaseRpc,{network:"mainnet"}],["contracts",inspectAerodromeBase,{}],["pools",inspectAerodromePools,{}]]){
 test(name+" pre-aborted diagnostics do not start a read",async()=>{
 const abort=new AbortController();abort.abort();let calls=0;await assert.rejects(run({...extra,signal:abort.signal,fetchImpl(){calls++;throw Error("PRIVATE");}}),cancelled);assert.equal(calls,0);
 });
 test(name+" cancellation at the first response prevents subsequent requests",async()=>{
 const abort=new AbortController();let calls=0;await assert.rejects(run({...extra,signal:abort.signal,fetchImpl:async(_url,options)=>{calls++;const request=JSON.parse(options.body);abort.abort();return Response.json({jsonrpc:"2.0",id:request.id,result:"0x2105"});}}),cancelled);assert.equal(calls,1);
 });
 test(name+" options are captured without running input getters",async()=>{
 let reads=0;await assert.rejects(run({...extra,get fetchImpl(){reads++;throw Error("PRIVATE");}}),{code:"INVALID_OPTIONS"});assert.equal(reads,0);
 });
}
