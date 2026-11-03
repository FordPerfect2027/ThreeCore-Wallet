import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTokenPlanPanel } from '../examples/token-plan-panel.js';
import { createTokenPlan, encodeTokenPlan } from '../src/token-plan.js';
import { Element } from './helpers/panel-dom.js';
const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),identity={agent:'DAT',chainId:84532};
const report=lines=>encodeTokenPlan(createTokenPlan(identity,lines??A));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class TestElement extends Element {
  handlers=new Map();addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
function fixture(options={}) {
  const parent=new TestElement('div'),applied=[];
  const panel=mountTokenPlanPanel({document:{createElement:tag=>new TestElement(tag)},parent,
    getContext:()=>identity,readLines:()=>A,applyLines:lines=>{applied.push(lines);},...options});
  const q=name=>parent.find('token-plan-'+name);
  return {panel,q,applied,run:name=>q(name).run(),review(){q('json').value=report();q('preview').run();}};
}
for(const action of ['save','preview','apply'])for(const stop of ['clear','invalidate','dispose'])
test(`token plan ${action}: context callback ${stop} retires the operation`,()=>{
  let f,armed=false,status,json,expected;
  f=fixture({getContext(){if(armed){armed=false;status=f.q('status');json=f.q('json');if(stop==='clear')f.run('clear');else f.panel[stop]();expected=status.textContent;}return identity;}});
  try{f.review();armed=true;f.run(action);assert.equal(status.textContent,expected);assert.equal(json.value,'');assert.equal(f.applied.length,0);}
  finally{f.panel.dispose();}
});
for(const action of ['preview','apply'])test(`token plan ${action}: silent input changes during context capture require another preview`,()=>{
  let f,armed=false;f=fixture({getContext(){if(armed){armed=false;f.q('json').value=report(B);}return identity;}});
  try{f.review();armed=true;f.run(action);assert.equal(f.q('apply').disabled,true);assert.equal(f.applied.length,0);assert.match(f.q('status').textContent,/もう一度/);}
  finally{f.panel.dispose();}
});
for(const source of ['getContext','readLines'])test(`token plan export consumes asynchronous ${source} failure`,async()=>{
  const f=fixture({[source]:()=>Promise.reject(Error('unavailable source'))});
  try{f.run('save');await tick();assert.equal(f.q('json').value,'');assert.doesNotMatch(f.q('status').textContent,/JSONにしました/);}
  finally{f.panel.dispose();}
});
test('token plan export rechecks context after reading its source list',()=>{
  let context={...identity};const f=fixture({getContext:()=>context,readLines(){context={agent:'EMA',chainId:84532};return A;}});
  try{f.run('save');assert.equal(f.q('json').value,'');assert.doesNotMatch(f.q('status').textContent,/JSONにしました/);}
  finally{f.panel.dispose();}
});
for(const receipt of ['false','reject','resolve','unreadable'])test(`token plan apply ${receipt} receipt cannot claim confirmation`,async()=>{
  const f=fixture({applyLines(){if(receipt==='false')return false;if(receipt==='reject')return Promise.reject(Error('late'));
    if(receipt==='resolve')return Promise.resolve(true);return Object.defineProperty({},'then',{get(){throw Error('then');}});}});
  try{f.review();f.run('apply');await tick();assert.doesNotMatch(f.q('status').textContent,/入力欄へ反映しました/);assert.equal(f.q('apply').disabled,true);}
  finally{f.panel.dispose();}
});
for(const fails of [false,true])test(`token plan apply completion cannot revive removed UI, failure=${fails}`,()=>{
  let f,status,before;f=fixture({applyLines(){status=f.q('status');f.panel.dispose();before=status.textContent;if(fails)throw Error('late');}});
  f.review();f.run('apply');assert.equal(status.textContent,before);
});
test('token plan diagnostic accessor is not executed',()=>{
  let reads=0;const error=Object.defineProperty({},'code',{get(){reads++;return 'INVALID_PLAN';}});
  const f=fixture({readLines(){throw error;}});try{f.run('save');assert.equal(reads,0);}finally{f.panel.dispose();}
});
test('token plan retained clear and input handlers cannot update removed UI',()=>{
  const f=fixture();const clear=f.q('clear').handlers.get('click'),input=f.q('json').handlers.get('input'),status=f.q('status');
  f.panel.dispose();const before=status.textContent;clear();input();assert.equal(status.textContent,before);
});
