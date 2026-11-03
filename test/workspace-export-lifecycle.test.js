import test from 'node:test';
import assert from 'node:assert/strict';
import { mountWorkspacePanel } from '../examples/workspace-panel.js';
import { Element } from './helpers/panel-dom.js';
import { draft, text, gate, tick, until } from './helpers/workspace-fixtures.js';

class TestElement extends Element {
  handlers=new Map();
  addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
function fixture(options={}) {
  const parent=new TestElement('div'),downloads=[];
  const panel=mountWorkspacePanel({document:{createElement:tag=>new TestElement(tag)},parent,
    readDraft:draft,writeDraft(){throw Error('unexpected write');},download:({prepared})=>{downloads.push(prepared);},...options});
  const q=name=>parent.find('workspace-'+name);
  return {parent,panel,q,downloads,run:name=>q(name).run()};
}
for(const ending of ['cancel','stage','invalidate','dispose']) test(`workspace export: ${ending} settles a stalled checksum wait`,async()=>{
  const hold=gate();let started=false,settled=false,task;
  const f=fixture({subtle:{async digest(algorithm,bytes){started=true;await hold.promise;return crypto.subtle.digest(algorithm,bytes);}}});
  try{
    task=f.run('save');task.finally(()=>{settled=true;});await until(()=>started);
    if(ending==='cancel')f.run('cancel');else if(ending==='stage')f.panel.stageText(text());else f.panel[ending]();
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(settled,true,'the retired export is still waiting');assert.equal(f.downloads.length,0);
  }finally{hold.resolve();await task;f.panel.dispose();}
});
for(const action of ['inspect','save']) test(`workspace ${action}: error accessors are not evaluated`,async()=>{
  let active=false,reads=0;
  const error=Object.defineProperty({},'code',{get(){reads++;return 'WORKSPACE_DOWNLOAD';}});
  const f=fixture({readDraft(){if(active)throw error;return draft();}});
  try{active=true;await f.run(action);assert.equal(reads,0);assert.equal(typeof f.q('status').textContent,'string');}
  finally{f.panel.dispose();}
});
for(const action of ['inspect','save']) test(`workspace ${action}: diagnostic capture cannot revive a disposed panel`,async()=>{
  let active=false,f,status,before;
  function stop(){status=f.q('status');f.panel.dispose();before=status.textContent;}
  const error=new Proxy({code:'WORKSPACE_DOWNLOAD'},{
    getOwnPropertyDescriptor(target,key){stop();return Reflect.getOwnPropertyDescriptor(target,key);},
    get(target,key){stop();return Reflect.get(target,key);}
  });
  f=fixture({readDraft(){if(active)throw error;return draft();}});
  active=true;await f.run(action);assert.equal(status.textContent,before);
});
for(const code of ['constructor','toString','__proto__']) test(`workspace diagnostic ${code} uses the unknown-code message`,async()=>{
  let active=false;const f=fixture({readDraft(){if(active)throw {code};return draft();}});
  try{active=true;await f.run('inspect');assert.equal(typeof f.q('status').textContent,'string');
    assert.match(f.q('status').textContent,/操作は完了していません/);
  }finally{f.panel.dispose();}
});
test('workspace old export completion cannot retire a newer export',async()=>{
  const first=gate(),second=gate();let hashes=0,a,b;
  const f=fixture({subtle:{async digest(algorithm,bytes){
    const n=++hashes;if(n===1)await first.promise;if(n===2)await second.promise;
    return crypto.subtle.digest(algorithm,bytes);
  }}});
  try{
    a=f.run('save');await until(()=>hashes===1);f.run('cancel');b=f.run('save');await until(()=>hashes===2);
    first.resolve();await a;await tick();assert.equal(f.q('panel').getAttribute('aria-busy'),'true');
    second.resolve();await b;assert.equal(f.downloads.length,1);assert.equal(f.q('save').disabled,false);
  }finally{first.resolve();second.resolve();await Promise.all([a,b]);f.panel.dispose();}
});
