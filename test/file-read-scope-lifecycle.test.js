import test from 'node:test';
import assert from 'node:assert/strict';
import {createFileReadScope} from '../src/security-file.js';
import {walletFileReadService} from '../src/file-read-service.js';
const tick=()=>new Promise(setImmediate),bytes=()=>new TextEncoder().encode('x').buffer;
const outcome=p=>p.then(value=>({value}),error=>({code:error.code}));
function gate(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function stream(onCancel){const hold=gate();return{hold,file:{size:1,stream:()=>({getReader:()=>({read:()=>hold.promise,cancel:onCancel,releaseLock(){}})})}};}
for(const action of ['stop','replace'])test('scope replacement cannot overtake a newer '+action+' raised by stream cleanup',async()=>{
 const scope=createFileReadScope(),next=gate();let nested,opened=0;
 const old=stream(()=>{if(action==='stop')scope.cancel();else nested=outcome(scope.readText({size:1,arrayBuffer:()=>next.promise}));});
 const previous=outcome(scope.readText(old.file));await tick();
 try{
  const superseded=await outcome(scope.readText({size:1,arrayBuffer(){opened++;return bytes();}}));
  assert.equal(superseded.code,'FILE_CANCELLED');assert.equal(opened,0);assert.equal((await previous).code,'FILE_CANCELLED');
  if(action==='replace'){scope.cancel();next.resolve(bytes());assert.equal((await nested).code,'FILE_CANCELLED');}
 }finally{scope.cancel();old.hold.resolve({done:true});next.resolve(bytes());await previous;await nested;await tick();assert.equal(walletFileReadService.state().active,0);}
});
for(const key of ['maxBytes','timeoutMs'])for(const action of ['stop','replace'])test(`scope ${key} capture retains a newer ${action}`,async()=>{
 const scope=createFileReadScope(),next=gate();let nested,opened=0;
 const options={[key]:undefined};Object.defineProperty(options,key,{get(){if(action==='stop')scope.cancel();else nested=outcome(scope.readText({size:1,arrayBuffer:()=>next.promise}));return key==='maxBytes'?1:10000;}});
 try{
  const superseded=await outcome(scope.readText({size:1,arrayBuffer(){opened++;return bytes();}},options));
  assert.equal(superseded.code,'FILE_CANCELLED');assert.equal(opened,0);
  if(action==='replace'){scope.cancel();next.resolve(bytes());assert.equal((await nested).code,'FILE_CANCELLED');}
 }finally{scope.cancel();next.resolve(bytes());await nested;await tick();assert.equal(walletFileReadService.state().active,0);}
});
test('scope invalid options release ownership and allow a later native File',async()=>{
 const scope=createFileReadScope();await assert.rejects(scope.readText(new File(['x'],'x.json'),null));
 assert.equal(await scope.readText(new File(['next'],'next.json')),'next');assert.equal(scope.cancel(),undefined);await tick();assert.equal(walletFileReadService.state().active,0);
});
test('ordinary scope replacement still preserves a newer read after old worker settlement',async()=>{
 const scope=createFileReadScope(),a=gate(),b=gate();
 const first=outcome(scope.readText({size:1,arrayBuffer:()=>a.promise}));await tick();
 const second=outcome(scope.readText({size:1,arrayBuffer:()=>b.promise}));await tick();
 try{assert.equal((await first).code,'FILE_CANCELLED');a.resolve(bytes());await tick();scope.cancel();assert.equal((await second).code,'FILE_CANCELLED');}
 finally{scope.cancel();a.resolve(bytes());b.resolve(bytes());await first;await second;await tick();assert.equal(walletFileReadService.state().active,0);}
});
