import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountRehearsalScenarioSetPanel } from "../examples/operation-rehearsal-scenario-set-panel.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { compareRehearsalScenario, buildRehearsalScenario, rehearsalScenarioParameters, encodeRehearsalScenario } from "../src/operation-rehearsal-scenario.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA, REHEARSAL_SCENARIO_SET_LIMIT, encodeRehearsalScenarioSet, encodeRehearsalScenarioSetReport } from "../src/operation-rehearsal-scenario-set.js";
import { runRehearsalCheckSuite } from "../src/operation-rehearsal-check-suite.js";
import { capacityCases } from "./helpers/rehearsal-capacity-fixtures.js";
class Node extends Element {set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}}
const rendered=n=>[n.textContent,...n.children.map(rendered)].join(" ");
const comparison=(agent="DAT",amount="50000000")=>{const before=rehearsalExampleV2(agent);return compareRehearsalScenario(before,buildRehearsalScenario(before,{...rehearsalScenarioParameters(before),maxPerOperation:amount}));};
const pack=(...cases)=>({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases});
const item=(id="one",agent="DAT")=>({id,label:"上限50",...comparison(agent).inputs});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){const elements=new Map(),downloads=[];let current=null,throwDownload=false;
  const document={getElementById(id){if(!elements.has(id))elements.set(id,new Node("div"));return elements.get(id);},createElement:tag=>new Node(tag)};
  const field=id=>document.getElementById("scenario-set-"+id);
  const panel=mountRehearsalScenarioSetPanel(document,{getComparison:()=>current,download:({prepared})=>{if(throwDownload)throw Error("Download");downloads.push(prepared);}});
  const change=(id,value,event="input")=>{field(id).value=value;field(id).dispatchEvent(new Event(event));};
  const source=value=>{current=value;panel.sourceChanged();};
  const add=(id="one",agent="DAT")=>{source(comparison(agent));change("id",id);change("label","上限50");field("add").click();field("apply").click();};
  const saved=()=>{field("save").click();return JSON.parse(downloads.at(-1).text);};
  const paste=text=>{change("text",text);field("paste").click();};
  const file=(text,extras={})=>{const bytes=new TextEncoder().encode(text);field("file").files=[{name:"cases.json",size:bytes.length,arrayBuffer:async()=>bytes.buffer,...extras}];field("file").dispatchEvent(new Event("change"));};
  return{field,panel,change,source,add,saved,paste,file,downloads,failDownload:()=>{throwDownload=true;}};
}
test("only a completed comparison enables capture, and preview shows exact changed conditions",()=>{
  const f=setup();assert.equal(f.field("add").disabled,true);f.source(comparison());f.change("id","one");f.change("label","上限50");f.field("add").click();
  assert.equal(f.field("rows").children.length,0);assert.equal(f.field("save").disabled,true);
  assert.match(rendered(f.field("changes")),/100 SIM → 50 SIM/);assert.match(rendered(f.field("changes")),/0x111111/);
  f.field("apply").click();assert.equal(f.saved().cases.length,1);assert.equal(f.field("apply").disabled,true);
});
test("duplicate add cannot replace a case, explicit replacement can be cancelled or undone",()=>{
  const f=setup();f.add();const before=f.saved();f.source(comparison("DAT","70000000"));f.field("add").click();assert.equal(f.field("apply").disabled,true);
  f.field("replace").click();assert.match(rendered(f.field("changes")),/70 SIM/);f.field("cancel").click();assert.deepEqual(f.saved(),before);
  f.field("replace").click();f.field("apply").click();assert.equal(f.saved().cases[0].after.policy.maxPerOperation,"70000000");
  f.field("undo").click();assert.deepEqual(f.saved(),before);
});
test("name changes and deletion require review and retain bounded undo",()=>{
  const f=setup();f.add();f.change("label","名前変更");f.field("rename").click();assert.equal(f.saved().cases[0].label,"上限50");
  f.field("apply").click();assert.equal(f.saved().cases[0].label,"名前変更");f.field("remove").click();f.field("apply").click();
  assert.equal(f.field("save").disabled,true);f.field("undo").click();assert.equal(f.saved().cases[0].label,"名前変更");
});
test("display filters and chosen detail do not narrow full exports",()=>{
  const f=setup();f.add("dat");f.add("ema","EMA");f.change("agent","DAT","change");
  assert.equal(f.field("rows").children.length,1);assert.equal(f.saved().cases.length,2);assert.match(f.field("count").textContent,/表示 1件 \/ 保存中 2件/);
  f.field("report-save").click();assert.equal(f.downloads.at(-1).text,encodeRehearsalScenarioSetReport(f.saved()));
  f.field("case-save").click();assert.equal(f.downloads.at(-1).text,encodeRehearsalScenario(...Object.values(comparison().inputs)));
  f.change("agent","CAWELON","change");assert.equal(f.field("case-save").disabled,true);assert.equal(f.saved().cases.length,2);
});
test("newly rejected filter excludes unchanged cases and preserves selected context",()=>{
  const f=setup();f.add();f.source(comparison("EMA","100000000"));f.change("id","same");f.change("label","変更なし");f.field("add").click();f.field("apply").click();
  f.change("outcome","rejected","change");assert.equal(f.field("rows").children.length,1);assert.match(f.field("detail").textContent,/one — 上限50/);
  f.change("outcome","all","change");f.change("select","same","change");assert.equal(f.field("id").value,"same");assert.match(f.field("detail").textContent,/EMA/);
});
test("source edits preserve saved snapshots and undo but revoke an outstanding capture",()=>{
  const f=setup();f.add();const before=f.saved();f.change("id","two");f.field("add").click();f.source(null);
  assert.equal(f.field("apply").disabled,true);assert.equal(f.field("add").disabled,true);assert.deepEqual(f.saved(),before);assert.equal(f.field("undo").disabled,false);
});
test("expected-outcome export includes every committed case regardless of the visible filter",()=>{
  const f=setup();assert.equal(f.field("baseline-save").disabled,true);f.add("dat");f.add("ema","EMA");f.change("agent","CAWELON","change");
  f.field("baseline-save").click();const suite=JSON.parse(f.downloads.at(-1).text);assert.equal(suite.inputs.cases.length,2);
  assert.equal(runRehearsalCheckSuite(suite).summary.allMatched,true);f.panel.dispose();assert.equal(f.field("baseline-save").disabled,true);
});
test("paste import replaces the case set only after review and is undoable",()=>{
  const f=setup();f.add();const before=f.saved();f.paste(encodeRehearsalScenarioSet(pack(item("ema","EMA"))));
  assert.equal(f.field("text").value,"");assert.deepEqual(f.saved(),before);f.field("apply").click();assert.equal(f.saved().cases[0].id,"ema");
  f.field("undo").click();assert.deepEqual(f.saved(),before);
});
test("malformed input and editing an ID cancel prior import review without clearing saved cases",()=>{
  const f=setup();f.add();const before=f.saved();f.paste(encodeRehearsalScenarioSet(pack(item("two"))));f.change("id","other");assert.equal(f.field("apply").disabled,true);
  f.paste("{");assert.equal(f.field("apply").disabled,true);assert.deepEqual(f.saved(),before);
});
test("bounded file import uses actual UTF-8 bytes and handles cancelled selection",async()=>{
  const f=setup();const text=encodeRehearsalScenarioSet(pack(item()));f.file(text);await tick();assert.equal(f.field("apply").disabled,false);
  f.field("file").files=[];f.field("file").dispatchEvent(new Event("change"));assert.equal(f.field("apply").disabled,false);
  f.field("apply").click();assert.equal(f.saved().cases.length,1);let read=false;
  f.file(text,{size:REHEARSAL_SCENARIO_SET_LIMIT+1,arrayBuffer:()=>{read=true;}});await tick();assert.equal(read,false);assert.equal(f.field("apply").disabled,true);
  f.file(text,{size:1,arrayBuffer:async()=>new Uint8Array([255]).buffer});await tick();assert.equal(f.field("apply").disabled,true);assert.equal(f.saved().cases.length,1);
});
for(const action of ["cancel","paste","dispose"])test(action+" supersedes a late file read",async()=>{
  const f=setup();let release;f.file("x",{arrayBuffer:()=>new Promise(resolve=>{release=resolve;})});
  if(action==="cancel")f.field("cancel").click();if(action==="dispose")f.panel.dispose();if(action==="paste")f.paste(encodeRehearsalScenarioSet(pack(item("newer"))));
  release(new TextEncoder().encode("x").buffer);await tick();
  if(action==="paste"){assert.equal(f.field("apply").disabled,false);f.field("apply").click();assert.equal(f.saved().cases[0].id,"newer");}
  else{assert.equal(f.field("apply").disabled,true);assert.equal(f.field("rows").children.length,0);}
});
test("download failure leaves cases and undo available, disposal removes listeners",()=>{
  const f=setup();f.add();f.failDownload();f.field("save").click();assert.match(f.field("export-status").textContent,/保存できません/);
  assert.equal(f.field("rows").children.length,1);f.panel.dispose();f.field("apply").click();assert.equal(f.field("rows").children.length,0);assert.equal(f.field("undo").disabled,true);
});
test("selected-case baseline uses the visible selected case and preserves the whole collection and undo",()=>{
  const f=setup();assert.equal(f.field("case-baseline-save").disabled,true);
  f.add("dat");f.add("ema","EMA");f.change("select","ema","change");const before=f.saved();
  f.field("case-baseline-save").click();const file=f.downloads.at(-1),suite=JSON.parse(file.text);
  assert.equal(file.filename,"ThreeCore-case-ema-expected-outcomes.json");
  assert.deepEqual(suite.inputs.cases,[before.cases.find(c=>c.id==="ema")]);
  assert.equal(runRehearsalCheckSuite(suite).summary.allMatched,true);assert.deepEqual(f.saved(),before);
  assert.equal(f.field("select").value,"ema");assert.equal(f.field("undo").disabled,false);
  f.change("agent","CAWELON","change");assert.equal(f.field("case-baseline-save").disabled,true);
  const count=f.downloads.length;f.field("case-baseline-save").click();assert.equal(f.downloads.length,count);
});
test("oversized all-case baseline suggests individual export without deleting any saved case",()=>{
  const f=setup(),text=encodeRehearsalScenarioSet(capacityCases(140));
  f.paste(text);f.field("apply").click();f.field("baseline-save").click();
  assert.equal(f.downloads.length,0);assert.match(f.field("export-status").textContent,/削除せず/);
  assert.match(f.field("export-status").textContent,/1 MiB/);assert.equal(f.field("rows").children.length,12);
  f.field("case-baseline-save").click();const suite=JSON.parse(f.downloads[0].text);
  assert.equal(suite.inputs.cases.length,1);assert.equal(suite.inputs.cases[0].before.events.length,140);
  assert.equal(encodeRehearsalScenarioSet(f.saved()),text);assert.equal(f.field("undo").disabled,false);
});
test("baseline download failure does not incorrectly ask the user to reduce their records",()=>{
  const f=setup();f.add();f.failDownload();f.field("baseline-save").click();
  assert.match(f.field("export-status").textContent,/もう一度保存/);assert.doesNotMatch(f.field("export-status").textContent,/1 MiB|減らして/);
  f.field("case-baseline-save").click();assert.match(f.field("export-status").textContent,/保持しています/);
  f.panel.dispose();assert.equal(f.field("case-baseline-save").disabled,true);
});
