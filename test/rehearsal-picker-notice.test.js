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


for(const [id,cancel,ready,status,text] of FORMATS.filter(row=>row[0]!=='workspace-file')){
 test(id+' picker dismissal explains preserved review without replacing its status',async t=>{
  const f=setup(t),before=f.snapshot();f.file(id,new File([text],'fixture.json'));await finish(f.field,status);
  const message=f.field(status).textContent;assert.equal(f.field(ready).disabled,false);
  f.field(id).dispatchEvent(new Event('cancel'));assert.match(f.field(id+'-note').textContent,/変更していません/);
  f.field(id).files=[];f.field(id).dispatchEvent(new Event('change'));assert.match(f.field(id+'-note').textContent,/選ばれていません/);
  assert.equal(f.field(status).textContent,message);assert.equal(f.field(ready).disabled,false);assert.equal(f.snapshot(),before);
  f.field(cancel).click();assert.equal(f.field(id+'-note').textContent,'');
  f.field(id).dispatchEvent(new Event('cancel'));f.page.dispose();assert.equal(f.field(id+'-note').textContent,'');
  f.field(id).dispatchEvent(new Event('cancel'));assert.equal(f.field(id+'-note').textContent,'');
 });
 test(id+' dismissal does not cancel an earlier read and replacement clears only the notice',async t=>{
  const f=setup(t);let release;f.file(id,{name:'pending.json',size:bytes(text).length,arrayBuffer:()=>new Promise(resolve=>{release=resolve;})});
  await tick();assert.equal(typeof release,'function');const reading=f.field(status).textContent;
  f.field(id).dispatchEvent(new Event('cancel'));assert.match(f.field(id+'-note').textContent,/進行中/);assert.equal(f.field(status).textContent,reading);
  release(bytes(text).buffer);await finish(f.field,status);assert.equal(f.field(ready).disabled,false);
  f.file(id,new File([text],'next.json'));assert.equal(f.field(id+'-note').textContent,'');await finish(f.field,status);assert.equal(f.field(ready).disabled,false);
 });
}
test('report picker waits for an asynchronous digest before asserting review readiness',async t=>{
 const original=crypto.subtle.digest;
 t.mock.method(crypto.subtle,'digest',async function(...args){
  await new Promise(resolve=>setTimeout(resolve,40));
  return Reflect.apply(original,this,args);
 });
 const f=setup(t),[id,,,status,text]=FORMATS.find(row=>row[0]==='report-review-file');
 f.file(id,new File([text],'delayed-report.json'));
 await finish(f.field,status);
 assert.equal(f.field('report-review-save').disabled,false);
 assert.match(f.field('report-review-status').textContent,/再計算と一致/);
});
