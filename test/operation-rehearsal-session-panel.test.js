import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountRehearsalSessionPanel } from "../examples/operation-rehearsal-session-panel.js";
import { createRehearsalSession,encodeRehearsalSession,REHEARSAL_SESSION_LIMIT } from "../src/operation-rehearsal-session.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
class Node extends Element{set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}}
const populated=agent=>{const session=createRehearsalSession(agent),source=rehearsalExampleV2(agent);session.workspace.reset(source);session.cases.commit(session.cases.previewPut({id:agent.toLowerCase(),label:agent+" の比較",before:source,after:source}));return session;};
const text=encodeRehearsalSession(populated("EMA").snapshot()),tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(options={}){const elements=new Map(),downloads=[],session=populated("DAT");let callbacks=0,throwDownload=false;
  const document={getElementById(id){if(!elements.has(id))elements.set(id,new Node("div"));return elements.get(id);},createElement:tag=>new Node(tag)};
  const field=id=>document.getElementById("session-"+id);
  const panel=mountRehearsalSessionPanel(document,{session,download:({prepared})=>{if(throwDownload)throw Error("Save");downloads.push(prepared);},renderWorkspaceComparison:comparison=>{field("workspace-details").textContent=JSON.stringify(comparison.rows.map(row=>row.action));},onRestored:()=>{callbacks++;if(options.throwRender)throw Error("Render");}});
  const change=value=>{field("text").value=value;field("text").dispatchEvent(new Event("input"));};
  const paste=value=>{change(value);field("paste").click();};
  const file=(value,extras={})=>{const bytes=new TextEncoder().encode(value);field("file").files=[{name:"session.json",size:bytes.length,arrayBuffer:async()=>bytes.buffer,...extras}];field("file").dispatchEvent(new Event("change"));};
  return{field,panel,session,downloads,change,paste,file,callbacks:()=>callbacks,failDownload:()=>{throwDownload=true;}};
}
test("combined export contains committed workspace and cases without applying a pending import",()=>{
  const f=setup(),before=encodeRehearsalSession(f.session.snapshot());f.paste(text);f.field("save").click();assert.equal(f.downloads[0].text,before);assert.equal(f.field("apply").disabled,false);assert.equal(f.session.workspace.state().activeAgent,"DAT");
});
test("paste preview exposes both replacements, confirms once and records the source",()=>{
  const f=setup();f.paste(text);assert.match(f.field("workspace-details").textContent,/removed/);assert.equal(f.field("cases").children.length,2);assert.equal(f.field("text").value,"");
  f.field("apply").click();assert.equal(f.session.workspace.state().activeAgent,"EMA");assert.equal(f.session.cases.state().current.cases[0].id,"ema");assert.equal(f.callbacks(),1);assert.equal(f.field("apply").disabled,true);assert.match(f.field("receipt").textContent,/EMA 2件.*比較ケース 1件/);
});
test("same-input preview is visible but does not need reapplication",()=>{
  const f=setup();f.paste(encodeRehearsalSession(f.session.snapshot()));assert.equal(f.field("apply").disabled,true);assert.match(f.field("summary").textContent,/入力内容は同じ/);
});
test("cancel preserves both old stores and their independent undo",()=>{
  const f=setup(),before=f.session.snapshot();f.paste(text);f.field("cancel").click();assert.deepEqual(f.session.snapshot(),before);assert.equal(f.session.cases.state().canUndo,true);assert.equal(f.field("apply").disabled,true);
});
test("source edits and invalid input revoke old review without silently replacing either source",()=>{
  const f=setup();f.paste(text);f.session.workspace.select("CAWELON");assert.equal(f.field("apply").disabled,true);
  f.paste("{");assert.equal(f.session.cases.state().current.cases[0].id,"dat");assert.equal(f.session.workspace.snapshot().ledgers[0].agent,"DAT");
});
test("file review uses bounded bytes and chooser cancellation preserves preview",async()=>{
  const f=setup();f.file(text);await tick();assert.match(f.field("source").textContent,/session.json/);f.field("file").files=[];f.field("file").dispatchEvent(new Event("change"));assert.equal(f.field("apply").disabled,false);
  let read=false;f.file(text,{size:REHEARSAL_SESSION_LIMIT+1,arrayBuffer:()=>{read=true;}});await tick();assert.equal(read,false);assert.equal(f.field("apply").disabled,true);
  f.file(text,{size:1,arrayBuffer:async()=>new Uint8Array([255]).buffer});await tick();assert.equal(f.field("apply").disabled,true);
});
for(const action of["cancel","edit","source","dispose","paste"])test(action+" supersedes a late combined-file read",async()=>{
  const f=setup();let release;f.file(text,{arrayBuffer:()=>new Promise(resolve=>{release=resolve;})});
  if(action==="cancel")f.field("cancel").click();if(action==="edit")f.change("{");if(action==="source")f.session.workspace.select("EMA");if(action==="dispose")f.panel.dispose();if(action==="paste")f.paste(text);
  release(new TextEncoder().encode(text).buffer);await tick();assert.equal(f.field("apply").disabled,action!=="paste");assert.equal(f.session.cases.state().current.cases[0].id,"dat");
});
test("a view failure after commit accurately reports that data restoration completed",()=>{
  const f=setup({throwRender:true});f.paste(text);f.field("apply").click();assert.equal(f.session.workspace.state().activeAgent,"EMA");assert.match(f.field("status").textContent,/復旧は完了.*画面/);assert.match(f.field("receipt").textContent,/EMA 2件/);
});
test("save failure retains both stores and disposal removes callbacks",()=>{
  const f=setup(),before=f.session.snapshot();f.failDownload();f.field("save").click();assert.match(f.field("export-status").textContent,/保存できません/);assert.deepEqual(f.session.snapshot(),before);
  f.panel.dispose();f.session.workspace.select("EMA");assert.equal(f.field("status").textContent,"");assert.equal(f.field("save").disabled,true);
});
