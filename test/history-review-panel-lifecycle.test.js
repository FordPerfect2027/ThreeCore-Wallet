import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHistoryReview } from '../examples/history-review-panel.js';
import { Element } from './helpers/panel-dom.js';
import { archive, observation } from './helpers/history-fixtures.js';
class TestElement extends Element {
  handlers=new Map();addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(){return this.handlers.get('click')?.(new Event('click'));}
}
function fixture(options={}){
  const parent=new TestElement('div'),downloads=[];let stored=archive();
  const panel=mountHistoryReview({document:{createElement:tag=>new TestElement(tag)},parent,agent:'DAT',
    getArchive:()=>stored,getRevision:()=>1,getIncoming:()=>archive([observation('43')]),getReplace:()=>false,
    download:({prepared})=>{downloads.push(prepared);},...options});
  const q=name=>parent.find('history-review-'+name);return {panel,q,downloads,run:name=>q(name).run(),set:value=>{stored=value;}};
}
const sources={getArchive:()=>archive(),getRevision:()=>1,getIncoming:()=>archive([observation('43')]),getReplace:()=>false};
for(const [source,value]of Object.entries(sources))for(const ending of ['dispose','invalidate'])test(`history review ${source} ${ending} prevents a stale proposal`,()=>{
  let f,armed=false;f=fixture({[source](){if(armed){armed=false;f.panel[ending]();}return value();}});
  const details=f.q('details'),save=f.q('save'),status=f.q('status');let before;
  try{armed=true;before=status.textContent;f.run('impact');assert.equal(details.textContent,'');assert.equal(save.disabled,true);assert.equal(status.textContent,before);}
  finally{f.panel.dispose();}
});
for(const source of Object.keys(sources))test(`history review ${source} consumes unsupported async sources`,async()=>{
  let calls=0;const f=fixture({[source]:()=>({then(resolve,reject){calls++;reject(Error('synthetic source'));}})});
  try{f.run('impact');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,1);assert.equal(f.q('save').disabled,true);}finally{f.panel.dispose();}
});
for(const name of ['save','save-text'])for(const receipt of ['false','resolved','rejected'])test(`history review ${name} ${receipt} download receipt is refused`,async()=>{
  const f=fixture({download:()=>receipt==='false'?false:receipt==='resolved'?Promise.resolve(true):Promise.reject(Error('synthetic refusal'))});
  try{f.run('current');f.run(name);await new Promise(resolve=>setTimeout(resolve,0));assert.doesNotMatch(f.q('status').textContent,/ダウンロードを開始/);}finally{f.panel.dispose();}
});
for(const name of ['save','save-text'])for(const ending of ['dispose','invalidate'])test(`history review ${name} ${ending} cannot report late download success`,()=>{
  let f,node,before;f=fixture({download(){node=f.q('status');f.panel[ending]();before=node.textContent;}});
  try{f.run('current');f.run(name);assert.equal(node.textContent,before);}finally{f.panel.dispose();}
});
test('history review detects a changed archive during source capture',()=>{
  let f,armed=false;f=fixture({getRevision(){if(armed){armed=false;f.set(archive([observation('99')]));}return 1;}});
  try{armed=true;f.run('current');assert.equal(f.q('save').disabled,true);}finally{f.panel.dispose();}
});
test('history review keeps both ordinary accepted export formats',()=>{
  const f=fixture();try{f.run('current');f.run('save');f.run('save-text');assert.equal(f.downloads.length,2);}finally{f.panel.dispose();}
});
test('history review rechecks revision after the last import source callback',()=>{
  let revision=1,calls=0;const f=fixture({getRevision:()=>revision,getReplace(){if(++calls===2)revision++;return false;}});
  try{f.run('impact');assert.equal(f.q('save').disabled,true);assert.equal(f.q('details').textContent,'');}finally{f.panel.dispose();}
});
for(const ending of ['dispose','invalidate'])test(`history review save-time ${ending} cannot overwrite current status`,()=>{
  let f,armed=false,status,before;f=fixture({getRevision(){if(armed){armed=false;status=f.q('status');f.panel[ending]();before=status.textContent;}return 1;}});
  try{f.run('current');armed=true;f.run('save');assert.equal(f.downloads.length,0);assert.equal(status.textContent,before);}finally{f.panel.dispose();}
});
