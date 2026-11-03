import test from 'node:test';
import assert from 'node:assert/strict';
import { mountStorageGuardPanel } from '../examples/storage-guard-panel.js';
import { mountRpcStatusPanel } from '../examples/rpc-status-panel.js';
import { createStorageGuard } from '../src/storage-guard.js';
import { status } from './helpers/rpc-supervisor-fixtures.js';
import { Element } from './helpers/panel-dom.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const snapshot=kind=>kind==='storage'?{...createStorageGuard().state(),active:1,opening:1}:status();
function fixture(kind,overrides={},onFault=()=>{}){
  let observer;const parent=new Element('div'),initial=snapshot(kind);
  const adapter={state:()=>initial,subscribe(fn){observer=fn;fn(initial);return()=>{};},cancelAll:()=>1,...overrides};
  const document={createElement:tag=>new Element(tag)};
  const panel=kind==='storage'?mountStorageGuardPanel({document,parent,guard:adapter}):mountRpcStatusPanel({document,parent,supervisor:adapter,onFault});
  const q=name=>parent.find((kind==='storage'?'storage-guard-':'rpc-status-')+name);
  return{panel,q,adapter,initial,emit:value=>observer(value)};
}
for(const kind of ['storage','rpc'])for(const stop of ['dispose','nested'])test(`${kind} captured observation retires after ${stop}`,()=>{
  const f=fixture(kind),heading=f.q(kind==='storage'?'heading':'headline');let armed=true,before;
  const input={...f.initial,disposed:true,canStart:false};
  try{f.emit(new Proxy(input,{getOwnPropertyDescriptor(target,key){if(armed){armed=false;if(stop==='dispose')f.panel.dispose();else f.emit(null);before=heading.textContent;}return Reflect.getOwnPropertyDescriptor(target,key);}}));assert.equal(heading.textContent,before);}
  finally{f.panel.dispose();}
});
for(const kind of ['storage','rpc'])test(`${kind} asynchronous initial source failure is consumed`,async()=>{
  const f=fixture(kind,{state:()=>Promise.reject(Error('source unavailable')),subscribe:()=>()=>{}});
  try{await tick();assert.match(f.q(kind==='storage'?'heading':'headline').textContent,/取得できません|確認できません/);}finally{f.panel.dispose();}
});
for(const kind of ['storage','rpc'])test(`${kind} asynchronous subscription is retired with late cleanup`,async()=>{
  let retained,cleaned=0;const f=fixture(kind,{subscribe(fn){retained=fn;fn(snapshot(kind));return Promise.resolve(()=>{cleaned++;});}});
  try{await tick();assert.equal(cleaned,1);const heading=f.q(kind==='storage'?'heading':'headline'),before=heading.textContent;retained(snapshot(kind));assert.equal(heading.textContent,before);assert.match(before,/取得できません|確認できません/);}finally{f.panel.dispose();}
});
test('RPC unsubscribe rejection cannot escape disposal',async()=>{
  const f=fixture('rpc',{subscribe:()=>()=>Promise.reject(Error('late cleanup'))});f.panel.dispose();await tick();
});
for(const fail of [false,true])test(`storage stop callback cannot revive removed controls, failure=${fail}`,()=>{
  const f=fixture('storage'),outcome=f.q('action');let before,reads=0;
  f.adapter.cancelAll=()=>{f.panel.dispose();before=outcome.textContent;if(fail)throw Error('late');return 1;};f.adapter.state=()=>{reads++;return f.initial;};
  f.q('stop').click();assert.equal(outcome.textContent,before);assert.equal(reads,0);
});
test('storage stop rejection is consumed and never reports a confirmed count',async()=>{
  const f=fixture('storage',{cancelAll:()=>Promise.reject(Error('stop'))});try{f.q('stop').click();await tick();assert.doesNotMatch(f.q('action').textContent,/件に停止を依頼しました/);}finally{f.panel.dispose();}
});
test('storage nested stop keeps the newer count',()=>{
  const f=fixture('storage');let calls=0;try{f.adapter.cancelAll=()=>{if(++calls===1){f.q('stop').click();return 1;}return 2;};f.q('stop').click();assert.match(f.q('action').textContent,/2件/);}finally{f.panel.dispose();}
});
test('RPC label and clock-fault notification share one captured snapshot',()=>{
  let faults=0;const f=fixture('rpc',{},()=>{faults++;}),reads=new Map();
  try{f.emit(new Proxy(f.initial,{getOwnPropertyDescriptor(target,key){const n=(reads.get(key)??0)+1;reads.set(key,n);const original=Reflect.getOwnPropertyDescriptor(target,key);return n===1?original:{...original,value:key==='fault'?'RPC_CLOCK':key==='canStart'?false:original.value};}}));
    assert.equal(faults,0);assert.ok([...reads.values()].every(n=>n===1));
  }finally{f.panel.dispose();}
});
test('RPC fault capture that disposes the panel cannot issue a new owner notification',()=>{
  let faults=0;const f=fixture('rpc',{},()=>{faults++;});let armed=true;
  f.emit(new Proxy(status({fault:'RPC_CLOCK',canStart:false}),{getOwnPropertyDescriptor(target,key){if(armed){armed=false;f.panel.dispose();}return Reflect.getOwnPropertyDescriptor(target,key);}}));assert.equal(faults,0);
});
test('RPC malformed async fault observer is consumed and remains one-shot',async()=>{
  let faults=0;const f=fixture('rpc',{},()=>{faults++;return{async then(){throw Error('observer then failure');}};});
  try{f.emit(status({fault:'RPC_CLOCK',canStart:false}));await tick();f.emit(status({fault:'RPC_CLOCK',canStart:false}));assert.equal(faults,1);}finally{f.panel.dispose();}
});
