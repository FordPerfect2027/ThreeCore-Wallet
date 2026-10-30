import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSecurityJournalPanel } from '../examples/security-journal-panel.js';
import { createSecurityJournal, validateSecurityJournal } from '../src/security-journal.js';
import { Element } from './helpers/panel-dom.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function state(kind='manual'){const journal=createSecurityJournal();journal.record(kind);return journal.state();}
class TestElement extends Element {
  handlers=new Map();addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
function fixture(read=()=>state()){
  const parent=new TestElement('div');const panel=mountSecurityJournalPanel({document:{createElement:tag=>new TestElement(tag)},parent,journal:{state:read}});
  const q=name=>parent.find('security-journal-'+name);return {panel,q,run:name=>q(name).run()};
}
test('journal captures event array length without reading source properties',()=>{
  let reads=0;const source=state(),events=new Proxy([...source.events],{get(){reads++;throw Error('array value read');}});
  const result=validateSecurityJournal({...source,events});assert.equal(result.events.length,1);assert.equal(reads,0);
});
test('journal panel summary reads the validated snapshot instead of the original object',()=>{
  let reads=0;const source=new Proxy(state(),{get(target,key){if(key==='then')return undefined;reads++;throw Error('source read');}});
  const f=fixture(()=>source);try{assert.match(f.q('summary').textContent,/1 件/);assert.equal(reads,0);}finally{f.panel.dispose();}
});
for(const action of ['render','prepare'])for(const stop of ['close','dispose'])test(`journal ${action}: ${stop} during source capture retires display`,()=>{
  let f,armed=false,output,notice,before;
  f=fixture(()=>{if(armed){armed=false;output=f.q('output');notice=f.q('notice');if(stop==='close')f.run('close');else f.panel.dispose();before=notice.textContent;}return state();});
  try{armed=true;if(action==='render')f.panel.render();else f.run('prepare');assert.equal(output.value,'');assert.equal(notice.textContent,before);}finally{f.panel.dispose();}
});
for(const failure of ['throw','reject','invalid'])test(`journal unavailable ${failure} state clears prior copy without leaking diagnostics`,async()=>{
  let armed=false;const f=fixture(()=>{if(!armed)return state();if(failure==='throw')throw Error('sensitive diagnostic');if(failure==='reject')return Promise.reject(Error('sensitive diagnostic'));return {...state(),total:'sensitive diagnostic'};});
  try{f.run('prepare');assert.ok(f.q('output').value);armed=true;assert.doesNotThrow(()=>f.panel.render());await tick();
    assert.equal(f.q('output').value,'');assert.match(f.q('notice').textContent,/確認できません/);assert.doesNotMatch(f.q('notice').textContent,/sensitive/);
  }finally{f.panel.dispose();}
});
test('journal changed contents invalidate an open copy even when total count is unchanged',()=>{
  let source=state();const f=fixture(()=>source);
  try{f.run('prepare');source=state('idle');f.panel.render();assert.equal(f.q('output').value,'');assert.match(f.q('notice').textContent,/新しい記録/);}finally{f.panel.dispose();}
});
test('journal source reentry remains bounded and cannot refill a closed copy',()=>{
  let f,armed=false,reads=0;f=fixture(()=>{if(armed){reads++;if(reads>5)throw Error('unbounded');f.panel.render();}return state();});
  try{armed=true;assert.doesNotThrow(()=>f.panel.render());assert.equal(reads,1);assert.equal(f.q('output').value,'');}finally{f.panel.dispose();}
});
test('journal retained close handler cannot update removed UI',()=>{
  const f=fixture(),close=f.q('close').handlers.get('click'),notice=f.q('notice');f.panel.dispose();const before=notice.textContent;close();assert.equal(notice.textContent,before);
});
test('journal normal current snapshot remains exportable and closing does not erase the journal',()=>{
  const source=state(),f=fixture(()=>source);try{f.run('prepare');const copy=JSON.parse(f.q('output').value);assert.equal(copy.total,1);f.run('close');f.run('prepare');assert.equal(JSON.parse(f.q('output').value).total,1);}finally{f.panel.dispose();}
});
