import test from 'node:test';
import assert from 'node:assert/strict';
import {observeWalletProvider} from '../src/provider-events.js';
import {createProviderEventGate} from '../src/provider-event-gate.js';

const tick=()=>new Promise(setImmediate);
const malformed=()=>({async then(){throw Error('private adapter failure');}});
function fixture(){
 const active=new Map(),retained=[];let deliveries=0;
 const provider={on(name,fn){active.set(name,fn);retained.push(fn);return this;},removeListener(name){active.delete(name);return this;}};
 const handlers={accountsChanged(){deliveries++;},chainChanged(){deliveries++;},disconnect(){deliveries++;}};
 return {provider,handlers,active,retained,deliveries:()=>deliveries};
}
for(const phase of ['registration','removal'])test('malformed asynchronous '+phase+' result is consumed after listeners close',async()=>{
 const f=fixture(),key=phase==='registration'?'on':'removeListener',original=f.provider[key];let attempts=0;
 f.provider[key]=function(...args){attempts++;original.apply(this,args);return malformed();};
 if(phase==='registration')assert.throws(()=>observeWalletProvider(f.provider,f.handlers),{code:'PROVIDER_EVENT_FAILURE'});
 else observeWalletProvider(f.provider,f.handlers).dispose();
 await tick();assert.equal(f.active.size,0);assert.equal(attempts,phase==='registration'?1:3);
 f.retained.forEach(fn=>fn([]));assert.equal(f.deliveries(),0);
});
for(const [name,make] of [['native',()=>Promise.reject(Error('private currentness rejection'))],['malformed',malformed]]){
 test('asynchronous owner guard cannot register listeners: '+name,async()=>{
  const f=fixture();assert.throws(()=>observeWalletProvider(f.provider,f.handlers,make),{code:'PROVIDER_EVENT_FAILURE'});
  await tick();assert.equal(f.active.size,0);assert.equal(f.retained.length,0);
 });
 test('asynchronous owner guard blocks event delivery: '+name,async()=>{
  const f=fixture();let enabled=true;const observer=observeWalletProvider(f.provider,f.handlers,()=>enabled?true:make());
  enabled=false;f.active.get('accountsChanged')([]);await tick();assert.equal(f.deliveries(),0);observer.dispose();assert.equal(f.active.size,0);
 });
}
test('guard that disposes its observer cannot authorize payload inspection',()=>{
 const f=fixture();let observer,stop=false,reads=0;
 observer=observeWalletProvider(f.provider,f.handlers,()=>{if(stop)observer.dispose();return true;});
 stop=true;const payload=new Proxy([],{getOwnPropertyDescriptor(target,key){reads++;return Reflect.getOwnPropertyDescriptor(target,key);}});
 f.active.get('accountsChanged')(payload);assert.equal(reads,0);assert.equal(f.deliveries(),0);assert.equal(f.active.size,0);
});
test('then accessor that closes observer cannot authorize payload inspection',()=>{
 const f=fixture();let observer,stop=false,reads=0;
 const result=Object.defineProperty({},'then',{get(){observer.dispose();return undefined;}});
 observer=observeWalletProvider(f.provider,f.handlers,()=>stop?result:true);
 stop=true;f.active.get('accountsChanged')(new Proxy([],{getOwnPropertyDescriptor(target,key){reads++;return Reflect.getOwnPropertyDescriptor(target,key);}}));
 assert.equal(reads,0);assert.equal(f.active.size,0);assert.equal(f.deliveries(),0);
});
test('provider identity returned from listener methods is never inspected as a promise',()=>{
 const f=fixture();let reads=0;Object.defineProperty(f.provider,'then',{get(){reads++;throw Error('identity must be exempt');}});
 const observer=observeWalletProvider(f.provider,f.handlers);f.active.get('chainChanged')('0x2105');observer.dispose();
 assert.equal(reads,0);assert.equal(f.deliveries(),1);
});
for(const [name,make] of [['native',()=>Promise.reject(Error('clock failure'))],['malformed',malformed]])test('asynchronous event clock closes gate without leaking rejection: '+name,async()=>{
 let calls=0;const gate=createProviderEventGate({now(){calls++;return make();}});
 assert.equal(gate.accept(),false);await tick();assert.equal(gate.state().reason,'clock');assert.equal(gate.accept(),false);assert.equal(calls,1);
});
test('reentrant event clock closes both nested and outer ingress permanently',()=>{
 let gate,nested=false,calls=0;
 gate=createProviderEventGate({now(){calls++;if(!nested){nested=true;assert.equal(gate.accept(),false);}return 0;}});
 assert.equal(gate.accept(),false);assert.equal(gate.state().blocked,true);assert.equal(gate.state().reason,'clock');assert.equal(gate.state().count,0);
 assert.equal(gate.accept(),false);assert.equal(calls,1);
});
test('clock-result inspection cannot reopen a gate stopped during reentry',()=>{
 let gate,calls=0;
 gate=createProviderEventGate({now(){calls++;return Object.defineProperty({},'then',{get(){assert.equal(gate.accept(),false);return undefined;}});}});
 assert.equal(gate.accept(),false);assert.equal(gate.state().blocked,true);assert.equal(gate.state().count,0);assert.equal(calls,1);
});
test('ordinary event clock still renews the bounded window',()=>{
 let now=0;const gate=createProviderEventGate({now:()=>now,limit:1});assert.equal(gate.accept(),true);now=1000;assert.equal(gate.accept(),true);assert.equal(gate.state().count,1);
});
