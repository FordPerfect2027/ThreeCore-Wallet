import test from 'node:test';
import assert from 'node:assert/strict';
import { mountAllowancePanel } from '../examples/allowance-panel.js';
import { Element } from './helpers/panel-dom.js';
import { targets, record, S1, ACCOUNT, deferred, tick } from './helpers/allowance-fixtures.js';
class TestElement extends Element {
  handlers=new Map();
  addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
function fixture(options={}) {
  const parent=new TestElement('div'),downloads=[];
  const panel=mountAllowancePanel({document:{createElement:tag=>new TestElement(tag)},parent,
    getContext:()=>({...targets(),account:ACCOUNT}),read:async plan=>record({targets:plan}),downloadFile:value=>{downloads.push(value);},...options});
  const q=name=>parent.find('allowance-'+name),run=name=>q(name).run();
  return {parent,panel,q,run,downloads,configure(){q('draft').value=S1;run('preview');run('apply');}};
}
async function until(check){const limit=Date.now()+3000;while(!check()){assert.ok(Date.now()<limit);await tick();}}
async function ready(f,action){f.configure();if(action==='save'){f.run('inspect');await until(()=>!f.q('save').disabled);}}
for(const action of ['save','save-targets']) for(const receipt of ['false','resolved','rejected']) test(`allowance ${action}: ${receipt} receipt cannot report success`,async()=>{
  const f=fixture({downloadFile:()=>receipt==='false'?false:receipt==='resolved'?Promise.resolve(true):Promise.reject(Error('synthetic refusal'))});
  try{await ready(f,action);await f.run(action);assert.equal(f.q('status').textContent.includes('保存ファイルを用意しました'),false);}finally{f.panel.dispose();}
});
for(const action of ['save','save-targets']) test(`allowance ${action}: an asynchronous receipt cannot hold the click handler open`,async()=>{
  const hold=deferred();let started=false,done=false,task;
  const f=fixture({downloadFile(){started=true;return hold.promise;}});
  try{await ready(f,action);task=f.run(action);task.finally(()=>{done=true;});await until(()=>started);
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(done,true);assert.equal(f.q('status').textContent.includes('用意しました'),false);
  }finally{hold.resolve();await task;f.panel.dispose();}
});
test('allowance summary disposal prevents later rendering',()=>{
  let f,status,section,before;
  f=fixture({onStateChange(state){if(f&&state.phase==='reading'){status=f.q('status');section=f.q('panel');f.panel.dispose();before=[status.textContent,section.getAttribute('aria-busy')];}}});
  f.configure();f.run('inspect');assert.deepEqual([status.textContent,section.getAttribute('aria-busy')],before);
});
test('allowance asynchronous summary rejection is consumed',async()=>{
  let calls=0;const f=fixture({onStateChange(){return {then(resolve,reject){calls++;reject(Error('synthetic summary failure'));}};}});
  try{await tick();assert.equal(calls,1);assert.equal(f.q('inspect').disabled,true);}finally{f.panel.dispose();}
});
test('allowance both ordinary synchronous file handoffs remain available',async()=>{
  const f=fixture();try{await ready(f,'save');await f.run('save');await f.run('save-targets');assert.equal(f.downloads.length,2);}finally{f.panel.dispose();}
});
