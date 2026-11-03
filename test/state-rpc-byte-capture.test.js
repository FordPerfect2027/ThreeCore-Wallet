import test from 'node:test';
import assert from 'node:assert/strict';
import {readStateRpcJson,STATE_RPC_RESPONSE_LIMIT} from '../src/state-rpc-http.js';
const bytes=new TextEncoder().encode('{"ok":true}');
function response(packets){let reads=0,cancelled=0,released=0;return {value:{headers:{get:()=>null},body:{getReader:()=>({async read(){return packets[reads++]??{done:true};},cancel(){cancelled++;},releaseLock(){released++;}})}},metrics:()=>({reads,cancelled,released})};}
for(const kind of ['throw','oversized','changing'])test('HTTP byte accounting uses intrinsic length instead of a '+kind+' accessor',async()=>{
 let observed=0;const chunk=bytes.slice();Object.defineProperty(chunk,'byteLength',{get(){observed++;if(kind==='throw')throw Error('untrusted size');return kind==='oversized'?STATE_RPC_RESPONSE_LIMIT+1:0;}});
 const f=response([{done:false,value:chunk}]);assert.deepEqual(await readStateRpcJson(f.value),{ok:true});assert.equal(observed,0);assert.equal(f.metrics().released,1);assert.equal(f.metrics().cancelled,0);
});
test('oversized actual chunk is rejected without invoking an understated length getter',async()=>{
 let observed=0;const chunk=new Uint8Array(STATE_RPC_RESPONSE_LIMIT+1);chunk.fill(32);chunk.set(bytes);Object.defineProperty(chunk,'byteLength',{get(){observed++;return 0;}});
 const f=response([{done:false,value:chunk}]);await assert.rejects(readStateRpcJson(f.value),{code:'STATE_RPC_UNAVAILABLE'});assert.equal(observed,0);assert.equal(f.metrics().reads,1);assert.equal(f.metrics().cancelled,1);assert.equal(f.metrics().released,1);
});
for(const key of ['done','value'])test('HTTP stream packet '+key+' accessor is rejected without evaluating it',async()=>{
 let accessed=0;const packet={done:false,value:bytes};Object.defineProperty(packet,key,{get(){accessed++;return key==='done'?false:bytes;}});
 const f=response([packet]);await assert.rejects(readStateRpcJson(f.value),{code:'STATE_RPC_UNAVAILABLE'});assert.equal(accessed,0);assert.equal(f.metrics().released,1);
});
test('non-byte stream chunks cannot be silently reinterpreted as a JSON body',async()=>{
 const f=response([{done:false,value:bytes.buffer.slice(0)}]);await assert.rejects(readStateRpcJson(f.value),{code:'STATE_RPC_UNAVAILABLE'});assert.equal(f.metrics().cancelled,1);assert.equal(f.metrics().released,1);
});
test('split multibyte UTF-8 retains its exact JSON value',async()=>{
 const input=new TextEncoder().encode('{"message":"確認🚀"}'),f=response([...input].map(value=>({done:false,value:Uint8Array.of(value)})));
 assert.deepEqual(await readStateRpcJson(f.value),{message:'確認🚀'});assert.equal(f.metrics().released,1);
});
test('abort during packet descriptor capture prevents another read and discards the body',async()=>{
 const controller=new AbortController();let once=false;const packet=new Proxy({done:false,value:bytes},{getOwnPropertyDescriptor(target,key){if(!once){once=true;controller.abort();}return Reflect.getOwnPropertyDescriptor(target,key);}});
 const f=response([packet]);await assert.rejects(readStateRpcJson(f.value,{signal:controller.signal}),{code:'STATE_RPC_UNAVAILABLE'});assert.equal(f.metrics().reads,1);assert.equal(f.metrics().released,1);
});
for(const emptyChunks of [99999,100000])test('HTTP chunk budget bounds zero-byte streams: '+emptyChunks+' empty chunks',async()=>{
 let reads=0,cancelled=0,released=0;const value={headers:{get:()=>null},body:{getReader:()=>({async read(){const index=reads++;return index<emptyChunks?{done:false,value:new Uint8Array()}:index===emptyChunks?{done:false,value:bytes}:{done:true};},cancel(){cancelled++;},releaseLock(){released++;}})}};
 if(emptyChunks===99999){assert.deepEqual(await readStateRpcJson(value),{ok:true});assert.equal(cancelled,0);}
 else{await assert.rejects(readStateRpcJson(value),{code:'STATE_RPC_UNAVAILABLE'});assert.equal(cancelled,1);assert.equal(reads,100001);}
 assert.equal(released,1);
});
