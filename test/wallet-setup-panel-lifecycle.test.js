import test from 'node:test';
import assert from 'node:assert/strict';
import { mountWalletSetupPanel } from '../examples/wallet-setup-panel.js';
import { encodeWalletSetup } from '../src/wallet-setup.js';
import { Element } from './helpers/panel-dom.js';
import { raw, setup } from './helpers/setup-fixtures.js';

class TestElement extends Element {
  handlers=new Map();
  addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
function fixture(options={}) {
  const parent=new TestElement('div'),writes=[];let fields=raw();
  const panel=mountWalletSetupPanel({document:{createElement:tag=>new TestElement(tag)},parent,
    readFields:()=>fields,applyPlan(plan){writes.push(plan);fields=plan.entries;},download(){},...options});
  const q=name=>parent.find('wallet-setup-'+name);
  return {parent,panel,q,writes,run:name=>q(name).run()};
}
for(const action of ['refresh','export','preview']) for(const ending of ['dispose','invalidate']) test(`setup ${action}: source ${ending} wins over old view`,()=>{
  let f,armed=false,status,readiness,json,snapshot;
  f=fixture({readFields(){if(armed){armed=false;status=f.q('status');readiness=f.q('readiness');json=f.q('json');
    f.panel[ending]();snapshot=[status.textContent,readiness.textContent,json.value];}
    return raw();}});
  try{f.q('json').value=encodeWalletSetup(setup());armed=true;f.run(action);
    assert.deepEqual([status.textContent,readiness.textContent,json.value],snapshot);
  }finally{f.panel.dispose();}
});
test('setup a failed refresh cannot display successful confirmation',()=>{
  let armed=false;const f=fixture({readFields(){if(armed)throw Error('synthetic unavailable');return raw();}});
  try{armed=true;f.run('refresh');assert.equal(f.q('status').textContent.includes('設定状況を確認しました'),false);
    assert.match(f.q('readiness').textContent,/確認できません/);
  }finally{f.panel.dispose();}
});
test('setup diagnostic code accessor is not evaluated',()=>{
  let armed=false,reads=0;const error=Object.defineProperty({},'code',{get(){reads++;return 'SETUP_ADDRESS';}});
  const f=fixture({readFields(){if(armed)throw error;return raw();}});
  try{armed=true;f.run('export');assert.equal(reads,0);}finally{f.panel.dispose();}
});
for(const ending of ['dispose','invalidate']) test(`setup diagnostic ${ending} cannot be overwritten`,()=>{
  let f,armed=false,status,before,once=false;
  function stop(){if(once)return;once=true;armed=false;status=f.q('status');f.panel[ending]();before=status.textContent;}
  const error=new Proxy({code:'SETUP_ADDRESS'},{getOwnPropertyDescriptor(target,key){stop();return Reflect.getOwnPropertyDescriptor(target,key);},get(target,key){stop();return Reflect.get(target,key);}});
  f=fixture({readFields(){if(armed)throw error;return raw();}});
  try{armed=true;f.run('export');assert.equal(status.textContent,before);}finally{f.panel.dispose();}
});
for(const code of ['constructor','toString','__proto__']) test(`setup unknown ${code} diagnostic is plain text`,()=>{
  let armed=false;const f=fixture({readFields(){if(armed)throw {code};return raw();}});
  try{armed=true;f.run('export');assert.equal(typeof f.q('status').textContent,'string');assert.match(f.q('status').textContent,/適用は完了していません/);}finally{f.panel.dispose();}
});
test('setup post-apply refresh disposal cannot write a late success message',()=>{
  let f,fields=raw(),after=false,reads=0,status,readiness,before,writes=0;
  f=fixture({readFields(){if(after&&++reads===2){status=f.q('status');readiness=f.q('readiness');f.panel.dispose();before=[status.textContent,readiness.textContent];}return fields;},
    applyPlan(plan){fields=plan.entries;writes++;after=true;}});
  f.q('json').value=encodeWalletSetup(setup());f.run('preview');f.q('confirm').checked=true;f.run('apply');
  assert.equal(writes,1);assert.deepEqual([status.textContent,readiness.textContent],before);
});
test('setup normal explicit preview and apply retain verified success',()=>{
  const f=fixture();try{f.q('json').value=encodeWalletSetup(setup());f.run('preview');f.q('confirm').checked=true;f.run('apply');
    assert.equal(f.writes.length,1);assert.match(f.q('status').textContent,/設定を反映しました/);
  }finally{f.panel.dispose();}
});

test('setup invalidation from every refresh callback is bounded',()=>{
  let f,armed=false,reads=0;
  f=fixture({readFields(){if(armed&&++reads<20)f.panel.invalidate();return raw();}});
  try{armed=true;f.run('refresh');assert.equal(reads,1);assert.equal(f.writes.length,0);}
  finally{f.panel.dispose();}
});
