import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { mountOperationRehearsal } from "../examples/operation-rehearsal-page.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA, encodeRehearsalWorkspace } from "../src/operation-rehearsal-workspace.js";
import { encodeRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA } from "../src/operation-rehearsal-scenario-set.js";
import { captureRehearsalCheckSuite, encodeRehearsalCheckSuite } from "../src/operation-rehearsal-check-suite.js";

class Node extends Element {
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text; }
}
const FORMATS = [
  ["save", "status"], ["csv-save", "status"], ["workspace-save", "workspace-status"],
  ["overview-save", "overview-save-status"], ["workspace-review-save", "workspace-review-status"],
  ["whatif-save", "whatif-export-status"], ["whatif-input-save", "whatif-export-status"],
  ["scenario-set-save", "scenario-set-export-status"], ["scenario-set-report-save", "scenario-set-export-status"],
  ["scenario-set-case-save", "scenario-set-export-status"], ["scenario-set-baseline-save", "scenario-set-export-status"],
  ["scenario-set-case-baseline-save", "scenario-set-export-status"], ["session-save", "session-export-status"],
  ["record-browser-save", "record-browser-export-status"], ["check-suite-save", "check-suite-export-status"],
  ["report-review-save", "report-review-export-status"],
];
const workspace = source => ({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:source.agent,ledgers:[source]});
async function setup(button) {
  const nodes = new Map(), downloads = []; let delivery = () => undefined;
  const document = {getElementById(id) {if (!nodes.has(id)) nodes.set(id,new Node("div"));return nodes.get(id);},createElement:tag=>new Node(tag)};
  const field=id=>document.getElementById(id);
  field("agent").value="DAT"; field("scenario").value="profit";
  const page=mountOperationRehearsal(document, payload=>{downloads.push(payload.prepared);return delivery(payload);});
  const change=(id,value)=>{field(id).value=value;field(id).dispatchEvent(new Event("input"));};
  field("example").click(); field("append-kind").value="reserve";field("append-kind").dispatchEvent(new Event("change"));
  change("append-reference","reward-one");change("append-amount","2.8");field("append-preview").click();field("append-confirm").click();
  assert.equal(field("undo").disabled,false);
  field("whatif-compare").click();change("scenario-set-id","one");change("scenario-set-label","保存確認");
  field("scenario-set-add").click();field("scenario-set-apply").click();
  const source=rehearsalExampleV2();
  if(button==="workspace-review-save") {change("workspace-text",encodeRehearsalWorkspace(workspace(rehearsalExampleV2("EMA"))));field("workspace-text-review").click();}
  if(button==="check-suite-save") {
    const suite=captureRehearsalCheckSuite({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:"one",label:"確認",before:source,after:source}]});
    change("check-suite-text",encodeRehearsalCheckSuite(suite));field("check-suite-paste").click();
  }
  if(button==="report-review-save") {
    change("report-review-text",encodeRehearsalOverview(workspace(source)));field("report-review-paste").click();
    for(let i=0;i<100 && field("report-review-status").getAttribute("aria-busy")==="true";i++)await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(field(button).disabled,false,button+" is ready");
  const snapshot=()=>{const previous=delivery;delivery=()=>undefined;try{field("session-save").click();return downloads.at(-1).text;}finally{delivery=previous;}};
  return {field,page,downloads,snapshot,setDelivery:fn=>{delivery=fn;}};
}

for(const [button,status] of FORMATS) {
  for(const failure of ["false","throw","promise","rejection","thenable","throwing-getter","async-then-rejection"]) {
    test(button+" rejects "+failure+" without a success message or data loss",async t=>{
      const f=await setup(button);t.after(()=>f.page.dispose());const before=f.snapshot();let calls=0,reads=0;
      f.setDelivery(()=>{
        calls++;
        if(failure==="false")return false;
        if(failure==="throw")throw Error("private download detail");
        if(failure==="promise")return Promise.resolve(true);
        if(failure==="rejection")return Promise.reject(Error("private download detail"));
        if(failure==="async-then-rejection")return {async then(){throw Error("private then detail");}};
        return {get then(){reads++;if(failure==="throwing-getter")throw Error("private then detail");return resolve=>resolve(true);}};
      });
      f.field(button).click();await new Promise(resolve=>setImmediate(resolve));
      assert.equal(calls,1);assert.match(f.field(status).textContent,/できません/);
      assert.doesNotMatch(f.field(status).textContent,/private/);
      if(failure==="thenable"||failure==="throwing-getter")assert.equal(reads,1);
      assert.equal(f.field("undo").disabled,false);assert.equal(f.field("scenario-set-undo").disabled,false);
      assert.equal(f.snapshot(),before);
      if(button==="workspace-review-save")assert.equal(f.field("workspace-apply").disabled,false);
    });
  }
  test(button+" accepts synchronous delivery while never claiming completed disk storage",async t=>{
    const f=await setup(button);t.after(()=>f.page.dispose());const before=f.snapshot();
    for(const result of [undefined,true,{schema:"threecore-export-offer-v1",offered:true,downloadComplete:false}]) {
      f.setDelivery(()=>result);f.field(button).click();
      assert.match(f.field(status).textContent,/保存.*(開始|始め)/);
      assert.doesNotMatch(f.field(status).textContent,/保存(が)?完了/);assert.equal(f.snapshot(),before);
    }
  });
}
