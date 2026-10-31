import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {Element} from './helpers/panel-dom.js';import {mountSavedFileBatchPanel} from '../examples/file-read-panel.js';import {encodeWalletSavedTextBatch} from '../src/file-read-status.js';
const text=readFileSync(new URL('../docs/evidence/2026-11-01-wallet-file-batch/first.json',import.meta.url),'utf8');
const wait=async predicate=>{const end=Date.now()+5000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));assert(predicate());};
function setup(options={}){const parent=new Element('div'),document={createElement:tag=>new Element(tag)},downloads=[],panel=mountSavedFileBatchPanel({parent,document,download:value=>downloads.push(value),...options}),q=name=>parent.find('saved-file-batch-'+name);return{panel,q,downloads,choose(){q('file').files=['first.json','second.json','third.json'].map(name=>new File([text],name));q('file').dispatchEvent(new Event('change'));},done:()=>wait(()=>!panel.getState().busy),save(name){q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q(name).click();}};}
test('Stop then Continue keeps the first source and saves linked receipts without reading it again',async()=>{
 let release;const reads=[],f=setup({readText(file){reads.push(file.name);return reads.length===2?new Promise(resolve=>{release=resolve;}):Promise.resolve(text);}});
 try{f.choose();f.q('start').click();await wait(()=>Boolean(release));f.q('stop').click();await f.done();const previous=f.panel.getState().result;f.save('save');assert(!f.q('resume').disabled);f.q('resume').click();assert(f.q('resume').disabled);await f.done();const result=f.panel.getState().result;assert.deepEqual(reads,['first.json','second.json','second.json','third.json']);assert.equal(result.files[0],previous.files[0]);assert.equal(result.complete,true);assert.match(f.q('summary').textContent,/前回の結果を保持 1件/);assert(f.q('resume').disabled);f.save('save');f.save('csv');assert.equal(JSON.parse(f.downloads[1].text).continuation.previousBatchSha256,createHash('sha256').update(f.downloads[0].text).digest('hex'));assert.match(f.downloads[2].text,/retainedChecks/);release(text);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.panel.getState().result,result);assert.equal(encodeWalletSavedTextBatch(previous),f.downloads[0].text);}
 finally{release?.(text);f.panel.dispose();}
});
test('failed continuation preparation preserves the earlier receipt and leaves continuation available',async()=>{
 let release;let reads=0;const f=setup({readText(){return ++reads===2?new Promise(resolve=>{release=resolve;}):Promise.resolve(text);},resumeFiles:async()=>{throw Error('synthetic');}});
 try{f.choose();f.q('start').click();await wait(()=>Boolean(release));f.q('stop').click();await f.done();const previous=f.panel.getState().result;f.q('resume').click();await f.done();assert.equal(f.panel.getState().result,previous);assert.match(f.q('status').textContent,/前回の結果は保持/);assert(!f.q('resume').disabled);assert.equal(reads,2);}
 finally{release?.(text);f.panel.dispose();}
});
test('changing selection or clearing during continuation invalidates old work without restoring it later',async()=>{
 const gates=[];let reads=0;const f=setup({readText(){if(++reads===1)return Promise.resolve(text);return new Promise(resolve=>gates.push(resolve));}});
 try{f.choose();f.q('start').click();await wait(()=>gates.length===1);f.q('stop').click();await f.done();f.q('resume').click();await wait(()=>gates.length===2);f.q('clear').click();assert.equal(f.panel.getState().busy,false);assert.equal(f.panel.getState().result,null);assert(f.q('resume').disabled);for(const release of gates)release(text);await new Promise(resolve=>setTimeout(resolve,20));assert.equal(f.panel.getState().result,null);f.choose();assert(f.q('resume').disabled);}
 finally{for(const release of gates)release(text);f.panel.dispose();}
});
