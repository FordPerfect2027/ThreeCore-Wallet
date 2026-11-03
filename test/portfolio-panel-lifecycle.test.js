import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPortfolioPanel } from '../examples/portfolio-panel.js';
import { Element } from './helpers/panel-dom.js';
import { snapshot, CONTRACTS, gate, tick } from './helpers/workspace-fixtures.js';
import { createTokenPlan, encodeTokenPlan } from '../src/token-plan.js';
class TestElement extends Element {
  handlers=new Map();
  addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
function fixture(options={}) {
  const card=new TestElement('article');card.dataset={agent:'DAT'};
  const calls=[];
  const panel=mountPortfolioPanel({document:{createElement:tag=>new TestElement(tag)},card,
    getContext:()=>({agent:'DAT',chainId:84532}),...options,
    read(args){calls.push(args);return options.read?options.read(args):snapshot();}});
  const q=name=>card.find('portfolio-'+name);q('tokens').value=CONTRACTS[0];
  return {panel,card,q,calls,run:name=>q(name).run(),input(value){q('tokens').value=value;return q('tokens').run('input');}};
}
const progress=()=>({stage:'block',completedTokens:0,totalTokens:1,tokenIndex:null,tokenAddress:null});
for(const stop of ['clear','invalidate','dispose']) for(const point of ['result','progress','diagnostic'])
test(`portfolio ${point}: ${stop} during capture cannot restore stale UI`,async()=>{
  let f,armed=true,status,details,before;
  function retire(){if(!armed)return;armed=false;status=f.q('status');details=f.q('details');
    if(stop==='clear')f.run('clear');else f.panel[stop]();before=status.textContent;}
  const value=new Proxy(point==='result'?snapshot():point==='progress'?progress():{code:'DISCONNECTED'},
    {getOwnPropertyDescriptor(target,key){retire();return Reflect.getOwnPropertyDescriptor(target,key);},
     get(target,key){if(point==='diagnostic')retire();return Reflect.get(target,key);}});
  f=fixture({read({onProgress}){if(point==='progress'){onProgress(value);return snapshot();}if(point==='diagnostic')throw value;return value;}});
  try{await f.run('read');assert.equal(status.textContent,before);assert.equal(details.textContent,'');}
  finally{f.panel.dispose();}
});
test('portfolio progress remains bound to requested tokens after reader mutates its input',async()=>{
  let label;
  const f=fixture({read({tokens,onProgress}){tokens.push(CONTRACTS[1]);onProgress({...progress(),totalTokens:2});label=f.q('status').textContent;return snapshot();}});
  try{await f.run('read');assert.doesNotMatch(label,/0\/2/);}finally{f.panel.dispose();}
});
test('portfolio abort callback cannot clear a newer read or its busy controls',async()=>{
  const first=gate(),second=gate();let n=0,newTask;
  const f=fixture({read({signal}){if(++n===1){signal.addEventListener('abort',()=>{f.run('clear');newTask=f.run('read');},{once:true});return first.promise;}return second.promise;}});
  try{
    const oldTask=f.run('read');f.run('clear');
    assert.equal(f.calls.length,2);assert.equal(f.q('panel').getAttribute('aria-busy'),'true');
    first.resolve(snapshot());await oldTask;assert.equal(f.q('panel').getAttribute('aria-busy'),'true');
    second.resolve(snapshot(0,'43'));await newTask;assert.match(f.q('details').textContent,/43/);
  }finally{first.resolve(snapshot());second.resolve(snapshot());await tick();f.panel.dispose();}
});
for(const outcome of ['throw','reject','then-getter'])test(`portfolio cancellation observer ${outcome} is contained`,async()=>{
  const f=fixture({onCancel(){if(outcome==='throw')throw Error('observer');if(outcome==='reject')return Promise.reject(Error('observer'));return Object.defineProperty({},'then',{get(){throw Error('observer');}});}});
  try{assert.doesNotThrow(()=>f.run('clear'));await tick();assert.equal(f.q('details').textContent,'');}
  finally{f.panel.dispose();}
});
test('portfolio retained edit handler and public invalidation cannot change removed UI',()=>{
  const f=fixture();const handler=f.q('tokens').handlers.get('input'),status=f.q('status');
  f.panel.dispose();const before=status.textContent;handler();f.panel.invalidate('late');assert.equal(status.textContent,before);
});
test('portfolio duplicate retained read callback cannot start overlapping reads',async()=>{
  const hold=gate();const f=fixture({read:()=>hold.promise});
  try{const a=f.run('read'),b=f.run('read');assert.equal(f.calls.length,1);hold.resolve(snapshot());await Promise.all([a,b]);}
  finally{hold.resolve(snapshot());f.panel.dispose();}
});
for(const stopped of [false,true])test(`portfolio token-plan application preserves its receipt only while current, stopped=${stopped}`,()=>{
  let f;f=fixture({onCancel(){if(stopped)f.panel.invalidate();}});
  try{
    const plan=name=>f.card.find('token-plan-'+name);
    plan('json').value=encodeTokenPlan(createTokenPlan({agent:'DAT',chainId:84532},CONTRACTS[1]));
    plan('preview').run();plan('apply').run();
    assert.equal(f.q('tokens').value,CONTRACTS[1]);assert.equal(f.calls.length,0);
    if(stopped)assert.doesNotMatch(plan('status').textContent,/入力欄へ反映しました/);
    else assert.match(plan('status').textContent,/残高照会はまだ行っていません/);
  }finally{f.panel.dispose();}
});
