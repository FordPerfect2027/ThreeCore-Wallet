import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTransferArchivePanel } from '../examples/transfer-archive-panel.js';
import { Element } from './helpers/panel-dom.js';
import { context, snapshot, deferred, tick } from './helpers/transfer-fixtures.js';
class TestElement extends Element {
  handlers=new Map();
  addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
  setAttribute(name,value){super.setAttribute(name,value);this.onAttribute?.(name,value);}
}
function fixture(options={}) {
  const parent=new TestElement('div'),downloads=[];
  const panel=mountTransferArchivePanel({document:{createElement:tag=>new TestElement(tag)},parent,getContext:context,
    getSnapshot:snapshot,onSelect(){},download:value=>{downloads.push(value);},...options});
  const q=name=>parent.find('transfer-archive-'+name);return {parent,panel,q,downloads,run:name=>q(name).run()};
}
async function until(check){const limit=Date.now()+3000;while(!check()){assert.ok(Date.now()<limit);await tick();}}
for(const ending of ['dispose','invalidate']) test(`archive source ${ending} prevents an old record being added`,()=>{
  let f,armed=false,node,before;
  f=fixture({getSnapshot(){if(armed){armed=false;node=f.q('overview');f.panel[ending]();before=node.textContent;}return snapshot();}});
  try{armed=true;f.run('add');assert.equal(node.textContent,before);assert.equal(f.panel.getArchive(),null);}finally{f.panel.dispose();}
});
test('archive source asynchronous failures are consumed',async()=>{
  let armed=false,calls=0;
  const f=fixture({getSnapshot(){return armed?{then(resolve,reject){calls++;reject(Error('synthetic source'));}}:snapshot();}});
  try{armed=true;f.run('add');await tick();assert.equal(calls,1);assert.equal(f.panel.getArchive(),null);}finally{f.panel.dispose();}
});
test('archive refresh cannot rewrite controls after source disposal',()=>{
  let f,armed=false,save;
  f=fixture({getSnapshot(){if(armed){armed=false;save=f.q('save');f.panel.dispose();save.disabled=true;}return snapshot();}});
  f.run('add');armed=true;f.panel.refresh();assert.equal(save.disabled,true);
});
for(const receipt of ['false','resolved','rejected']) test(`archive ${receipt} download receipt reports refusal`,async()=>{
  const f=fixture({download:()=>receipt==='false'?false:receipt==='resolved'?Promise.resolve(true):Promise.reject(Error('synthetic refusal'))});
  try{f.run('add');await f.run('save');assert.match(f.q('status').textContent,/保存できません/);}finally{f.panel.dispose();}
});
test('archive asynchronous download receipt cannot hold the handler open',async()=>{
  const hold=deferred();let task,started=false,done=false;
  const f=fixture({download(){started=true;return hold.promise;}});
  try{f.run('add');task=f.run('save');task.finally(()=>{done=true;});await until(()=>started);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(done,true);}
  finally{hold.resolve();await task;f.panel.dispose();}
});
test('archive cancellation queued after preparation prevents delivery',async()=>{
  const f=fixture();let busy=false,queued=false;
  try{f.run('add');f.q('panel').onAttribute=(name,value)=>{if(name!=='aria-busy')return;if(value==='true')busy=true;
    if(busy&&value==='false'&&!queued){queued=true;queueMicrotask(()=>f.run('cancel'));}};
    await f.run('save');assert.equal(queued,true);assert.equal(f.downloads.length,0);
  }finally{f.panel.dispose();}
});
for(const ending of ['dispose','invalidate']) test(`archive download ${ending} cannot overwrite newer status`,async()=>{
  let f,node,before;
  f=fixture({download(){node=f.q('status');f.panel[ending]();before=node.textContent;throw Error('synthetic refusal');}});
  try{f.run('add');await f.run('save');assert.equal(node.textContent,before);}finally{f.panel.dispose();}
});
test('archive cancelled selection ignores a late display failure',async()=>{
  const hold=deferred(),f=fixture({onSelect:()=>hold.promise});let task;
  try{f.run('add');task=f.run('select');f.run('cancel');const before=f.q('status').textContent;
    hold.reject(Error('synthetic late display failure'));await task;assert.equal(f.q('status').textContent,before);
  }finally{hold.resolve();await task;f.panel.dispose();}
});
test('archive ordinary add, select and download remain explicit',async()=>{
  let selected=0;const f=fixture({onSelect(){selected++;}});
  try{f.run('add');await f.run('select');await f.run('save');assert.equal(selected,1);assert.equal(f.downloads.length,1);}finally{f.panel.dispose();}
});
test('archive refresh bounds a source callback that requests another refresh',()=>{
  let f,armed=false,calls=0;
  f=fixture({getSnapshot(){if(armed){calls++;f.panel.refresh();}return snapshot();}});
  try{armed=true;f.panel.refresh();assert.equal(calls,1);assert.equal(f.q('add').disabled,false);}finally{f.panel.dispose();}
});
test('archive retained handlers cannot consult sources after disposal',()=>{
  let calls=0;const f=fixture({getSnapshot(){calls++;return snapshot();}});
  const add=f.q('add').handlers.get('click');f.panel.dispose();const before=calls;
  add();assert.equal(calls,before);assert.equal(f.panel.stageArchive(null),false);
});
