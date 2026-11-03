import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountOperationRehearsal } from "../examples/operation-rehearsal-page.js";
import { createFileReadScope } from "../src/security-file.js";
import { walletFileReadService } from "../src/file-read-service.js";
import { encodeRehearsalSession } from "../src/operation-rehearsal-session.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { encodeRehearsal } from "../src/operation-rehearsal.js";
import { REHEARSAL_WORKSPACE_SCHEMA, encodeRehearsalWorkspace } from "../src/operation-rehearsal-workspace.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA, encodeRehearsalScenarioSet } from "../src/operation-rehearsal-scenario-set.js";
import { captureRehearsalCheckSuite, encodeRehearsalCheckSuite } from "../src/operation-rehearsal-check-suite.js";
import { encodeRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { createRehearsalSession } from "../src/operation-rehearsal-session.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
const bytes = text => new TextEncoder().encode(text);
const input = rehearsalExampleV2("EMA");
const workspace = {schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly:true, activeAgent:"EMA", ledgers:[input]};
const cases = {schema: REHEARSAL_SCENARIO_SET_SCHEMA, simulationOnly:true, cases:[{id:"ema", label:"日本語の確認", before:input, after:input}]};
const session = createRehearsalSession("EMA"); session.workspace.reset(input);
session.cases.commit(session.cases.previewImport(cases));
const FORMATS = [
  ["file","cancel","apply","status",encodeRehearsal(input)],
  ["workspace-file","workspace-cancel","workspace-apply","workspace-status",encodeRehearsalWorkspace(workspace)],
  ["session-file","session-cancel","session-apply","session-status",encodeRehearsalSession(session.snapshot())],
  ["scenario-set-file","scenario-set-cancel","scenario-set-apply","scenario-set-status",encodeRehearsalScenarioSet(cases)],
  ["check-suite-file","check-suite-clear","check-suite-save","check-suite-status",encodeRehearsalCheckSuite(captureRehearsalCheckSuite(cases))],
  ["report-review-file","report-review-clear","report-review-save","report-review-status",encodeRehearsalOverview(workspace)],
];
class Node extends Element {
  set textContent(value) { this.text=value; this.children=[]; }
  get textContent() { return this.text; }
}
function setup(t) {
  const nodes=new Map(),downloads=[];
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Node("div"));return nodes.get(id);},createElement:tag=>new Node(tag)};
  const field=id=>document.getElementById(id);
  field("agent").value="DAT";field("scenario").value="profit";
  const page=mountOperationRehearsal(document,({prepared})=>downloads.push(prepared));
  t.after(()=>page.dispose());field("example").click();
  const file=(id,value)=>{field(id).files=[value];field(id).dispatchEvent(new Event("change"));};
  const snapshot=()=>{field("session-save").click();return downloads.at(-1).text;};
  return {field,page,file,snapshot};
}
async function finish(field,status) {
  const deadline=performance.now()+5000;
  while(field(status).getAttribute("aria-busy")==="true"||walletFileReadService.state().waiting>0){
    assert.ok(performance.now()<deadline,"Rehearsal file verification did not settle within five seconds");
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  await tick();
}

for(const [id,cancel,ready,status,text] of FORMATS) {
  test(id+" accepts real File streaming with multibyte input and preserves applied history",async t=>{
    const f=setup(t),before=f.snapshot();
    f.file(id,new File([text],"rehearsal.json",{type:"application/json"}));
    await finish(f.field,status);assert.equal(f.field(ready).disabled,false);
    assert.equal(f.snapshot(),before);assert.equal(walletFileReadService.state().active,0);
  });
  for(const fault of ["invalid-utf8","bom","wrong-byte-count","fake-buffer","oversized","empty","read-failure"]) {
    test(id+" rejects "+fault+" without changing the applied history",async t=>{
      const f=setup(t),before=f.snapshot();let buffer=bytes(text).buffer;
      if(fault==="invalid-utf8") buffer=new Uint8Array([255,...bytes(text)]).buffer;
      if(fault==="bom") buffer=bytes("\ufeff"+text).buffer;
      const size=fault==="empty"?0:fault==="oversized"?3*1024*1024:fault==="wrong-byte-count"?buffer.byteLength+1:buffer.byteLength;
      let called=false;
      f.file(id,{size,name:"rehearsal.json",arrayBuffer:async()=>{called=true;if(fault==="read-failure")throw Error("synthetic private path");return fault==="fake-buffer"?new Uint8Array(buffer):buffer;}});
      await finish(f.field,status);assert.equal(f.field(ready).disabled,true);
      assert.equal(f.snapshot(),before);assert.equal(walletFileReadService.state().active,0);
      const message=f.field(status).textContent;
      assert.doesNotMatch(message,/synthetic private path/);
      if(fault==="invalid-utf8")assert.match(message,/文字.*UTF-8/);
      if(fault==="wrong-byte-count")assert.match(message,/容量.*一致しません/);
      if(fault==="read-failure")assert.match(message,/手元のフォルダー/);
      if(fault==="oversized"||fault==="empty")assert.equal(called,false);
    });
  }
  for(const action of ["cancel","dispose"]) test(id+" ends its pending waiter on "+action+" before late bytes settle",async t=>{
    const f=setup(t);let release;
    f.file(id,{name:"pending.json",size:bytes(text).length,arrayBuffer:()=>new Promise(resolve=>{release=resolve;})});
    await tick();assert.equal(walletFileReadService.state().waiting,1);
    if(action==="dispose")f.page.dispose();else f.field(cancel).click();
    await tick();assert.equal(walletFileReadService.state().waiting,0);
    assert.equal(walletFileReadService.state().retained,1);
    const newerStatus=f.field(status).textContent;
    release(bytes(text).buffer);await tick();
    assert.equal(walletFileReadService.state().active,0);assert.equal(f.field(ready).disabled,true);
    assert.equal(f.field(status).textContent,newerStatus);
  });
  test(id+" cancellation before the worker starts never opens the file",async t=>{
    const f=setup(t);let opened=false;
    f.file(id,{size:1,arrayBuffer:()=>{opened=true;return new ArrayBuffer(1);}});
    f.field(cancel).click();await tick();assert.equal(opened,false);assert.equal(walletFileReadService.state().active,0);
  });
  test(id+" cancelled file choice preserves the reviewed result",async t=>{
    const f=setup(t),before=f.snapshot();
    f.file(id,new File([text],"rehearsal.json"));await finish(f.field,status);
    assert.equal(f.field(ready).disabled,false);
    const message=f.field(status).textContent;
    f.field(id).dispatchEvent(new Event("cancel"));
    f.field(id).files=[];f.field(id).dispatchEvent(new Event("change"));
    assert.equal(f.field(ready).disabled,false);
    assert.equal(f.field(status).textContent,message);
    assert.equal(f.snapshot(),before);
  });
}

test("every file input explains shared capacity and recovers after workers actually settle",async t=>{
  const f=setup(t),scopes=[],releases=[],outcomes=[],before=f.snapshot();
  for(let index=0;index<4;index++){
    const scope=createFileReadScope();scopes.push(scope);
    outcomes.push(scope.readText({size:1,arrayBuffer:()=>new Promise(resolve=>releases.push(resolve))},{maxBytes:1}).catch(error=>error.code));
  }
  await tick();assert.equal(walletFileReadService.state().active,4);
  for(const [id,,ready,status,text] of FORMATS){
    f.file(id,new File([text],"rehearsal.json"));await tick();
    assert.equal(f.field(ready).disabled,true);
    assert.match(f.field(status).textContent,/ほかのファイル.*自動での再読み込みはしません/);
    assert.notEqual(f.field(status).getAttribute("aria-busy"),"true");
    assert.equal(f.snapshot(),before);
  }
  scopes.forEach(scope=>scope.cancel());releases.forEach(release=>release(bytes("x").buffer));
  await Promise.all(outcomes);await tick();assert.equal(walletFileReadService.state().active,0);
  for(const [id,,ready,status,text] of FORMATS){
    f.file(id,new File([text],"rehearsal.json"));await finish(f.field,status);
    assert.equal(f.field(ready).disabled,false);assert.equal(f.snapshot(),before);
  }
});

test("a read deadline releases the caller but keeps the real worker budget until settlement",async()=>{
  const scope=createFileReadScope();let release;
  const promise=scope.readText({size:1,arrayBuffer:()=>new Promise(resolve=>{release=resolve;})},{maxBytes:4,timeoutMs:5});
  await assert.rejects(promise,{code:"FILE_TIMEOUT"});
  assert.equal(walletFileReadService.state().waiting,0);assert.equal(walletFileReadService.state().retained,1);
  release(bytes("x").buffer);await tick();assert.equal(walletFileReadService.state().active,0);
});
test("replacing one read cancels only its own waiter; the newer reader survives old settlement",async()=>{
  const scope=createFileReadScope(),other=createFileReadScope();let firstRelease,secondRelease,otherRelease;
  const delayed=set=>({size:1,arrayBuffer:()=>new Promise(resolve=>set(resolve))});
  const first=scope.readText(delayed(fn=>firstRelease=fn),{maxBytes:4});
  const firstRejected=assert.rejects(first,{code:"FILE_CANCELLED"});await tick();
  const unrelated=other.readText(delayed(fn=>otherRelease=fn),{maxBytes:4});
  const second=scope.readText(delayed(fn=>secondRelease=fn),{maxBytes:4});await tick();
  await firstRejected;assert.equal(walletFileReadService.state().waiting,2);
  firstRelease(bytes("a").buffer);await tick();scope.cancel();
  await assert.rejects(second,{code:"FILE_CANCELLED"});
  secondRelease(bytes("b").buffer);otherRelease(bytes("c").buffer);
  assert.equal(await unrelated,"c");await tick();assert.equal(walletFileReadService.state().active,0);
});
test("four rehearsal panels share the page budget and cancellation cannot overbook retained workers",async t=>{
  const f=setup(t),releases=[];
  for(const [id] of [FORMATS[1],FORMATS[3],FORMATS[4],FORMATS[5]])f.file(id,{size:1,arrayBuffer:()=>new Promise(resolve=>releases.push(resolve))});
  await tick();assert.equal(walletFileReadService.state().waiting,4);
  let opened=false;const one=FORMATS[2];
  f.file(one[0],{size:1,arrayBuffer:()=>{opened=true;return bytes("x").buffer;}});await tick();
  assert.equal(opened,false);assert.equal(f.field(one[2]).disabled,true);
  f.field("workspace-cancel").click();await tick();
  assert.equal(walletFileReadService.state().retained,2);assert.equal(walletFileReadService.state().waiting,2);
  f.file(one[0],{size:1,arrayBuffer:()=>{opened=true;return bytes("x").buffer;}});await tick();assert.equal(opened,false);
  f.page.dispose();for(const release of releases)release(bytes("x").buffer);await tick();
  assert.equal(walletFileReadService.state().active,0);
});
