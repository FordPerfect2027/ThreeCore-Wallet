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
test("empty source and missing agents are explicit, not assumed zero balances",()=>{
  const f=setup();assert.equal(f.field("save").disabled,true);f.panel.refresh(workspace({...rehearsalExampleV2(),events:[]}));assert.match(f.field("scope").textContent,/DAT: 0件 \/ EMA: 未作成/);assert.equal(f.field("select").disabled,true);
});
test("paging shows bounded rows and exports every match, not only the current page",()=>{
  const f=setup(),input=many();f.panel.refresh(input);assert.equal(f.field("rows").children.length,10);assert.equal(f.field("prev").disabled,true);
  f.field("next").click();assert.match(f.field("status").textContent,/11～20/);assert.match(f.field("detail").textContent,/11番目/);
  f.field("save").click();assert.equal(f.downloads[0].text,encodeRehearsalRecordReport(input));
  f.field("next").click();assert.equal(f.field("rows").children.length,7);assert.equal(f.field("next").disabled,true);
  f.change("size","25");assert.equal(f.field("rows").children.length,25);assert.match(f.field("status").textContent,/1～25/);
});
test("filter changes reset page; no matches clear old detail and related records",()=>{
  const f=setup();f.panel.refresh(many());f.field("next").click();f.change("search","deposit-26");assert.equal(f.field("rows").children.length,1);assert.match(f.field("status").textContent,/1～1/);
  f.change("search","absent");assert.equal(f.field("event").children.length,0);assert.equal(f.field("related-status").textContent,"");assert.equal(f.field("select").disabled,true);
  f.field("clear").click();assert.equal(f.field("rows").children.length,10);
});
test("detail shows recorded event context, six before/after amounts and related record IDs",()=>{
  const f=setup();f.panel.refresh(workspace(rehearsalExampleV2()));assert.equal(f.field("balances").children.length,6);assert.match(rendered(f.field("related")),/settle-one/);
  f.change("select","DAT:settle-one");assert.match(f.field("detail").textContent,/2番目/);assert.match(rendered(f.field("balances")),/-1 SIM 28 SIM \+29 SIM/);
});
test("a source replacement refreshes amounts and removes a vanished selection",()=>{
  const f=setup();f.panel.refresh(workspace(rehearsalExampleV2()));f.change("select","DAT:settle-one");f.panel.refresh(workspace(rehearsalExampleV2("DAT","pending")));
  assert.equal(f.field("select").value,"DAT:open-one");assert.equal(f.field("rows").children.length,1);assert.equal(f.field("related").children.length,0);
});
test("foreign event identity is shown distinctly from stored identity",()=>{
  const f=setup(),source=rehearsalExampleV2();f.panel.refresh(workspace({...source,events:[{...source.events[0],agent:"EMA"}]}));
  assert.match(f.field("detail").textContent,/保存元 DAT/);assert.match(rendered(f.field("event")),/記録上の対象 EMA/);assert.match(f.field("detail").textContent,/対象トークンが異なる/);
});
test("invalid query disables export until fixed and download failure preserves rows",()=>{
  const f=setup();f.panel.refresh(workspace(rehearsalExampleV2()));f.change("search","x".repeat(81));assert.equal(f.field("save").disabled,true);
  f.change("search","");f.failDownload();f.field("save").click();assert.match(f.field("export-status").textContent,/保存できません/);assert.equal(f.field("rows").children.length,2);
});
test("dispose removes records and prevents later refresh or retained listeners from exposing them",()=>{
  const f=setup();f.panel.refresh(workspace(rehearsalExampleV2()));f.panel.dispose();f.panel.refresh(many());f.field("next").click();assert.equal(f.field("rows").children.length,0);assert.equal(f.field("save").disabled,true);
});

const rowButton=(f,index)=>f.field('rows').children[index].children[5].children[0];
test('a record row opens its exact detail and moves focus without changing the query export',()=>{
  const f=setup(),input=many();let focus=0;f.field('select').focus=()=>{focus++;};
  try{f.panel.refresh(input);f.field('next').click();f.field('save').click();const before=f.downloads.pop().text;
    const pick=rowButton(f,7);assert.match(pick.getAttribute('aria-label'),/DAT.*18番目.*deposit-17/);pick.click();
    assert.equal(f.field('select').value,'DAT:deposit-17');assert.match(f.field('detail').textContent,/18番目.*deposit-17/);assert.equal(focus,1);
    assert.match(f.field('status').textContent,/11～20/);f.field('save').click();assert.equal(f.downloads.pop().text,before);
  }finally{f.panel.dispose();}
});
for(const change of ['filter','page','size','refresh','dispose'])test('detached record row cannot undo '+change,()=>{
  const f=setup();try{f.panel.refresh(many());const old=rowButton(f,3);
    if(change==='filter')f.change('search','deposit-26');if(change==='page')f.field('next').click();if(change==='size')f.change('size','25');
    if(change==='refresh')f.panel.refresh(workspace(rehearsalExampleV2()));if(change==='dispose')f.panel.dispose();
    const selection=f.field('select').value,detail=f.field('detail').textContent;old.click();assert.equal(f.field('select').value,selection);assert.equal(f.field('detail').textContent,detail);
  }finally{f.panel.dispose();}
});
test('a focus observer that replaces the record source retains its newer detail',()=>{
  const f=setup();try{f.panel.refresh(workspace(rehearsalExampleV2()));const pick=rowButton(f,1);
    f.field('select').focus=()=>f.panel.refresh(workspace(rehearsalExampleV2('DAT','pending')));pick.click();
    assert.equal(f.field('select').value,'DAT:open-one');assert.match(f.field('detail').textContent,/1番目.*open-one/);assert.equal(f.field('rows').children.length,1);
  }finally{f.panel.dispose();}
});
