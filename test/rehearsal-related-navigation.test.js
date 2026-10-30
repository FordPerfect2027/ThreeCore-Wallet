import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountRehearsalRecordsPanel } from "../examples/operation-rehearsal-records-panel.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
import { encodeRehearsalRecordReport } from "../src/operation-rehearsal-records.js";
const workspace=(...ledgers)=>({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers});
class Node extends Element{set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}}
const rendered=n=>[n.textContent,...n.children.map(rendered)].join(" ");
function setup(){const elements=new Map(),downloads=[];let throwDownload=false;
  const document={getElementById(id){if(!elements.has(id))elements.set(id,new Node("div"));return elements.get(id);},createElement:tag=>new Node(tag)};
  const field=id=>document.getElementById("record-browser-"+id);
  const panel=mountRehearsalRecordsPanel(document,{reasons:{WRONG_AGENT:"対象トークンが異なる"},kinds:{open:"投入",settle:"決済",deposit:"追加資金"},download:({prepared})=>{if(throwDownload)throw Error("Download");downloads.push(prepared);}});
  const change=(id,value,event=id==="search"?"input":"change")=>{field(id).value=value;field(id).dispatchEvent(new Event(event));};
  return{field,panel,change,downloads,failDownload:()=>{throwDownload=true;}};
}
const many=()=>{const source=rehearsalExampleV2();return workspace({...source,events:Array.from({length:27},(_,i)=>({id:"deposit-"+i,kind:"deposit",agent:source.agent,chainId:source.chainId,account:source.account,amount:"1"}))});};
const relatedInput=()=>{
 const source=rehearsalExampleV2();
 const middle=Array.from({length:25},(_,i)=>({id:'deposit-'+i,kind:'deposit',agent:source.agent,chainId:source.chainId,account:source.account,amount:'1'}));
 return workspace({...source,events:[source.events[0],...middle,source.events[1]]},rehearsalExampleV2('EMA'));
};
const relatedButton=f=>f.field('related').children[0]?.children[3]?.children[0];
const state=f=>JSON.stringify(['agent','kind','decision','search','size','select','status','detail','back'].map(id=>{const n=f.field(id);return[id,n.value,n.textContent,n.disabled];}));
test('related record jump crosses pages within its saved agent and can restore the original query',()=>{
 const f=setup(),input=relatedInput(),before=JSON.stringify(input);
 try{
  f.panel.refresh(input);f.change('size','25');f.change('kind','open');f.change('decision','accepted');f.change('search',' OPEN-one ');
  const original=state(f),button=relatedButton(f);assert.ok(button);assert.equal(button.type,'button');assert.match(button.getAttribute('aria-label'),/DAT.*27番目.*settle-one/);
  button.click();assert.equal(f.field('select').value,'DAT:settle-one');assert.equal(f.field('agent').value,'DAT');assert.equal(f.field('search').value,'');
  assert.equal(f.field('kind').value,'all');assert.equal(f.field('decision').value,'all');assert.match(f.field('status').textContent,/26～27/);
  assert.match(f.field('detail').textContent,/27番目/);assert.equal(f.field('back').disabled,false);
  f.field('save').click();const report=JSON.parse(f.downloads.at(-1).text);assert.equal(report.query.agent,'DAT');assert.equal(report.totalRecords,29);assert.equal(report.matchedRecords,27);
  f.field('back').click();assert.equal(state(f),original);assert.equal(JSON.stringify(input),before);
 }finally{f.panel.dispose();}
});
for(const action of ['filter','refresh','clear','dispose','selection'])test('retired related-row button cannot change view after '+action,()=>{
 const f=setup();try{
  f.panel.refresh(relatedInput());const button=relatedButton(f);assert.ok(button);
  if(action==='filter')f.change('search','deposit');
  if(action==='refresh')f.panel.refresh(relatedInput());
  if(action==='clear')f.panel.refresh(null);
  if(action==='dispose')f.panel.dispose();
  if(action==='selection'){f.change('select','DAT:deposit-0');f.change('select','DAT:open-one');}
  const before=state(f);button.click();assert.equal(state(f),before);
 }finally{f.panel.dispose();}
});
for(const action of ['filter','refresh','clear'])test('return-to-search is revoked after '+action,()=>{
 const f=setup();try{
  f.panel.refresh(relatedInput());relatedButton(f).click();assert.equal(f.field('back').disabled,false);
  if(action==='filter')f.change('kind','deposit');if(action==='refresh')f.panel.refresh(relatedInput());if(action==='clear')f.panel.refresh(null);
  assert.equal(f.field('back').disabled,true);const before=state(f);f.field('back').click();assert.equal(state(f),before);
 }finally{f.panel.dispose();}
});
test('record without a cross-reference exposes no misleading related-navigation action',()=>{
 const f=setup();try{f.panel.refresh(relatedInput());f.change('select','DAT:deposit-0');assert.equal(f.field('related').children.length,0);assert.match(f.field('related-status').textContent,/ありません/);}finally{f.panel.dispose();}
});
