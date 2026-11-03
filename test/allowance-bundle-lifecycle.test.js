import test from 'node:test';
import assert from 'node:assert/strict';
import { mountAllowanceBundlePanel } from '../examples/allowance-bundle-panel.js';
import { captureAllowanceBundle, prepareAllowanceBundle } from '../src/allowance-bundle.js';
import { Element } from './helpers/panel-dom.js';
import { record, deferred, tick } from './helpers/allowance-fixtures.js';

const records=()=>['DAT','EMA','CAWELON'].map(agent=>record({},agent));
class TestElement extends Element {
  handlers=new Map();
  addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
function fixture(options={}) {
  const parent=new TestElement('div'), downloads=[];
  const panel=mountAllowanceBundlePanel({document:{createElement:tag=>new TestElement(tag)},parent,
    readRecords:records,downloadFile:file=>{downloads.push(file);},...options});
  const q=name=>parent.find('allowance-bundle-'+name);
  return {parent,panel,q,downloads,run:name=>q(name).run()};
}
async function until(predicate) {
  const deadline=Date.now()+2000;
  while(!predicate()){assert.ok(Date.now()<deadline,'local fixture did not start');await tick();}
}
async function file() {
  const p=await prepareAllowanceBundle(captureAllowanceBundle(records()));
  const bytes=new TextEncoder().encode(p.text);
  return {name:p.filename,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer};
}
for(const action of ['save','load-hash','load-bytes']) for(const ending of ['cancel','clear','dispose']) {
  test(`bundle ${action}: ${ending} settles before the underlying operation`,async()=>{
    const gate=deferred();let started=false,settled=false,task;
    const selected=await file();
    const f=fixture({subtle:{async digest(algorithm,bytes){
      started=true;await gate.promise;return crypto.subtle.digest(algorithm,bytes);
    }}});
    if(action==='load-bytes'){
      const original=selected.arrayBuffer;
      selected.arrayBuffer=async()=>{started=true;await gate.promise;return original();};
    }
    try{
      if(action==='save'){f.run('review');task=f.run('save');}
      else {f.q('file').files=[selected];task=f.q('file').run('change');}
      task.finally(()=>{settled=true;});await until(()=>started);
      if(ending==='dispose')f.panel.dispose();else f.run(ending);
      await new Promise(resolve=>setTimeout(resolve,20));
      assert.equal(settled,true,'cancelled panel task is still waiting');
      assert.equal(f.downloads.length,0);
    }finally{gate.resolve();await task;f.panel.dispose();}
  });
}
for(const point of ['review','save-start','save-finish']) {
  test(`bundle ${point}: a source callback cannot continue after disposal`,async()=>{
    let f,calls=0,hashes=0,snapshot;
    const stopAt={'review':1,'save-start':2,'save-finish':3}[point];
    f=fixture({readRecords(){if(++calls===stopAt){
      const status=f.q('status'),details=f.q('details');f.panel.dispose();
      snapshot={status,details,text:status.textContent,detail:details.textContent};
    }return records();},subtle:{digest(...args){hashes++;return crypto.subtle.digest(...args);}}});
    const save=f.q('save');f.run('review');
    if(point!=='review')await save.run();
    assert.equal(f.downloads.length,0);
    assert.equal(snapshot.status.textContent,snapshot.text);
    assert.equal(snapshot.details.textContent,snapshot.detail);
    if(point!=='save-finish')assert.equal(hashes,0);
  });
}
test('bundle diagnostic accessors are never evaluated',()=>{
  let reads=0;const error=Object.defineProperty({},'code',{get(){reads++;return 'ALLOWANCE_SHAPE';}});
  const f=fixture({readRecords(){throw error;}});
  try{f.run('review');assert.equal(reads,0);assert.equal(f.q('save').disabled,true);}finally{f.panel.dispose();}
});
test('bundle diagnostic capture cannot write into a disposed panel',()=>{
  let f,status,before;
  const error=new Proxy({code:'ALLOWANCE_SHAPE'},{
    getOwnPropertyDescriptor(target,key){status=f.q('status');f.panel.dispose();before=status.textContent;return Reflect.getOwnPropertyDescriptor(target,key);},
    get(target,key){status=f.q('status');f.panel.dispose();before=status.textContent;return Reflect.get(target,key);}
  });
  f=fixture({readRecords(){throw error;}});f.run('review');
  assert.equal(status.textContent,before);
});
for(const receipt of ['false','resolved','rejected']) test(`bundle download ${receipt} receipt cannot report success`,async()=>{
  const f=fixture({downloadFile(){
    if(receipt==='false')return false;
    return receipt==='resolved'?Promise.resolve(true):Promise.reject(Error('synthetic refusal'));
  }});
  try{f.run('review');await f.run('save');assert.equal(f.q('save').disabled,true);
    assert.equal(f.q('status').textContent.includes('用意しました'),false);
  }finally{f.panel.dispose();}
});

test('bundle cancelled hash cannot clear the replacement save handle',async()=>{
  const old=deferred(),next=deferred();let hashes=0,first,second;
  const f=fixture({subtle:{async digest(algorithm,bytes){
    const n=++hashes;if(n===1)await old.promise;if(n===2)await next.promise;
    return crypto.subtle.digest(algorithm,bytes);
  }}});
  try{
    f.run('review');first=f.run('save');await until(()=>hashes===1);
    f.run('cancel');f.run('review');second=f.run('save');await until(()=>hashes===2);
    old.resolve();await first;await tick();
    assert.equal(f.q('panel').getAttribute('aria-busy'),'true');
    assert.equal(f.downloads.length,0);
    next.resolve();await second;
    assert.equal(f.downloads.length,1);assert.equal(f.q('panel').getAttribute('aria-busy'),'false');
  }finally{old.resolve();next.resolve();await Promise.all([first,second]);f.panel.dispose();}
});
