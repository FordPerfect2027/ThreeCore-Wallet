import test from 'node:test';
import assert from 'node:assert/strict';
import { mountFileReadPanel } from '../examples/file-read-panel.js';
import { mountExportGuardPanel } from '../examples/export-guard-panel.js';
import { Element } from './helpers/panel-dom.js';
import { guardFixture } from './helpers/export-fixtures.js';
import { FILE_READ_RESERVED_LIMIT } from '../src/file-read-policy.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fileState=()=>({schema:'threecore-file-read-status-v1',disposed:false,clockFault:false,canStart:true,active:1,waiting:1,retained:0,reservedBytes:1,maxActive:4,maxReservedBytes:FILE_READ_RESERVED_LIMIT,accepted:1,completed:0,failed:0,cancelled:0,timedOut:0,rejected:0});
function exportState(){const f=guardFixture();f.offer();const value=f.guard.state();f.guard.dispose();return value;}
function fixture(kind,options={}) {
  const parent=new Element('div');parent.dataset={};let observer;
  const initial=kind==='file'?fileState():exportState();
  const adapter={state:()=>initial,subscribe(fn){observer=fn;fn(initial);return()=>{};},cancelAll:()=>1,clear:()=>true,retryCleanup:()=>true,...options};
  const document={createElement(tag){const element=new Element(tag);element.dataset={};return element;}};
  const panel=kind==='file'?mountFileReadPanel({document,parent,service:adapter}):mountExportGuardPanel({document,parent,guard:adapter});
  const q=name=>parent.find((kind==='file'?'file-read-':'export-guard-')+name);
  return {panel,q,adapter,initial,emit:value=>observer(value),action:()=>q(kind==='file'?'stop':'clear').click(),outcome:()=>q(kind==='file'?'action':'outcome')};
}
for(const kind of ['file','export'])test(`${kind} status capture cannot revive a disposed panel`,()=>{
  const f=fixture(kind),title=f.q(kind==='file'?'headline':'title');let before,armed=true;
  const changed={...f.initial,disposed:true,[kind==='file'?'canStart':'canOffer']:false};
  const input=new Proxy(changed,{getOwnPropertyDescriptor(target,key){if(armed){armed=false;f.panel.dispose();before=title.textContent;}return Reflect.getOwnPropertyDescriptor(target,key);}});
  f.emit(input);assert.equal(title.textContent,before);
});
for(const kind of ['file','export'])test(`${kind} nested status notification wins over its outer capture`,()=>{
  const f=fixture(kind);let armed=true;
  try{const input=new Proxy(f.initial,{getOwnPropertyDescriptor(target,key){if(armed){armed=false;f.emit(null);}return Reflect.getOwnPropertyDescriptor(target,key);}});
    f.emit(input);assert.match(f.q(kind==='file'?'headline':'title').textContent,/取得できません|確認できません/);
  }finally{f.panel.dispose();}
});
for(const kind of ['file','export'])for(const fail of [false,true])test(`${kind} stop completion after disposal cannot update UI, throw=${fail}`,()=>{
  const f=fixture(kind),outcome=f.outcome();let before;
  f.adapter[kind==='file'?'cancelAll':'clear']=()=>{f.panel.dispose();before=outcome.textContent;if(fail)throw Error('late');return kind==='file'?1:true;};
  f.action();assert.equal(outcome.textContent,before);
});
for(const kind of ['file','export'])test(`${kind} asynchronous stop failure is consumed without claiming success`,async()=>{
  const f=fixture(kind,{[kind==='file'?'cancelAll':'clear']:()=>Promise.reject(Error('late stop'))});
  try{f.action();await tick();assert.doesNotMatch(f.outcome().textContent,/停止しました|解放を確認しました/);}finally{f.panel.dispose();}
});
for(const kind of ['file','export'])test(`${kind} asynchronous subscription is retired and its late cleanup runs`,async()=>{
  let retained,released=0;
  const f=fixture(kind,{subscribe(fn){retained=fn;fn(kind==='file'?fileState():exportState());return Promise.resolve(()=>{released++;});}});
  try{await tick();const title=f.q(kind==='file'?'headline':'title'),before=title.textContent;retained(f.initial);
    assert.equal(released,1);assert.equal(title.textContent,before);assert.match(before,/取得できません|確認できません/);
  }finally{f.panel.dispose();}
});
for(const kind of ['file','export'])test(`${kind} unsubscribe rejection is consumed`,async()=>{
  const f=fixture(kind,{subscribe(fn){fn(kind==='file'?fileState():exportState());return()=>Promise.reject(Error('late cleanup'));}});
  f.panel.dispose();await tick();
});
test('export controls and labels use one captured status',()=>{
  const f=fixture('export'),seen=new Map();
  try{f.emit(new Proxy(f.initial,{getOwnPropertyDescriptor(target,key){seen.set(key,(seen.get(key)??0)+1);return Reflect.getOwnPropertyDescriptor(target,key);}}));
    assert.ok([...seen.values()].every(n=>n===1));assert.equal(f.q('clear').disabled,false);assert.match(f.q('title').textContent,/保持/);
  }finally{f.panel.dispose();}
});
test('export missing initial status disables actions and explains unavailability',()=>{
  const f=fixture('export',{subscribe(){return()=>{};}});
  try{assert.equal(f.q('clear').disabled,true);assert.equal(f.q('retry').disabled,true);assert.match(f.q('title').textContent,/確認できません/);}finally{f.panel.dispose();}
});
test('file asynchronous initial state rejection is consumed',async()=>{
  const f=fixture('file',{state:()=>Promise.reject(Error('state unavailable')),subscribe:()=>()=>{}});
  try{await tick();assert.match(f.q('headline').textContent,/取得できません/);}finally{f.panel.dispose();}
});
for(const kind of ['file','export'])test(`${kind} nested explicit action owns the final status`,()=>{
  const f=fixture(kind);let n=0;
  try{f.adapter[kind==='file'?'cancelAll':'clear']=()=>{if(++n===1){f.action();return kind==='file'?1:true;}return kind==='file'?2:false;};
    f.action();assert.match(f.outcome().textContent,kind==='file'?/2件/:/まだ解放/);
  }finally{f.panel.dispose();}
});
for(const kind of ['file','export'])test(`${kind} synchronous stop receipt remains visible`,()=>{
  const f=fixture(kind);try{f.action();assert.match(f.outcome().textContent,kind==='file'?/1件の待機を停止/:/解放を確認しました/);}finally{f.panel.dispose();}
});
