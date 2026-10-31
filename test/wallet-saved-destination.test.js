import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {Element} from './helpers/panel-dom.js';import {mountSavedFileInspectionPanel} from '../examples/file-read-panel.js';
const text=readFileSync(new URL('../docs/evidence/2026-11-01-wallet-file-batch/first.json',import.meta.url),'utf8'),file=()=>new File([text],'period.json');
function setup(destinations){const parent=new Element('div'),document={createElement:tag=>new Element(tag)},panel=mountSavedFileInspectionPanel({parent,document,destinations}),q=name=>parent.find('saved-file-guide-'+name);return{panel,q};}
test('destination navigation is explicit and keeps the inspected file without importing it',async()=>{
 let calls=0;const f=setup({period(){calls++;return true;}});
 try{assert(f.q('destination').disabled);await f.panel.inspectFile(file());const result=f.panel.getState().result;assert.equal(calls,0);assert(!f.q('destination').disabled);f.q('destination').click();assert.equal(calls,1);assert.equal(f.panel.getState().result,result);assert.match(f.q('destination-status').textContent,/まだ読み込んでいません/);const button=f.q('destination');f.panel.dispose();button.click();assert.equal(calls,1);}finally{f.panel.dispose();}
});
test('auxiliary claims and missing routes cannot trigger a destination callback',async()=>{
 let calls=0;const f=setup({period(){calls++;return true;}});
 try{await f.panel.inspectFile(new File(['{"schema":"threecore.saved-file-inspection.v3","target":"period","validation":"validated-original"}'],'claim.json'));assert(f.q('destination').disabled);f.q('destination').click();assert.equal(calls,0);}finally{f.panel.dispose();}
 const absent=setup({});try{await absent.panel.inspectFile(file());assert(absent.q('destination').disabled);}finally{absent.panel.dispose();}
});
test('callback descriptors are captured without invoking getters or following later replacement',async()=>{
 let getters=0,calls=0;const map={};Object.defineProperty(map,'period',{get(){getters++;return()=>true;}});const f=setup(map);
 try{await f.panel.inspectFile(file());assert.equal(getters,0);assert(f.q('destination').disabled);}finally{f.panel.dispose();}
 const owned={period(){calls++;return true;}},g=setup(owned);owned.period=()=>{throw Error('replaced');};try{await g.panel.inspectFile(file());g.q('destination').click();assert.equal(calls,1);}finally{g.panel.dispose();}
});
for(const kind of ['false','throw','async'])test('failed destination callbacks stay bounded and do not leak private error text: '+kind,async()=>{
 const f=setup({period(){if(kind==='throw')throw Error('PRIVATE');if(kind==='async')return Promise.reject(Error('PRIVATE'));return false;}});
 try{await f.panel.inspectFile(file());const result=f.panel.getState().result;f.q('destination').click();await new Promise(resolve=>setTimeout(resolve,0));assert.match(f.q('destination-status').textContent,/移動できません/);assert.doesNotMatch(f.q('destination-status').textContent,/PRIVATE/);assert.equal(f.panel.getState().result,result);}finally{f.panel.dispose();}
});
test('a destination callback replacing the selected source cannot publish stale navigation success',async()=>{
 let next;const f=setup({period(){next=f.panel.inspectFile(file());return true;}});
 try{await f.panel.inspectFile(file());f.q('destination').click();await next;assert.equal(f.q('destination-status').textContent,'');assert(f.panel.getState().result);}finally{f.panel.dispose();}
});
