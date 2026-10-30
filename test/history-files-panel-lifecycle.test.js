import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHistoryFiles } from '../examples/history-files.js';
import { createPortfolioHistory } from '../src/portfolio-history.js';
import { Element } from './helpers/panel-dom.js';
import { observation, archive, file, bytes } from './helpers/history-fixtures.js';
class TestElement extends Element {
  handlers=new Map();addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
function fixture(options={}){
  const parent=new TestElement('div'),history=createPortfolioHistory(),downloads=[],imports=[];history.add(observation());
  const panel=mountHistoryFiles({document:{createElement:tag=>new TestElement(tag)},parent,agent:'DAT',
    getArchive:()=>history.exportText(),getRevision:()=>history.state().revision,onImportText:text=>{imports.push(text);},
    readBytes:async()=>bytes(),download:value=>{downloads.push(value.prepared);},...options});
  const q=name=>parent.find('history-'+name);return {parent,panel,q,history,downloads,imports,run:name=>q(name).run(),
    load(){q('file-input').files=[file()];return q('file-input').run('change');}};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
for(const name of ['file-save','file-save-subset'])for(const receipt of ['false','resolved','rejected'])test(`history files ${name} ${receipt} does not claim a download`,async()=>{
  const f=fixture({download:()=>receipt==='false'?false:receipt==='resolved'?Promise.resolve(true):Promise.reject(Error('synthetic download'))});
  try{if(name.endsWith('subset'))f.run('filter-run');f.run(name);await tick();assert.doesNotMatch(f.q('file-status').textContent,/ダウンロードを開始|ダウンロード開始/);
    assert.doesNotMatch(f.q('backup-state').textContent,/開始済み/);}finally{f.panel.dispose();}
});
for(const source of ['getArchive','getRevision'])for(const ending of ['invalidate','dispose'])test(`history files ${source} ${ending} does not admit stale source data`,()=>{
  let f,armed=false,node,before;f=fixture({[source](){if(armed){armed=false;node=f.q('file-status');f.panel[ending]();before=node.textContent;}return source==='getArchive'?archive():1;}});
  try{armed=true;f.run('file-save');assert.equal(f.downloads.length,0);assert.equal(node.textContent,before);}finally{f.panel.dispose();}
});
for(const callback of ['onReadStart','onImportText'])for(const ending of ['invalidate','dispose'])test(`history file ${callback} ${ending} leaves current status intact`,async()=>{
  let f,node,before;f=fixture({[callback](){node=f.q('file-status');f.panel[ending]();before=node.textContent;}});
  try{await f.load();await tick();assert.equal(node.textContent,before);}finally{f.panel.dispose();}
});
test('history read-start observer rejection is consumed',async()=>{
  let calls=0;const f=fixture({onReadStart:()=>({then(resolve,reject){calls++;reject(Error('synthetic observer'));}})});
  try{await f.load();await tick();assert.equal(calls,1);assert.equal(f.imports.length,1);}finally{f.panel.dispose();}
});
for(const receipt of ['false','resolved','rejected'])test(`history file ${receipt} import receipt cannot claim input success`,async()=>{
  const f=fixture({onImportText:()=>receipt==='false'?false:receipt==='resolved'?Promise.resolve(true):Promise.reject(Error('synthetic import'))});
  try{await f.load();await tick();assert.doesNotMatch(f.q('file-status').textContent,/入力欄へ読み込みました/);assert.equal(f.history.state().size,1);}finally{f.panel.dispose();}
});
for(const name of ['file-save','file-save-subset'])for(const ending of ['invalidate','dispose'])test(`history ${name} ${ending} download callback cannot write late success`,()=>{
  let f,node,before;f=fixture({download(){node=f.q('file-status');f.panel[ending]();before=node.textContent;}});
  try{if(name.endsWith('subset'))f.run('filter-run');f.run(name);assert.equal(node.textContent,before);}finally{f.panel.dispose();}
});
test('history filtered export rechecks the archive even if the source revision is unchanged',()=>{
  let text=archive();const f=fixture({getArchive:()=>text,getRevision:()=>1});
  try{f.run('filter-run');text=archive([observation('99')]);f.run('file-save-subset');assert.equal(f.downloads.length,0);}finally{f.panel.dispose();}
});
test('history backup refresh bounds source reentrancy',()=>{
  let f,armed=false,calls=0;f=fixture({getRevision(){if(armed){calls++;if(calls>20)throw Error('unbounded backup refresh');f.panel.invalidate();}return 1;}});
  try{armed=true;assert.doesNotThrow(()=>f.panel.invalidate());assert.equal(calls,1);}finally{armed=false;f.panel.dispose();}
});
test('history ordinary whole and filtered saves preserve separate backup meanings',()=>{
  const f=fixture();try{f.run('filter-run');f.run('file-save-subset');assert.doesNotMatch(f.q('backup-state').textContent,/開始済み/);
    f.run('file-save');assert.match(f.q('backup-state').textContent,/開始済み/);assert.equal(f.downloads.length,2);}finally{f.panel.dispose();}
});
for(const source of ['getArchive','getRevision'])test(`history files ${source} consumes unsupported asynchronous source failures`,async()=>{
  let armed=false,calls=0;const f=fixture({[source](){return armed?{then(resolve,reject){calls++;reject(Error('synthetic source'));}}:source==='getArchive'?archive():1;}});
  try{armed=true;f.run('file-save');await tick();assert.equal(calls,1);assert.equal(f.downloads.length,0);}finally{f.panel.dispose();}
});
test('history whole export rejects a revision change during archive capture',()=>{
  let f,armed=false;f=fixture({getArchive(){if(armed){armed=false;f.history.add(observation('99'));}return archive();}});
  try{armed=true;f.run('file-save');assert.equal(f.downloads.length,0);}finally{f.panel.dispose();}
});
test('history subset checks the visible criteria immediately before export',()=>{
  const f=fixture();try{f.run('filter-run');f.q('filter-minimum').value='99';f.run('file-save-subset');assert.equal(f.downloads.length,0);}finally{f.panel.dispose();}
});
test('history retained filter handlers do not update a removed panel',()=>{
  const f=fixture();f.run('filter-run');const input=f.q('filter-account'),handler=input.handlers.get('input'),results=f.q('filter-results');
  f.panel.dispose();const before=results.textContent;handler();assert.equal(results.textContent,before);
});
