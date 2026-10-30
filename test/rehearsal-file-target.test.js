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

import {describeRehearsalFileTarget,decodeRehearsalForPanel,describeFileReadError} from "../src/file-read-status.js";
import {rehearsalExample} from "../src/operation-rehearsal-examples.js";
import {encodeRehearsalComparison} from "../src/operation-rehearsal-comparison.js";
import {encodeRehearsalScenario} from "../src/operation-rehearsal-scenario.js";
import {encodeRehearsalScenarioSetReport} from "../src/operation-rehearsal-scenario-set.js";
import {encodeRehearsalCheckReport} from "../src/operation-rehearsal-check-suite.js";
import {encodeRehearsalRecordReport} from "../src/operation-rehearsal-records.js";

const routing=[
 ['threecore.operation-rehearsal.v1','record','記録を保存・再確認'],
 ['threecore.operation-rehearsal.v2','record','記録を保存・再確認'],
 ['threecore.operation-rehearsal-workspace.v1','workspace','保存した3トークンの履歴を戻す'],
 ['threecore.operation-rehearsal-session.v1','session','履歴と比較ケースをまとめて保存・復旧'],
 ['threecore.operation-rehearsal-scenario-set.v1','cases','比較ケースを名前付きで残す'],
 ['threecore.operation-rehearsal-check-suite.v1','expectations','保存した期待結果との比較'],
 ...['overview','comparison','scenario','scenario-set-report','check-report','record-query'].map(name=>['threecore.operation-rehearsal-'+name+'.v1','report','保存した資料を再計算して確認']),
];
const emittedFiles=[encodeRehearsal(rehearsalExample()),FORMATS[0][4],FORMATS[1][4],FORMATS[2][4],FORMATS[3][4],FORMATS[4][4],
 FORMATS[5][4],encodeRehearsalComparison(workspace,workspace),encodeRehearsalScenario(input,input),
 encodeRehearsalScenarioSetReport(cases),encodeRehearsalCheckReport(captureRehearsalCheckSuite(cases)),encodeRehearsalRecordReport(workspace)];
for(const [index,[schema,target,title]]of routing.entries())test('exported artifact points to its actual destination: '+schema,()=>{
 const text=emittedFiles[index];
 assert.equal(JSON.parse(text).schema,schema);
 assert.match(describeRehearsalFileTarget(text,target==='session'?'record':'session'),new RegExp(title));
 assert.equal(describeRehearsalFileTarget(text,target),null);
});
for(const [name,text]of[
 ['malformed','{'],['array','[]'],['null','null'],['unknown',JSON.stringify({schema:'<script>private</script>',simulationOnly:true})],
 ['not-simulation',JSON.stringify({schema:routing[0][0],simulationOnly:false})],['missing-simulation',JSON.stringify({schema:routing[0][0]})],
 ['duplicate','{"schema":"threecore.operation-rehearsal.v1","schema":"threecore.operation-rehearsal-session.v1","simulationOnly":true}'],
 ['unsafe-key','{"__proto__":{},"schema":"threecore.operation-rehearsal.v1","simulationOnly":true}'],
 ['deep','['.repeat(26)+'0'+']'.repeat(26)],['too-large',' '.repeat(2097153)],
 ['non-string',{toString(){throw Error('do not convert');}}],
])test('unknown or ambiguous declaration receives no guessed route: '+name,()=>assert.equal(describeRehearsalFileTarget(text,'session'),null));
test('routing notices never replace successful validation or expose arbitrary exception messages',()=>{
 const text=JSON.stringify({schema:routing[0][0],simulationOnly:true}),result={validated:true};
 assert.equal(decodeRehearsalForPanel(text,'session',()=>result),result);
 const original=Error('private parser details');
 assert.throws(()=>decodeRehearsalForPanel(text,'record',()=>{throw original;}),error=>error===original);
 assert.throws(()=>decodeRehearsalForPanel(text,'session',()=>{throw original;}),error=>{
  assert.match(describeFileReadError(error,'2 MiB'),/記録を保存・再確認/);assert.doesNotMatch(describeFileReadError(error,'2 MiB'),/private/);return true;
 });
 assert.equal(describeFileReadError(Error('private'),'2 MiB'),null);
 assert.equal(describeRehearsalFileTarget(text,'__proto__'),null);
});
test('a saved review receipt requests its original source rather than routing back into review',()=>{
 const text=JSON.stringify({schema:'threecore.operation-rehearsal-report-review.v1',simulationOnly:true});
 assert.match(describeRehearsalFileTarget(text,'report'),/元の資料/);
});
const pasteIds={
 'workspace-file':['workspace-text','workspace-text-review'],
 'session-file':['session-text','session-paste'],
 'scenario-set-file':['scenario-set-text','scenario-set-paste'],
 'check-suite-file':['check-suite-text','check-suite-paste'],
 'report-review-file':['report-review-text','report-review-paste'],
};
for(const [id,cancel,ready,status]of FORMATS){
 for(const mode of (id==='file'?['file']:['file','paste']))test(id+' wrong-format '+mode+' explains destination and preserves live records',async t=>{
  const f=setup(t),before=f.snapshot();
  const selected=id==='session-file'?FORMATS[0][4]:FORMATS[2][4];
  const destination=id==='session-file'?'記録を保存・再確認':'履歴と比較ケースをまとめて保存・復旧';
  if(mode==='file')f.file(id,new File([selected],'wrong-panel.json'));
  else {const [textId,buttonId]=pasteIds[id];f.field(textId).value=selected;f.field(textId).dispatchEvent(new Event('input'));f.field(buttonId).click();}
  await finish(f.field,status);
  assert.match(f.field(status).textContent,new RegExp(destination));assert.equal(f.field(ready).disabled,true);assert.equal(f.snapshot(),before);
 });
}
