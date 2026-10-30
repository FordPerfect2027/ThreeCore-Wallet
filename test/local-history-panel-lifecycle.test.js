import test from 'node:test';
import assert from 'node:assert/strict';
import { mountComparisonPanel } from '../examples/comparison-panel.js';
import { mountHistoryPanel } from '../examples/history-panel.js';
import { encodePortfolioReport } from '../src/portfolio-report.js';
import { Element } from './helpers/panel-dom.js';
import { observation } from './helpers/history-fixtures.js';

class TestElement extends Element {
  handlers=new Map();
  addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
const document={createElement:tag=>new TestElement(tag)};
function comparison(){const parent=new TestElement('div');return {parent,panel:mountComparisonPanel({document,parent}),q:name=>parent.find('comparison-'+name)};}
function history(options={}){const parent=new TestElement('div');return {parent,panel:mountHistoryPanel({document,parent,agent:'DAT',getSnapshot:observation,getReport:()=>encodePortfolioReport(observation()),...options}),q:name=>parent.find('history-'+name)};}

for(const ending of ['dispose','clear','replace']) test(`comparison capture cannot override ${ending}`,()=>{
  const f=comparison(),button=f.q('run'),status=f.q('status');let snapshot,once=false;
  const value=new Proxy(observation('43'),{getOwnPropertyDescriptor(target,key){
    if(!once){once=true;if(ending==='dispose')f.panel.dispose();else if(ending==='clear')f.panel.clearTarget();else f.panel.setTarget(observation('44'));
      snapshot=status.textContent;}
    return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  try{
    f.panel.setTarget(value);assert.equal(status.textContent,snapshot);
    if(ending!=='replace')assert.equal(button.disabled,true);
    else{f.q('baseline').value=encodePortfolioReport(observation('43'));f.q('run').run();assert.match(f.q('status').textContent,/比較が完了/);assert.match(f.q('details').textContent,/44/);}
  }finally{f.panel.dispose();}
});
for(const name of ['baseline','clear']) test(`comparison retained ${name} callback cannot change closed controls`,()=>{
  const f=comparison(),input=f.q('baseline'),status=f.q('status');
  const listener=f.q(name).handlers.get(name==='baseline'?'input':'click');f.panel.dispose();
  input.value='retained';const before=status.textContent;listener();assert.equal(input.value,'retained');assert.equal(status.textContent,before);
});
for(const action of ['add-current','add-report']) for(const ending of ['dispose','invalidate']) test(`history ${action}: source ${ending} prevents admission`,()=>{
  let f,once=false,status,list,before,count;
  function source(){if(!once){once=true;status=f.q('status');list=f.q('list');f.panel[ending]();before=status.textContent;count=list.children.length;}
    return action==='add-current'?observation():encodePortfolioReport(observation());}
  f=history(action==='add-current'?{getSnapshot:source}:{getReport:source});
  try{f.q(action).run();assert.equal(status.textContent,before);assert.equal(list.children.length,count);
    if(ending!=='dispose')assert.equal(JSON.parse(f.panel.exportArchive()).reports.length,0);
  }finally{f.panel.dispose();}
});
for(const ending of ['dispose','invalidate']) test(`history validation ${ending} prevents admission`,()=>{
  let f,once=false,status,before;
  const value=new Proxy(observation(),{getOwnPropertyDescriptor(target,key){if(!once){once=true;status=f.q('status');f.panel[ending]();before=status.textContent;}return Reflect.getOwnPropertyDescriptor(target,key);}});
  f=history({getSnapshot:()=>value});
  try{f.q('add-current').run();assert.equal(status.textContent,before);
    if(ending!=='dispose')assert.equal(JSON.parse(f.panel.exportArchive()).reports.length,0);
  }finally{f.panel.dispose();}
});
for(const action of ['add-current','add-report']) test(`history ${action} consumes asynchronous adapter failure`,async()=>{
  let observed=0;
  const result={then(resolve,reject){observed++;reject(Error('synthetic adapter failure'));}};
  const f=history(action==='add-current'?{getSnapshot:()=>result}:{getReport:()=>result});
  try{f.q(action).run();await new Promise(resolve=>setImmediate(resolve));assert.equal(observed,1);
    assert.equal(JSON.parse(f.panel.exportArchive()).reports.length,0);
  }finally{f.panel.dispose();}
});
test('history diagnostic getters are not evaluated',()=>{
  let reads=0;const error=Object.defineProperty({},'code',{get(){reads++;return 'OBSERVATION_CONFLICT';}});
  const f=history({getSnapshot(){throw error;}});
  try{f.q('add-current').run();assert.equal(reads,0);assert.equal(JSON.parse(f.panel.exportArchive()).reports.length,0);}finally{f.panel.dispose();}
});
test('history diagnostic reflection cannot rewrite disposed status',()=>{
  let f,status,before;
  function stop(){status=f.q('status');f.panel.dispose();before=status.textContent;}
  const error=new Proxy({code:'OBSERVATION_CONFLICT'},{getOwnPropertyDescriptor(target,key){stop();return Reflect.getOwnPropertyDescriptor(target,key);},get(target,key){stop();return Reflect.get(target,key);}});
  f=history({getSnapshot(){throw error;}});f.q('add-current').run();assert.equal(status.textContent,before);
});
test('history valid source admission and exported bytes still work',()=>{
  const f=history();try{f.q('add-current').run();assert.equal(JSON.parse(f.panel.exportArchive()).reports.length,1);f.q('export').run();assert.match(f.q('json').value,/threecore/);}finally{f.panel.dispose();}
});
