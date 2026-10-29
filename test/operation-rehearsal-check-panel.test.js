import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountRehearsalCheckPanel } from "../examples/operation-rehearsal-check-panel.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA } from "../src/operation-rehearsal-scenario-set.js";
import { captureRehearsalCheckSuite,encodeRehearsalCheckSuite,encodeRehearsalCheckReport,REHEARSAL_CHECK_SUITE_LIMIT } from "../src/operation-rehearsal-check-suite.js";
const before=rehearsalExampleV2();
const suite=captureRehearsalCheckSuite({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:"one",label:"変更なし",before,after:before}]});
const text=encodeRehearsalCheckSuite(suite),tick=()=>new Promise(resolve=>setImmediate(resolve));
class Node extends Element{set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}}
const rendered=n=>[n.textContent,...n.children.map(rendered)].join(" ");
function setup(){const elements=new Map(),downloads=[];let throwDownload=false;
  const document={getElementById(id){if(!elements.has(id))elements.set(id,new Node("div"));return elements.get(id);},createElement:tag=>new Node(tag)};
  const field=id=>document.getElementById("check-suite-"+id);
  const panel=mountRehearsalCheckPanel(document,{reasons:{PAUSED:"新規利用の停止中"},download:({prepared})=>{if(throwDownload)throw Error("Download");downloads.push(prepared);}});
  const change=value=>{field("text").value=value;field("text").dispatchEvent(new Event("input"));};
  const paste=value=>{change(value);field("paste").click();};
  const file=(value,extras={})=>{const bytes=new TextEncoder().encode(value);field("file").files=[{name:"expected.json",size:bytes.length,arrayBuffer:async()=>bytes.buffer,...extras}];field("file").dispatchEvent(new Event("change"));};
  return{field,panel,change,paste,file,downloads,failDownload:()=>{throwDownload=true;}};
}
test("paste shows matched cases and recorded-calculation limitation, export matches core",()=>{
  const f=setup();f.paste(text);assert.match(f.field("status").textContent,/一致しました/);assert.match(f.field("origin").textContent,/独立に証明/);
  assert.equal(f.field("text").value,"");assert.equal(f.field("rows").children.length,1);f.field("save").click();assert.equal(f.downloads[0].text,encodeRehearsalCheckReport(suite));
});
test("manual expectation mismatch displays concrete values and remains savable",()=>{
  const f=setup(),changed=JSON.parse(text);changed.expectationOrigin="manually-specified";changed.expected[0].after.metrics.cash="1000000000";
  f.paste(JSON.stringify(changed));assert.match(f.field("status").textContent,/異なるケース/);assert.match(f.field("origin").textContent,/根拠は.*確認していません/);
  assert.match(rendered(f.field("differences")),/1000 SIM 1028 SIM/);f.field("save").click();assert.equal(JSON.parse(f.downloads[0].text).summary.allMatched,false);
});
test("editing input immediately removes old results and cannot save them",()=>{
  const f=setup();f.paste(text);f.change("{");assert.equal(f.field("save").disabled,true);assert.equal(f.field("rows").children.length,0);f.field("save").click();assert.equal(f.downloads.length,0);
});
test("known reasons use user-readable text and unknown reasons remain visible",()=>{
  const f=setup(),changed=JSON.parse(text);changed.expected[0].before.allocationBlockers=["PAUSED","FUTURE_REASON"];f.paste(JSON.stringify(changed));
  assert.match(rendered(f.field("differences")),/新規利用の停止中・FUTURE_REASON/);
});
test("file reading preserves source name and chooser cancellation keeps result",async()=>{
  const f=setup();f.file(text);await tick();assert.match(f.field("source").textContent,/expected.json/);f.field("file").files=[];f.field("file").dispatchEvent(new Event("change"));assert.equal(f.field("save").disabled,false);
});
test("oversize and invalid UTF-8 files are refused without partial results",async()=>{
  const f=setup();let read=false;f.file(text,{size:REHEARSAL_CHECK_SUITE_LIMIT+1,arrayBuffer:()=>{read=true;}});await tick();assert.equal(read,false);
  f.file(text,{size:1,arrayBuffer:async()=>new Uint8Array([255]).buffer});await tick();assert.equal(f.field("save").disabled,true);assert.equal(f.field("status").getAttribute("aria-busy"),"false");
});
for(const action of["clear","edit","dispose","paste"])test(action+" supersedes a late file read",async()=>{
  const f=setup();let release;f.file(text,{arrayBuffer:()=>new Promise(resolve=>{release=resolve;})});
  if(action==="clear")f.field("clear").click();if(action==="edit")f.change("{");if(action==="dispose")f.panel.dispose();if(action==="paste")f.paste(text);
  release(new TextEncoder().encode(text).buffer);await tick();assert.equal(f.field("save").disabled,action!=="paste");
  if(action==="paste")assert.match(f.field("source").textContent,/貼り付け/);else assert.equal(f.field("rows").children.length,0);
});
test("download failure preserves displayed comparison and disposal drops it",()=>{
  const f=setup();f.paste(text);f.failDownload();f.field("save").click();assert.match(f.field("export-status").textContent,/保存できません/);
  assert.equal(f.field("rows").children.length,1);f.panel.dispose();f.paste(text);assert.equal(f.field("rows").children.length,0);assert.equal(f.field("save").disabled,true);
});
