import test from "node:test";
import assert from "node:assert/strict";
import { createRehearsalSession, createRehearsalSaveCheckpoint, encodeRehearsalSession } from "../src/operation-rehearsal-session.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { mountRehearsalSessionPanel } from "../examples/operation-rehearsal-session-panel.js";
import { Element } from "./helpers/panel-dom.js";

const populated=agent=>{
  const session=createRehearsalSession(agent),input=rehearsalExampleV2(agent);
  session.workspace.reset(input);
  session.cases.commit(session.cases.previewPut({id:"one",label:"元の名前",before:input,after:input}));
  return session;
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("save checkpoint distinguishes empty, new, saved and changed committed content",()=>{
  const session=createRehearsalSession(),checkpoint=createRehearsalSaveCheckpoint();
  assert.equal(checkpoint.inspect(session.snapshot()).state,"empty");
  session.workspace.reset(rehearsalExampleV2());
  assert.equal(checkpoint.inspect(session.snapshot()).state,"unrecorded");
  checkpoint.record(session.snapshot(),"download");
  assert.equal(checkpoint.inspect(session.snapshot()).state,"matched");
  session.workspace.select("EMA");
  assert.equal(checkpoint.inspect(session.snapshot()).state,"matched");
  session.workspace.reset(rehearsalExampleV2("EMA"));
  const changed=checkpoint.inspect(session.snapshot());
  assert.equal(changed.state,"changed");assert.equal(changed.hasChanges,true);
  assert.equal(changed.records,4);assert.equal(changed.ledgers,2);assert.equal(changed.cases,0);
  session.dispose();
});
test("restored files and offered downloads are distinct, and undo returns to the baseline",()=>{
  const session=populated("DAT"),checkpoint=createRehearsalSaveCheckpoint();
  checkpoint.record(session.snapshot(),"file");
  session.cases.commit(session.cases.previewRename("one","変更した名前"));
  assert.equal(checkpoint.inspect(session.snapshot()).hasChanges,true);
  session.cases.undo();
  const view=checkpoint.inspect(session.snapshot());
  assert.equal(view.hasChanges,false);assert.equal(view.source,"file");assert(Object.isFrozen(view));
  checkpoint.record(session.snapshot(),"download");assert.equal(checkpoint.inspect(session.snapshot()).source,"download");
  checkpoint.clear();assert.equal(checkpoint.inspect(session.snapshot()).state,"unrecorded");session.dispose();
});
test("invalid checkpoint input cannot discard a previous valid baseline",()=>{
  const session=populated("DAT"),checkpoint=createRehearsalSaveCheckpoint(),document=session.snapshot();
  checkpoint.record(document,"file");
  assert.throws(()=>checkpoint.record({},"file"));
  assert.throws(()=>checkpoint.record(document,"paste"),{code:"INVALID_SAVE_CHECKPOINT"});
  assert.equal(checkpoint.inspect(document).state,"matched");session.dispose();
});

class Node extends Element{set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}}
function setup(t,options={}){
  const elements=new Map(),view=new EventTarget(),session=populated("DAT"),downloads=[];
  const document={defaultView:view,getElementById(id){if(!elements.has(id))elements.set(id,new Node("div"));return elements.get(id);},createElement:tag=>new Node(tag)};
  const field=name=>document.getElementById("session-"+name);
  let panel;
  panel=mountRehearsalSessionPanel(document,{session,
    download:({prepared})=>{downloads.push(prepared);return options.download?.(panel);},
    renderWorkspaceComparison:()=>{},onRestored:()=>options.restore?.(panel)});
  t.after(()=>{panel.dispose();session.dispose();});
  const leave=()=>{const event=new Event("beforeunload",{cancelable:true});view.dispatchEvent(event);return event.defaultPrevented;};
  const paste=text=>{field("text").value=text;field("paste").click();};
  const file=async text=>{field("file").files=[new File([text],"recovery.json")];field("file").dispatchEvent(new Event("change"));
    for(let pass=0;pass<100&&field("status").getAttribute("aria-busy")==="true";pass++)await tick();
    assert.notEqual(field("status").getAttribute("aria-busy"),"true");};
  return{field,session,panel,leave,paste,file,downloads};
}
test("save guidance and exit protection follow edits and undo without treating selection as an edit",t=>{
  const f=setup(t);
  assert.equal(f.field("save-state").getAttribute("data-state"),"unrecorded");assert(f.leave());
  f.field("save").click();assert(!f.leave());
  assert.match(f.field("save-state").textContent,/保存先にファイルができたことを確認/);
  assert.doesNotMatch(f.field("save-state").textContent,/保存完了/);
  f.session.workspace.select("EMA");assert(!f.leave());
  f.session.cases.commit(f.session.cases.previewRename("one","変えた名前"));assert(f.leave());
  assert.equal(f.field("save-state").getAttribute("data-state"),"changed");
  f.session.cases.undo();assert(!f.leave());
  f.panel.dispose();assert(!f.leave());assert.equal(f.field("save-state").textContent,"");
});
for(const refusal of ["false","throw","promise"])test(refusal+" download does not remove the unsaved-content warning",async t=>{
  const f=setup(t,{download:()=>{if(refusal==="throw")throw Error("synthetic");if(refusal==="promise")return Promise.reject(Error("synthetic"));return false;}});
  f.field("save").click();await tick();assert(f.leave());
  assert.equal(f.field("save-state").getAttribute("data-state"),"unrecorded");
  assert.match(f.field("export-status").textContent,/保存できません/);
});
test("previewing a real file does not mark saved; applying it establishes a local-file baseline",async t=>{
  const f=setup(t),replacement=populated("EMA"),text=encodeRehearsalSession(replacement.snapshot());replacement.dispose();
  await f.file(text);assert(f.leave());assert.equal(f.field("apply").disabled,false);
  f.field("apply").click();assert(!f.leave());
  assert.match(f.field("save-state").textContent,/読み込んだ保存ファイルと同じ/);
  assert.equal(f.session.workspace.state().activeAgent,"EMA");
  f.session.cases.commit(f.session.cases.previewRename("one","ファイル後の変更"));assert(f.leave());
});
test("an identical local file establishes a baseline without a destructive replacement",async t=>{
  const f=setup(t),before=f.session.snapshot();assert(f.leave());
  await f.file(encodeRehearsalSession(before));
  assert.equal(f.field("apply").disabled,true);assert(!f.leave());
  assert.equal(f.session.cases.state().canUndo,true);assert.deepEqual(f.session.snapshot(),before);
  assert.match(f.field("save-state").textContent,/読み込んだ保存ファイルと同じ/);
});
test("pasted recovery never claims an existing local backup",t=>{
  const f=setup(t),replacement=populated("EMA");f.paste(encodeRehearsalSession(replacement.snapshot()));replacement.dispose();
  f.field("apply").click();assert(f.leave());
  assert.equal(f.field("save-state").getAttribute("data-state"),"unrecorded");
});
test("invalid input and a cancelled review cannot reset a previous save baseline",t=>{
  const f=setup(t);f.field("save").click();f.paste("{");assert(!f.leave());
  const replacement=populated("EMA");f.paste(encodeRehearsalSession(replacement.snapshot()));replacement.dispose();
  f.field("cancel").click();assert(!f.leave());
  assert.equal(f.field("save-state").getAttribute("data-state"),"matched");
});
for(const outcome of ["dispose","throw","reject"])test("restore view "+outcome+" cannot rewrite a closed panel or hide successful data restoration",async t=>{
  const f=setup(t,{restore:panel=>{
    if(outcome==="dispose")panel.dispose();
    else if(outcome==="throw")throw Error("synthetic");
    else return Promise.reject(Error("synthetic"));
  }}),replacement=populated("EMA");f.paste(encodeRehearsalSession(replacement.snapshot()));replacement.dispose();
  f.field("apply").click();await tick();
  assert.equal(f.session.workspace.state().activeAgent,"EMA");
  if(outcome==="dispose"){
    assert.equal(f.field("receipt").textContent,"");assert.equal(f.field("status").textContent,"");assert(!f.leave());
  }else{
    assert.match(f.field("status").textContent,/復旧は完了.*画面/);assert.match(f.field("receipt").textContent,/EMA 2件/);assert(f.leave());
  }
});
