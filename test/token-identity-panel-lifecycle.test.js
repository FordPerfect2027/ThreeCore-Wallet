import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTokenIdentityPanel } from '../examples/token-identity-panel.js';
import { Element } from './helpers/panel-dom.js';
import { observation, ACCOUNT, tick } from './helpers/identity-fixtures.js';

class TestElement extends Element {
  handlers=new Map();
  addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
const context=()=>({agent:'DAT',chainId:8453,account:ACCOUNT,tokenAddress:observation().tokenAddress});
function fixture(options={}) {
  const parent=new TestElement('div'),applied=[],downloads=[];
  const panel=mountTokenIdentityPanel({document:{createElement:tag=>new TestElement(tag)},parent,
    getContext:context,read:async()=>observation(),applyAddress:value=>{applied.push(value);},downloadFile:value=>{downloads.push(value);},...options});
  const q=name=>parent.find('identity-'+name);
  return {parent,panel,q,applied,downloads,run:name=>q(name).run()};
}
async function ready(f){f.run('inspect');const limit=Date.now()+3000;while(f.q('save').disabled){assert.ok(Date.now()<limit);await tick();}}
test('identity catalog uses captured context values without property gets',()=>{
  let gets=0;const value=new Proxy(context(),{get(target,key){if(['agent','chainId','tokenAddress'].includes(key)){gets++;throw Error('unexpected get');}return Reflect.get(target,key);}});
  const f=fixture({getContext:()=>value});try{f.run('catalog');assert.equal(gets,0);assert.equal(f.q('apply').disabled,false);}finally{f.panel.dispose();}
});
test('identity catalog context accessors are rejected without invocation',()=>{
  let gets=0;const value=context();Object.defineProperty(value,'agent',{get(){gets++;return 'DAT';}});
  const f=fixture({getContext:()=>value});try{f.run('catalog');assert.equal(gets,0);assert.equal(f.q('apply').disabled,true);}finally{f.panel.dispose();}
});
for(const ending of ['dispose','invalidate']) test(`identity catalog capture ${ending} cannot restore a preview`,()=>{
  let f,once=false,status,catalog,button,before;
  const value=new Proxy(context(),{getOwnPropertyDescriptor(target,key){if(!once){once=true;status=f.q('status');catalog=f.q('catalog-details');button=f.q('apply');f.panel[ending]();before=[status.textContent,catalog.textContent,button.disabled];}return Reflect.getOwnPropertyDescriptor(target,key);},
    get(target,key){if(key==='agent'&&!once){once=true;status=f.q('status');catalog=f.q('catalog-details');button=f.q('apply');f.panel[ending]();before=[status.textContent,catalog.textContent,button.disabled];}return Reflect.get(target,key);}});
  f=fixture({getContext:()=>value});try{f.run('catalog');assert.deepEqual([status.textContent,catalog.textContent,button.disabled],before);}finally{f.panel.dispose();}
});
for(const action of ['apply','save']) for(const receipt of ['false','resolved','rejected']) test(`identity ${action} ${receipt} handoff cannot report success`,async()=>{
  const callback=()=>receipt==='false'?false:receipt==='resolved'?Promise.resolve(true):Promise.reject(Error('synthetic rejected handoff'));
  const f=fixture(action==='apply'?{applyAddress:callback}:{downloadFile:callback});
  try{if(action==='apply')f.run('catalog');else await ready(f);await f.run(action);await tick();
    assert.equal(f.q('status').textContent.includes(action==='apply'?'公式アドレスを入力しました':'保存ファイルを用意しました'),false);
  }finally{f.panel.dispose();}
});
for(const action of ['apply','save']) for(const ending of ['dispose','invalidate']) test(`identity ${action} callback ${ending} cannot restore success`,async()=>{
  let f,status,before;const callback=()=>{status=f.q('status');f.panel[ending]();before=status.textContent;};
  f=fixture(action==='apply'?{applyAddress:callback}:{downloadFile:callback});
  try{if(action==='apply')f.run('catalog');else await ready(f);await f.run(action);assert.equal(status.textContent,before);}finally{f.panel.dispose();}
});
test('identity summary observer disposal prevents later rendering',()=>{
  let f,status,section,before;
  f=fixture({onStateChange(state){if(f&&state.phase==='reading'){status=f.q('status');section=f.q('panel');f.panel.dispose();before=[status.textContent,section.getAttribute('aria-busy')];}}});
  f.run('inspect');assert.deepEqual([status.textContent,section.getAttribute('aria-busy')],before);
});
test('identity asynchronous summary observer failure is consumed',async()=>{
  let calls=0;const f=fixture({onStateChange(){return {then(resolve,reject){calls++;reject(Error('synthetic summary failure'));}};}});
  try{await tick();assert.equal(calls,1);assert.equal(f.q('status').textContent,'未照合');}finally{f.panel.dispose();}
});
test('identity catalog diagnostic accessors are not invoked',()=>{
  let calls=0;const error=Object.defineProperty({},'code',{get(){calls++;return 'IDENTITY_INPUT';}});
  const f=fixture({getContext(){throw error;}});try{f.run('catalog');assert.equal(calls,0);}finally{f.panel.dispose();}
});
test('identity normal local address and file handoffs remain available',async()=>{
  const f=fixture();try{f.run('catalog');f.run('apply');assert.equal(f.applied.length,1);await ready(f);await f.run('save');assert.equal(f.downloads.length,1);}finally{f.panel.dispose();}
});
