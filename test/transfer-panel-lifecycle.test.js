import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTransferPanel } from '../examples/transfer-panel.js';
import { Element } from './helpers/panel-dom.js';
import { context, snapshot, deferred, tick } from './helpers/transfer-fixtures.js';
class TestElement extends Element {
  handlers=new Map();
  addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
function fixture(options={}) {
  const parent=new TestElement('div'),downloads=[];
  const panel=mountTransferPanel({document:{createElement:tag=>new TestElement(tag)},parent,getContext:context,
    read:async()=>snapshot(),download:value=>{downloads.push(value);},...options});
  const q=name=>parent.find('transfer-'+name);return {parent,panel,q,downloads,run:name=>q(name).run()};
}
async function until(check){const limit=Date.now()+3000;while(!check()){assert.ok(Date.now()<limit);await tick();}}
async function ready(f){f.run('read');await until(()=>!f.q('save-json').disabled);}
for(const callback of ['onCancel','onStateChange']) test(`transfer ${callback} consumes asynchronous observer failures`,async()=>{
  let calls=0;const f=fixture({[callback](){return {then(resolve,reject){calls++;reject(Error('synthetic notification'));}};}});
  try{if(callback==='onCancel')f.run('cancel');await tick();assert.equal(calls,1);}finally{f.panel.dispose();}
});
test('transfer cancellation survives a throwing notification',()=>{
  const f=fixture({onCancel(){throw Error('synthetic notification');}});
  try{assert.doesNotThrow(()=>f.run('cancel'));assert.equal(f.q('panel').getAttribute('aria-busy'),'false');}finally{f.panel.dispose();}
});
for(const ending of ['dispose','invalidate']) test(`transfer window callback ${ending} cannot write late status`,async()=>{
  let f,node,before;f=fixture({onCancel(){node=f.q('window-status');f.panel[ending]();before=node.textContent;}});
  try{await ready(f);f.run('window-pin');assert.equal(node.textContent,before);}finally{f.panel.dispose();}
});
for(const format of ['json','csv','txt']) for(const receipt of ['false','resolved','rejected']) test(`transfer ${format} ${receipt} download receipt is refused`,async()=>{
  const f=fixture({download:()=>receipt==='false'?false:receipt==='resolved'?Promise.resolve(true):Promise.reject(Error('synthetic refusal'))});
  try{await ready(f);await f.run('save-'+format);assert.match(f.q('status').textContent,/保存できません/);}finally{f.panel.dispose();}
});
test('transfer asynchronous receipt does not hold the handler open',async()=>{
  const hold=deferred();let started=false,done=false,task;
  const f=fixture({download(){started=true;return hold.promise;}});
  try{await ready(f);task=f.run('save-json');task.finally(()=>{done=true;});await until(()=>started);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(done,true);}
  finally{hold.resolve();await task;f.panel.dispose();}
});
test('transfer queued cancellation after preparation prevents delivery',async()=>{
  let f,preparing=false,queued=false;
  f=fixture({onStateChange(state){if(state.phase==='preparing')preparing=true;if(preparing&&state.phase==='ready'&&!queued){queued=true;queueMicrotask(()=>f.run('cancel'));}}});
  try{await ready(f);await f.run('save-json');assert.equal(queued,true);assert.equal(f.downloads.length,0);}finally{f.panel.dispose();}
});
for(const ending of ['dispose','invalidate']) test(`transfer archive capture ${ending} cannot return stale evidence`,async()=>{
  let f,armed=false;f=fixture({getContext(){if(armed){armed=false;f.panel[ending]();}return context();}});
  try{await ready(f);armed=true;assert.equal(f.panel.exportArchive(),null);}finally{f.panel.dispose();}
});
test('transfer stage permission cannot open a disposed archive',()=>{
  const f=fixture(),node=f.q('archive-panel');let before;
  const result=f.panel.stageArchive(null,{current(){f.panel.dispose();before=node.open;return true;}});
  assert.equal(result,false);assert.equal(node.open,before);
});
test('transfer asynchronous stage permission failure is consumed',async()=>{
  let calls=0;const f=fixture();
  try{assert.equal(f.panel.stageArchive(null,{current(){return {then(resolve,reject){calls++;reject(Error('synthetic permission'));}};}}),false);await tick();assert.equal(calls,1);}finally{f.panel.dispose();}
});
test('transfer ordinary synchronous downloads preserve all three formats',async()=>{
  const f=fixture();try{await ready(f);for(const kind of ['json','csv','txt'])await f.run('save-'+kind);assert.equal(f.downloads.length,3);}finally{f.panel.dispose();}
});
