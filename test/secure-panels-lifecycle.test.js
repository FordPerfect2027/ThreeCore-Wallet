import test from 'node:test';
import assert from 'node:assert/strict';
import { mountSecureOperationPanel } from '../examples/secure-operation-panel.js';
import { mountEncryptedLibraryPanel } from '../examples/encrypted-library-panel.js';
import { createSecureBackupRunner } from '../src/secure-backup-runner.js';
import { envelope, memoryStorage, gate, tick } from './helpers/encrypted-library-fixtures.js';
import { until } from './helpers/workspace-fixtures.js';
import { Element } from './helpers/panel-dom.js';
class TestElement extends Element {
  handlers=new Map();addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
const fresh=()=>createSecureBackupRunner().state();
function operationFixture(options={}){
  const parent=new TestElement('main');let observer;
  const runner={state:fresh,subscribe(fn){observer=fn;return()=>{};},...options};
  const panel=mountSecureOperationPanel({document:{createElement:tag=>new TestElement(tag)},parent,runner});
  const q=name=>parent.find('secure-operation-'+name);return {panel,q,emit:value=>observer(value)};
}
for(const stop of ['dispose','nested'])test(`secure operation: ${stop} retires a captured status`,()=>{
  const f=operationFixture(),status=f.q('status');let armed=true,before;
  try{f.emit(new Proxy({...fresh(),phase:'disposed',disposed:true},{getOwnPropertyDescriptor(target,key){if(armed){armed=false;if(stop==='dispose')f.panel.dispose();else f.emit(null);before=status.textContent;}return Reflect.getOwnPropertyDescriptor(target,key);}}));assert.equal(status.textContent,before);}
  finally{f.panel.dispose();}
});
test('secure operation labels and counts use one captured source',()=>{
  const f=operationFixture(),seen=new Map();try{f.emit(new Proxy(fresh(),{getOwnPropertyDescriptor(target,key){seen.set(key,(seen.get(key)??0)+1);return Reflect.getOwnPropertyDescriptor(target,key);}}));assert.ok([...seen.values()].every(n=>n===1));}finally{f.panel.dispose();}
});
test('secure operation async state failure is consumed',async()=>{
  const f=operationFixture({state:()=>Promise.reject(Error('state'))});try{await tick();assert.match(f.q('status').textContent,/確認できません/);}finally{f.panel.dispose();}
});
test('secure operation async subscription is retired and late cleanup runs',async()=>{
  let observer,cleaned=0;const f=operationFixture({subscribe(fn){observer=fn;fn(fresh());return Promise.resolve(()=>{cleaned++;});}});
  try{await tick();const before=f.q('status').textContent;observer(fresh());assert.equal(cleaned,1);assert.equal(f.q('status').textContent,before);assert.match(before,/確認できません/);}finally{f.panel.dispose();}
});
test('secure operation async unsubscribe rejection is consumed',async()=>{
  const f=operationFixture({subscribe:()=>()=>Promise.reject(Error('cleanup'))});f.panel.dispose();await tick();
});
function libraryFixture(options={}){
  const parent=new TestElement('main'),storage=memoryStorage();
  const panel=mountEncryptedLibraryPanel({document:{createElement:tag=>new TestElement(tag)},parent,readEncrypted:envelope,onOpen:()=>true,...options,controllerOptions:{storage,...options.controllerOptions}});
  const q=name=>parent.find('encrypted-library-'+name);return {panel,q,storage};
}
for(const stop of ['protect','cancel','unready','dispose'])test(`encrypted library: ${stop} during source read cannot start a new review`,async()=>{
  let f;f=libraryFixture({readEncrypted(){if(stop==='cancel')f.q('cancel').run();else if(stop==='unready')f.panel.setReady(false);else f.panel[stop]();return envelope();}});
  try{f.panel.setReady(true);await f.q('save').run();await until(()=>!f.panel.state().busy);assert.equal(f.storage.calls.reads,0);assert.equal(f.storage.calls.writes,0);assert.equal(f.panel.state().review,null);}
  finally{f.panel.dispose();}
});
test('encrypted library: asynchronous rejected source is consumed without preparing storage',async()=>{
  const f=libraryFixture({readEncrypted:()=>Promise.reject(Error('source'))});
  try{f.panel.setReady(true);await f.q('save').run();await tick();await until(()=>!f.panel.state().busy);assert.equal(f.storage.calls.reads,0);assert.equal(f.panel.state().review,null);}
  finally{f.panel.dispose();}
});
test('encrypted library: late source failure cannot overwrite disposed status',()=>{
  let f,status,before;f=libraryFixture({readEncrypted(){status=f.q('status');f.panel.dispose();before=status.textContent;throw Error('late');}});
  f.panel.setReady(true);f.q('save').run();assert.equal(status.textContent,before);
});
test('encrypted library: replacement file value survives an import callback',async()=>{
  const hold=gate();let f;f=libraryFixture({controllerOptions:{readText(){f.q('file').value='new-selection';return hold.promise;}}});
  try{const file=f.q('file');file.files=[{name:'synthetic.json',size:2}];file.value='old-selection';file.run('change');assert.equal(file.value,'new-selection');}
  finally{f.panel.protect();hold.resolve('{}');await tick();f.panel.dispose();}
});
test('encrypted library: accepted current ciphertext reaches review without writing',async()=>{
  const f=libraryFixture();try{f.panel.setReady(true);await f.q('save').run();await until(()=>!f.panel.state().busy);assert.equal(f.panel.state().phase,'review');assert.equal(f.storage.calls.writes,0);}finally{f.panel.dispose();}
});
