import test from "node:test";
import assert from "node:assert/strict";
import { mountOperationRehearsal } from "../examples/operation-rehearsal-page.js";
import { rehearsalExample, rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { encodeRehearsalWorkspace, decodeRehearsalWorkspace, REHEARSAL_WORKSPACE_SCHEMA,
  REHEARSAL_WORKSPACE_LIMIT } from "../src/operation-rehearsal-workspace.js";
import { encodeRehearsal, decodeRehearsal, evaluateRehearsal, REHEARSAL_LIMIT } from "../src/operation-rehearsal.js";
import { Element } from "./helpers/panel-dom.js";
import { encodeRehearsalComparison } from "../src/operation-rehearsal-comparison.js";
import { encodeRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { encodeRehearsalScenario } from "../src/operation-rehearsal-scenario.js";
import { captureRehearsalCheckSuite, encodeRehearsalCheckSuite } from "../src/operation-rehearsal-check-suite.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA } from "../src/operation-rehearsal-scenario-set.js";

const bytesOf = text => new TextEncoder().encode(text);
const selectedFile = (text, extras) => ({size: bytesOf(text).length, arrayBuffer: async () => bytesOf(await (extras.text ? extras.text() : text)).buffer, ...extras});
const tick = () => new Promise(resolve => setImmediate(resolve));
class Node extends Element {
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return this.text; }
}
function setup() {
  const elements = new Map(), downloads = [];
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, new Node("div")); return elements.get(id); },
    createElement: tag => new Node(tag),
  };
  const field = id => document.getElementById(id);
  field("agent").value = "DAT"; field("scenario").value = "profit";
  field("save").disabled = true; field("apply").disabled = true;
  const page = mountOperationRehearsal(document, ({ prepared }) => downloads.push(prepared));
  const change = (id, value) => { field(id).value = value; field(id).dispatchEvent(new Event("input")); };
  const file = (text, extras = {}) => {
    field("file").files = [selectedFile(text, extras)];
    field("file").dispatchEvent(new Event("change"));
  };
  return { field, page, change, downloads, file };
}

function prepareAppend(f, kind, amount = "2.8", reference = "reward-one") {
  f.field("append-kind").value = kind;
  f.field("append-kind").dispatchEvent(new Event("change"));
  f.change("append-reference", reference); f.change("append-amount", amount);
  f.change("append-fee", "1"); f.change("append-exit-reserve", "2");
  f.field("append-preview").click();
}
const workspaceFile = (f, ledgers, activeAgent = "DAT", extras = {}) => {
  const text = encodeRehearsalWorkspace({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent, ledgers });
  f.field("workspace-file").files = [selectedFile(text, extras)];
  f.field("workspace-file").dispatchEvent(new Event("change"));
};
const selectAgent = (f, name) => { f.field("agent").value = name; f.field("agent").dispatchEvent(new Event("change")); };
const savedWorkspace = f => { f.field("workspace-save").click(); return decodeRehearsalWorkspace(f.downloads.at(-1).text); };
const workspaceText = (ledgers, activeAgent = "DAT") => encodeRehearsalWorkspace({
  schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent, ledgers });
const pasteWorkspace = (f, text) => { f.change("workspace-text", text); f.field("workspace-text-review").click(); };
const renderedText = node => [node.textContent, ...node.children.map(renderedText)].join(" ");

test("combined restore replaces workspace and case collection together and clears their undo histories",()=>{
  const f=setup();f.field("example").click();prepareAppend(f,"reserve");f.field("append-confirm").click();f.field("whatif-compare").click();
  f.change("scenario-set-id","dat");f.change("scenario-set-label","DATのケース");f.field("scenario-set-add").click();f.field("scenario-set-apply").click();f.field("session-save").click();const original=f.downloads.at(-1).text;
  selectAgent(f,"EMA");f.field("example").click();f.field("whatif-compare").click();f.change("scenario-set-id","ema");f.change("scenario-set-label","EMAのケース");f.field("scenario-set-add").click();f.field("scenario-set-apply").click();
  f.change("session-text",original);f.field("session-paste").click();assert.equal(f.field("scenario-set-rows").children.length,2);assert.match(renderedText(f.field("session-workspace-details")),/履歴を消去/);
  f.field("session-apply").click();assert.equal(f.field("agent").value,"DAT");assert.equal(f.field("rows").children.length,3);assert.equal(f.field("scenario-set-rows").children.length,1);assert.equal(f.field("undo").disabled,true);assert.equal(f.field("scenario-set-undo").disabled,true);
  f.field("session-save").click();assert.equal(f.downloads.at(-1).text,original);assert.match(f.field("session-receipt").textContent,/DAT 3件.*比較ケース 1件/);
});
test("read-only search retains combined review while a hypothetical draft edit revokes it",()=>{
  const f=setup();f.field("example").click();f.field("session-save").click();const text=f.downloads.at(-1).text;selectAgent(f,"EMA");f.field("example").click();
  f.change("session-text",text);f.field("session-paste").click();f.change("record-browser-search","one");assert.equal(f.field("session-apply").disabled,false);
  f.change("whatif-openingBalance","1001");assert.equal(f.field("session-apply").disabled,true);f.field("session-save").click();assert.equal(JSON.parse(f.downloads.at(-1).text).workspace.ledgers.length,2);
});

test("record queries preserve pending append and restore and expose only committed inputs",()=>{
  const f=setup();f.field("example").click();prepareAppend(f,"reserve");const before=savedWorkspace(f);
  assert.equal(f.field("record-browser-rows").children.length,2);f.change("record-browser-search","settle");
  assert.equal(f.field("record-browser-rows").children.length,1);assert.equal(f.field("append-confirm").disabled,false);
  f.field("record-browser-save").click();assert.equal(JSON.parse(f.downloads.at(-1).text).matchedRecords,1);assert.deepEqual(savedWorkspace(f),before);
  f.field("append-confirm").click();f.field("record-browser-clear").click();assert.equal(f.field("record-browser-rows").children.length,3);
  pasteWorkspace(f,workspaceText([rehearsalExampleV2("EMA")]));f.change("record-browser-search","reserve");assert.equal(f.field("workspace-apply").disabled,false);
  f.field("workspace-apply").click();f.field("record-browser-clear").click();assert.match(f.field("record-browser-scope").textContent,/DAT: 未作成 \/ EMA: 2件/);
});

test("expected-outcome checking leaves ledger, undo and unconfirmed collection change intact",()=>{
  const f=setup();f.field("example").click();prepareAppend(f,"reserve");f.field("append-confirm").click();const before=savedWorkspace(f);
  f.field("whatif-compare").click();f.change("scenario-set-id","one");f.change("scenario-set-label","変更なし");f.field("scenario-set-add").click();
  const source=before.ledgers[0],suite=captureRehearsalCheckSuite({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:"check",label:"別の確認",before:source,after:source}]});
  f.change("check-suite-text",encodeRehearsalCheckSuite(suite));f.field("check-suite-paste").click();assert.equal(f.field("check-suite-save").disabled,false);
  assert.equal(f.field("scenario-set-apply").disabled,false);assert.equal(f.field("undo").disabled,false);assert.deepEqual(savedWorkspace(f),before);
  f.field("scenario-set-apply").click();assert.equal(f.field("scenario-set-rows").children.length,1);f.page.dispose();assert.equal(f.field("check-suite-rows").children.length,0);
});

test("named comparison snapshots preserve all ledger inputs and undo across source changes",()=>{
  const f=setup();f.field("example").click();prepareAppend(f,"reserve");f.field("append-confirm").click();const before=savedWorkspace(f);
  f.change("whatif-maxPerOperation","50");f.field("whatif-compare").click();
  assert.equal(f.field("scenario-set-add").disabled,false);f.change("scenario-set-id","dat-limit");f.change("scenario-set-label","上限50");
  f.field("scenario-set-add").click();f.field("scenario-set-apply").click();
  f.field("scenario-set-save").click();const saved=f.downloads.at(-1).text;assert.equal(JSON.parse(saved).cases[0].before.events.length,3);
  assert.deepEqual(savedWorkspace(f),before);assert.equal(f.field("undo").disabled,false);
  f.change("whatif-maxPerOperation","70");assert.equal(f.field("scenario-set-add").disabled,true);
  f.field("scenario-set-save").click();assert.equal(f.downloads.at(-1).text,saved);
  selectAgent(f,"EMA");assert.equal(f.field("scenario-set-rows").children.length,1);
  selectAgent(f,"DAT");assert.deepEqual(savedWorkspace(f),before);f.field("undo").click();assert.equal(f.field("rows").children.length,2);
});

test("read-only saved-report review preserves workspace, undo and pending restore",async()=>{
  const f=setup();f.field("example").click();prepareAppend(f,"reserve");f.field("append-confirm").click();
  const before=savedWorkspace(f);const report=encodeRehearsalOverview(before);
  pasteWorkspace(f,workspaceText([rehearsalExampleV2("EMA")],"EMA"));
  f.change("report-review-text",report);f.field("report-review-paste").click();
  for(let i=0;i<100&&f.field("report-review-status").getAttribute("aria-busy")==="true";i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal(f.field("report-review-save").disabled,false);assert.equal(f.field("undo").disabled,false);
  assert.equal(f.field("workspace-apply").disabled,false);assert.deepEqual(savedWorkspace(f),before);
  f.field("workspace-cancel").click();f.field("undo").click();assert.equal(f.field("rows").children.length,2);
});

test("scenario panel remains disabled until there is a displayed source",()=>{
  const f=setup(); for(const id of ["compare","reset","save","input-save","openingBalance"])
    assert.equal(f.field("whatif-"+id).disabled,true,id);
  assert.match(f.field("whatif-status").textContent,/先に例を表示/);
});
test("scenario panel copies recorded conditions and context without replacing the ledger",()=>{
  const f=setup(); f.field("example").click(); const before=savedWorkspace(f);
  assert.equal(f.field("whatif-openingBalance").value,"1000"); assert.equal(f.field("whatif-buybackBps").value,"10");
  assert.match(f.field("whatif-context").textContent,/0x1111111111111111111111111111111111111111/);
  f.field("whatif-compare").click(); assert.equal(f.field("whatif-metrics").children.length,9);
  assert.match(f.field("whatif-summary").textContent,/変更した条件 0項目/);
  assert.deepEqual(savedWorkspace(f),before);
});
test("hypothetical limits show cascading rejections and preserve existing reservations and undo",()=>{
  const f=setup(); f.field("example").click(); prepareAppend(f,"reserve"); f.field("append-confirm").click();
  const before=savedWorkspace(f); f.change("whatif-maxPerOperation","50"); f.field("whatif-compare").click();
  assert.match(f.field("whatif-summary").textContent,/新たな見送り 3件/);
  assert.match(renderedText(f.field("whatif-rows")),/対応する未決済記録がない/);
  assert.equal(f.field("undo").disabled,false); assert.deepEqual(savedWorkspace(f),before);
  assert.equal(f.field("metrics").children[0].children[1].textContent,"1028 SIM");
});
test("editing a hypothetical condition revokes its results and both downloads immediately",()=>{
  const f=setup(); f.field("example").click(); f.field("whatif-compare").click();
  f.change("whatif-reserveFloor","300"); assert.equal(f.field("whatif-results").hidden,true);
  assert.equal(f.field("whatif-rows").children.length,0); assert.equal(f.field("whatif-save").disabled,true);
  assert.equal(f.field("whatif-input-save").disabled,true); assert.equal(f.field("save").disabled,false);
  const count=f.downloads.length; f.field("whatif-save").click(); assert.equal(f.downloads.length,count);
});
test("changed-only record filter includes accounting changes and exports the complete replay",()=>{
  const f=setup(); f.field("example").click(); f.change("whatif-openingBalance","1001"); f.field("whatif-compare").click();
  f.field("whatif-filter").value="changed"; f.field("whatif-filter").dispatchEvent(new Event("change"));
  assert.equal(f.field("whatif-rows").children.length,2); assert.match(renderedText(f.field("whatif-rows")),/手元資金/);
  f.field("whatif-reset").click(); f.field("whatif-compare").click(); assert.equal(f.field("whatif-rows").children.length,0);
  f.field("whatif-save").click(); const report=JSON.parse(f.downloads.at(-1).text); assert.equal(report.rows.length,2);
  assert.match(f.field("whatif-row-status").textContent,/表示 0件 \/ 全 2件/);
});
test("comparison and separate candidate input exports agree and never change source",()=>{
  const f=setup(); f.field("example").click(); const before=savedWorkspace(f);
  f.change("whatif-buybackBps","5.25"); f.field("whatif-compare").click(); f.field("whatif-save").click();
  const reportFile=f.downloads.at(-1), report=JSON.parse(reportFile.text);
  assert.equal(reportFile.filename,"ThreeCore-DAT-scenario-comparison.json");
  assert.equal(reportFile.text,encodeRehearsalScenario(report.inputs.before,report.inputs.after));
  f.field("whatif-input-save").click(); const inputFile=f.downloads.at(-1);
  assert.equal(inputFile.filename,"ThreeCore-DAT-hypothetical-input.json");
  assert.deepEqual(decodeRehearsal(inputFile.text),report.inputs.after);
  assert.equal(report.inputs.after.policy.buybackBps,525); assert.deepEqual(savedWorkspace(f),before);
});
for(const value of ["-1","0.0000001","1e2",""]) test("scenario amount rejects "+JSON.stringify(value)+" without discarding source",()=>{
  const f=setup(); f.field("example").click(); f.change("whatif-openingBalance",value); f.field("whatif-compare").click();
  assert.match(f.field("whatif-status").textContent,/開始時の資金.*0以上/); assert.equal(f.field("whatif-save").disabled,true);
  assert.equal(f.field("whatif-openingBalance").getAttribute("aria-invalid"),"true");
  assert.equal(f.field("rows").children.length,2); assert.equal(f.field("save").disabled,false);
});
test("percentage bounds and pause are checked independently of the source policy",()=>{
  const f=setup(); f.field("example").click(); f.change("whatif-buybackBps","100.01"); f.field("whatif-compare").click();
  assert.equal(f.field("whatif-save").disabled,true); f.field("whatif-reset").click();
  f.field("whatif-paused").checked=true; f.field("whatif-paused").dispatchEvent(new Event("change"));
  f.field("whatif-compare").click(); assert.match(renderedText(f.field("whatif-rows")),/新規利用の停止中/);
  assert.equal(f.field("paused").checked,false);
});
test("reset restores recorded parameters and clears only comparison results",()=>{
  const f=setup(); f.field("example").click(); f.change("whatif-openingBalance","1"); f.field("whatif-compare").click();
  f.field("whatif-reset").click(); assert.equal(f.field("whatif-openingBalance").value,"1000");
  assert.equal(f.field("whatif-results").hidden,true); assert.equal(f.field("rows").children.length,2);
});
test("switching targets and clearing revokes hypothetical exports",()=>{
  const f=setup(); f.field("example").click(); f.field("whatif-compare").click(); selectAgent(f,"EMA");
  assert.equal(f.field("whatif-compare").disabled,true); assert.equal(f.field("whatif-save").disabled,true);
  f.field("example").click(); assert.match(f.field("whatif-context").textContent,/EMA/);
  f.field("whatif-compare").click(); f.field("cancel").click(); assert.equal(f.field("whatif-context").textContent,"");
});
test("restore previews keep the current scenario source; applying replaces it",()=>{
  const f=setup(); f.field("example").click(); f.field("whatif-compare").click();
  pasteWorkspace(f,workspaceText([rehearsalExampleV2("EMA","loss")],"EMA"));
  f.field("whatif-save").click(); assert.equal(JSON.parse(f.downloads.at(-1).text).inputs.before.agent,"DAT");
  assert.equal(f.field("workspace-apply").disabled,false); f.field("workspace-apply").click();
  assert.equal(f.field("whatif-save").disabled,true); assert.match(f.field("whatif-context").textContent,/EMA/);
});
test("confirmed append and undo refresh source while a pending append does not",()=>{
  const f=setup(); f.field("example").click(); f.field("whatif-compare").click(); prepareAppend(f,"reserve");
  assert.equal(f.field("whatif-save").disabled,false); f.field("append-confirm").click();
  assert.equal(f.field("whatif-save").disabled,true); assert.match(f.field("whatif-context").textContent,/3件の同じ記録/);
  f.field("whatif-compare").click(); f.field("undo").click();
  assert.equal(f.field("whatif-save").disabled,true); assert.match(f.field("whatif-context").textContent,/2件の同じ記録/);
});
test("old-format scenario has disabled fee caps and preserves the old schema in candidate export",()=>{
  const f=setup(); pasteWorkspace(f,workspaceText([rehearsalExample()])); f.field("workspace-apply").click();
  assert.equal(f.field("whatif-maxEntryFee").disabled,true); assert.equal(f.field("whatif-maxExitFee").value,"");
  assert.match(f.field("whatif-version").textContent,/旧形式/); f.field("whatif-compare").click(); f.field("whatif-input-save").click();
  assert.equal(decodeRehearsal(f.downloads.at(-1).text).schema,rehearsalExample().schema);
});
test("disposing clears scenario source, results and download handlers",()=>{
  const f=setup(); f.field("example").click(); f.field("whatif-compare").click(); f.page.dispose();
  assert.equal(f.field("whatif-context").textContent,""); assert.equal(f.field("whatif-metrics").children.length,0);
  assert.equal(f.field("whatif-compare").disabled,true); const count=f.downloads.length;
  f.field("whatif-input-save").click(); assert.equal(f.downloads.length,count);
});

const overviewFilter = (f, id, value) => { f.field(id).value = value; f.field(id).dispatchEvent(new Event("change")); };
test("overview starts explicitly uncreated and disabled, not as a zero balance or successful check", () => {
  const f=setup(); assert.match(f.field("overview-status").textContent,/未作成/);
  assert.equal(f.field("overview-save").disabled,true); assert.equal(f.field("overview-cards").children.length,3);
  assert.equal(f.field("overview-rows").children.length,0);
});
test("overview filters missing, present-empty and populated subjects separately", () => {
  const f=setup(); pasteWorkspace(f,workspaceText([rehearsalExampleV2("DAT","pending"),rehearsalExampleV2("EMA","loss")]));
  f.field("workspace-apply").click(); assert.equal(f.field("overview-rows").children.length,1);
  overviewFilter(f,"overview-agent","CAWELON"); assert.match(f.field("overview-status").textContent,/未作成/);
  overviewFilter(f,"overview-agent","EMA"); assert.match(f.field("overview-status").textContent,/該当する記録は0件/);
  overviewFilter(f,"overview-agent","DAT"); assert.equal(f.field("overview-rows").children.length,1);
  overviewFilter(f,"overview-kind","rejected"); assert.equal(f.field("overview-rows").children.length,0);
  assert.equal(f.field("agent").value,"DAT"); assert.equal(f.field("rows").children.length,1);
});
test("unconfirmed append and restore never enter the overview; filtering preserves both reviews", () => {
  const f=setup(); f.field("example").click(); prepareAppend(f,"reserve");
  overviewFilter(f,"overview-kind","reservation"); assert.equal(f.field("overview-rows").children.length,0);
  assert.equal(f.field("append-confirm").disabled,false); f.field("append-confirm").click();
  assert.equal(f.field("overview-rows").children.length,1);
  pasteWorkspace(f,workspaceText([rehearsalExampleV2("CAWELON","pending")],"CAWELON"));
  overviewFilter(f,"overview-agent","all"); assert.equal(f.field("workspace-apply").disabled,false);
  assert.equal(f.field("overview-rows").children[0].children[0].textContent,"DAT");
  f.field("workspace-cancel").click(); assert.equal(f.field("overview-rows").children.length,1);
});
test("overview updates after confirm, undo, and clearing one target", () => {
  const f=setup(); f.field("example").click(); prepareAppend(f,"reserve"); f.field("append-confirm").click();
  assert.match(renderedText(f.field("overview-rows")),/予約額 2.8 SIM/);
  f.field("undo").click(); assert.equal(f.field("overview-rows").children.length,0);
  selectAgent(f,"CAWELON"); f.field("scenario").value="pending"; f.field("example").click();
  assert.match(renderedText(f.field("overview-rows")),/元本 100 SIM/);
  selectAgent(f,"DAT"); f.field("cancel").click();
  assert.equal(f.field("overview-rows").children[0].children[0].textContent,"CAWELON");
  assert.match(renderedText(f.field("overview-cards").children[0]),/未作成/);
});
test("overview rejected rows expose reason and source identity without crediting the requested amount", () => {
  const f=setup(); f.field("scenario").value="limit"; f.field("example").click();
  const text=renderedText(f.field("overview-rows")); assert.match(text,/1回の上限超過/);
  assert.match(text,/計上なし/); assert.match(text,/1番目: open-one/);
  assert.match(text,/記録の対象 DAT/); assert.match(text,/ネットワーク 84532/);
  assert.match(renderedText(f.field("overview-cards")),/0x4444444444444444444444444444444444444444/);
});
test("overview export includes all records even under an empty filter, and ignores pending replacement", () => {
  const f=setup(); pasteWorkspace(f,workspaceText([rehearsalExampleV2("DAT","pending"),rehearsalExampleV2("EMA","limit")]));
  f.field("workspace-apply").click(); const before=savedWorkspace(f);
  overviewFilter(f,"overview-agent","CAWELON"); pasteWorkspace(f,workspaceText([rehearsalExampleV2()]));
  f.field("overview-save").click(); const file=f.downloads.at(-1);
  assert.equal(file.filename,"ThreeCore-workspace-overview.json"); assert.equal(file.text,encodeRehearsalOverview(before));
  assert.equal(f.field("workspace-apply").disabled,false); assert.match(f.field("overview-save-status").textContent,/全件/);
});
test("applied replacement refreshes overview while disposal removes its data and export handler", () => {
  const f=setup(); f.field("example").click(); pasteWorkspace(f,workspaceText([rehearsalExampleV2("CAWELON","pending")]));
  f.field("workspace-apply").click(); assert.equal(f.field("overview-rows").children[0].children[0].textContent,"CAWELON");
  f.page.dispose(); assert.equal(f.field("overview-rows").children.length,0);
  assert.equal(f.field("overview-cards").children.length,0); assert.equal(f.field("overview-save").disabled,true);
  const count=f.downloads.length; f.field("overview-save").click(); assert.equal(f.downloads.length,count);
});

test("review exposes changed identities, assets, destinations, policy and event contents without applying", () => {
  const f=setup(); f.field("example").click();
  const changed=JSON.parse(encodeRehearsal(rehearsalExampleV2()));
  changed.chainId=8453; changed.account="0x"+"9".repeat(40); changed.asset.address="0x"+"8".repeat(40);
  changed.policy.origin="https://other.example"; changed.policy.spender="0x"+"7".repeat(40); changed.policy.maxPerOperation="90000000";
  changed.events[1].grossReturn="120000000";
  pasteWorkspace(f,workspaceText([changed]));
  const text=renderedText(f.field("workspace-details"));
  for (const value of ["8453",changed.account,changed.asset.address,changed.policy.origin,changed.policy.spender,"90 SIM","同じIDの内容変更 1件","条件外の記録 2件","変わる項目","合算・差し引きしていません"])
    assert.ok(text.includes(value),value);
  assert.equal(f.field("metrics").children[0].children[1].textContent,"1028 SIM");
  assert.equal(f.field("workspace-review-save").disabled,false);
});
test("comparison download is reproducible and never applies a pending review", () => {
  const f=setup(); f.field("example").click(); const before=savedWorkspace(f);
  const after=JSON.parse(workspaceText([rehearsalExampleV2("EMA","loss")],"EMA"));
  pasteWorkspace(f,JSON.stringify(after)); f.field("workspace-review-save").click();
  const file=f.downloads.at(-1); assert.equal(file.filename,"ThreeCore-workspace-comparison.json");
  assert.equal(file.text,encodeRehearsalComparison(before,after));
  assert.equal(f.field("agent").value,"DAT"); assert.equal(f.field("workspace-apply").disabled,false);
  assert.match(f.field("workspace-review-status").textContent,/まだ反映していません/);
});
for (const action of ["cancel","switch","edit","apply","invalid","dispose"]) test(action+" revokes comparison detail and its export",()=>{
  const f=setup(); f.field("example").click(); pasteWorkspace(f,workspaceText([rehearsalExampleV2()]));
  if(action==="cancel") f.field("workspace-cancel").click();
  if(action==="switch") selectAgent(f,"EMA");
  if(action==="edit") f.change("append-reference","changed");
  if(action==="apply") f.field("workspace-apply").click();
  if(action==="invalid") pasteWorkspace(f,"{");
  if(action==="dispose") f.page.dispose();
  assert.equal(f.field("workspace-details").children.length,0); assert.equal(f.field("workspace-review-save").disabled,true);
  const count=f.downloads.length; f.field("workspace-review-save").click(); assert.equal(f.downloads.length,count);
});
test("unchanged data is labeled separately from replacement and selection-only changes",()=>{
  const f=setup(); f.field("example").click();
  pasteWorkspace(f,workspaceText([rehearsalExampleV2()],"EMA"));
  assert.equal(f.field("workspace-changes").children[0].children[3].textContent,"内容は同じ");
  assert.match(renderedText(f.field("workspace-details")),/DAT → EMA/);
});
test("old-version missing fee caps remain explicit, with no assumed values in the comparison",()=>{
  const f=setup(); pasteWorkspace(f,workspaceText([rehearsalExample()])); f.field("workspace-apply").click();
  pasteWorkspace(f,workspaceText([rehearsalExampleV2()]));
  const text=renderedText(f.field("workspace-details")); assert.match(text,/この形式には項目なし/);
  assert.match(text,/3 SIM/); assert.match(text,/記録の形式/);
});

test("a selected filename and next action survive native input clearing without hiding applied results", async () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve"); f.field("append-confirm").click();
  let resolve;
  workspaceFile(f, [rehearsalExampleV2("EMA", "loss")], "EMA", { name: "saved-workspace.json", text: () => new Promise(done => { resolve = done; }) }); await tick();
  assert.equal(f.field("workspace-file").value, "");
  assert.match(f.field("workspace-source").textContent, /saved-workspace.json/);
  assert.match(f.field("workspace-stage").textContent, /確認中/);
  assert.equal(f.field("workspace-file").getAttribute("aria-busy"), "true");
  assert.equal(f.field("rows").children.length, 3); assert.equal(f.field("save").disabled, false);
  assert.equal(f.field("undo").disabled, false);
  resolve(workspaceText([rehearsalExampleV2("EMA", "loss")], "EMA")); await tick();
  assert.match(f.field("workspace-stage").textContent, /選択できています/);
  assert.equal(f.field("workspace-file").getAttribute("aria-busy"), "false");
  assert.equal(f.field("rows").children.length, 3);
  assert.match(f.field("workspace-source").textContent, /saved-workspace.json/);
  const rows = f.field("workspace-changes").children.map(row => row.children.map(cell => cell.textContent));
  assert.deepEqual(rows, [["DAT", "3件", "未作成", "履歴を消去する"], ["EMA", "未作成", "2件", "復旧する"],
    ["CAWELON", "未作成", "未作成", "未作成のまま"]]);
  assert.equal(f.field("workspace-comparison").hidden, false);
});

test("file chooser cancellation or no selection preserves the prior review and current records", async () => {
  const f = setup(); f.field("example").click();
  workspaceFile(f, [rehearsalExampleV2("EMA")], "EMA", { name: "original.json" }); await tick();
  f.field("workspace-file").dispatchEvent(new Event("cancel"));
  f.field("workspace-file").files = []; f.field("workspace-file").dispatchEvent(new Event("change"));
  assert.match(f.field("workspace-file-note").textContent, /変更していません/);
  assert.match(f.field("workspace-source").textContent, /original.json/);
  assert.equal(f.field("rows").children.length, 2);
  assert.equal(f.field("workspace-apply").disabled, false);
  f.field("workspace-apply").click(); assert.equal(f.field("agent").value, "EMA");
});

test("successful restoration has a receipt naming the source and each restored count", async () => {
  const f = setup();
  workspaceFile(f, [rehearsalExampleV2("DAT"), rehearsalExampleV2("CAWELON", "pending")], "DAT", { name: "backup.json" });
  await tick(); f.field("workspace-apply").click();
  assert.match(f.field("workspace-stage").textContent, /3 \/ 3/);
  assert.match(f.field("workspace-receipt").textContent, /backup.json — DAT: 2件 \/ EMA: 未作成 \/ CAWELON: 1件/);
  assert.equal(f.field("workspace-comparison").hidden, true);
  assert.equal(f.field("workspace-changes").children.length, 0);
  assert.equal(f.field("workspace-apply").disabled, true);
  f.change("append-reference", "next");
  assert.doesNotMatch(f.field("workspace-stage").textContent, /復旧が完了/);
  assert.match(f.field("workspace-receipt").textContent, /直前の復旧/);
});

test("zero-record ledgers are distinct from missing ledgers in the replacement preview", async () => {
  const f = setup(); f.field("example").click();
  const empty = { ...rehearsalExampleV2("DAT"), events: [] };
  workspaceFile(f, [empty]); await tick();
  assert.deepEqual(f.field("workspace-changes").children[0].children.map(x => x.textContent),
    ["DAT", "2件", "0件", "置き換える"]);
  f.field("workspace-apply").click(); assert.equal(savedWorkspace(f).ledgers.length, 1);
});

test("filenames are bounded plain text with directional and control characters removed", async () => {
  const f = setup();
  workspaceFile(f, [], "DAT", { name: "<script>\u202e\n" + "x".repeat(300) }); await tick();
  const source = f.field("workspace-source");
  assert.equal(source.children.length, 0); assert.match(source.textContent, /<script>/);
  assert.doesNotMatch(source.textContent, /[\u202e\n]/); assert.ok(source.textContent.length < 180);
});

test("pasted workspace is reviewed, bounded, cleared and applied once using the same replacement rules", () => {
  const f = setup(); f.field("example").click();
  const text = workspaceText([rehearsalExampleV2("EMA", "loss")], "EMA");
  pasteWorkspace(f, text);
  assert.equal(f.field("workspace-text").value, "");
  assert.match(f.field("workspace-source").textContent, /貼り付けた一括記録/);
  assert.equal(savedWorkspace(f).activeAgent, "DAT");
  f.field("workspace-apply").click(); f.field("workspace-apply").click();
  assert.equal(encodeRehearsalWorkspace(savedWorkspace(f)), text);
  assert.equal(f.field("undo").disabled, true);
});

for (const [name, text, message] of [
  ["empty", " \n ", /空です/],
  ["malformed", "{", /JSONの内容/],
  ["duplicate-agent", JSON.stringify({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true,
    activeAgent: "DAT", ledgers: [rehearsalExampleV2(), rehearsalExampleV2()] }), /重複/],
  ["duplicate-key", '{"schema":"a","schema":"b"}', /JSONの内容/],
  ["oversized", " ".repeat(REHEARSAL_WORKSPACE_LIMIT) + "{}", /大きすぎ/],
  ["multibyte-oversized", JSON.stringify({ padding: "あ".repeat(175000) }), /大きすぎ/],
  ["single-ledger", encodeRehearsal(rehearsalExampleV2()), /記録を保存・再確認/],
  ["foreign-asset", workspaceText([{ ...rehearsalExampleV2(), asset: { ...rehearsalExampleV2().asset, symbol: "OTHER" } }]), /練習用SIM/],
]) test(name + " pasted input explains failure and preserves applied records and undo", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve"); f.field("append-confirm").click();
  const before = encodeRehearsalWorkspace(savedWorkspace(f));
  pasteWorkspace(f, text); assert.match(f.field("workspace-status").textContent, message);
  assert.equal(f.field("rows").children.length, 3); assert.equal(f.field("undo").disabled, false);
  assert.equal(f.field("workspace-apply").disabled, true);
  assert.equal(f.field("workspace-comparison").hidden, true);
  assert.equal(f.field("workspace-source").textContent, "");
  assert.equal(encodeRehearsalWorkspace(savedWorkspace(f)), before);
});

test("a file read error preserves the displayed ledger and its exports", async () => {
  const f = setup(); f.field("example").click();
  workspaceFile(f, [], "DAT", { text: async () => { throw new Error("read failed"); } }); await tick();
  assert.equal(f.field("rows").children.length, 2); assert.equal(f.field("save").disabled, false);
  assert.match(f.field("workspace-stage").textContent, /変更していません/);
});

test("an older file cannot replace a newer pasted review or its source label", async () => {
  const f = setup(); let resolve;
  workspaceFile(f, [], "DAT", { name: "old.json", text: () => new Promise(done => { resolve = done; }) }); await tick();
  pasteWorkspace(f, workspaceText([rehearsalExampleV2("CAWELON")], "CAWELON"));
  resolve(workspaceText([])); await tick();
  assert.match(f.field("workspace-source").textContent, /貼り付けた/);
  f.field("workspace-apply").click(); assert.equal(savedWorkspace(f).activeAgent, "CAWELON");
});

test("an older file rejection cannot overwrite a newer completed restore", async () => {
  const f = setup(); let reject;
  workspaceFile(f, [], "DAT", { text: () => new Promise((_, fail) => { reject = fail; }) }); await tick();
  pasteWorkspace(f, workspaceText([rehearsalExampleV2("EMA")], "EMA")); f.field("workspace-apply").click();
  reject(new Error("late failure")); await tick();
  assert.match(f.field("workspace-stage").textContent, /3 \/ 3/); assert.equal(f.field("agent").value, "EMA");
});

test("editing pasted input cancels both workspace and single-ledger pending reviews", async () => {
  const f = setup(); f.file(encodeRehearsal(rehearsalExample())); await tick();
  f.change("workspace-text", "{"); assert.equal(f.field("apply").disabled, true);
  pasteWorkspace(f, workspaceText([rehearsalExampleV2()]));
  f.change("workspace-text", "changed"); assert.equal(f.field("workspace-apply").disabled, true);
  assert.equal(f.field("workspace-changes").children.length, 0);
  assert.equal(f.field("workspace-source").textContent, "");
});

test("cancel and dispose clear pasted text and file names without retaining import content", () => {
  const f = setup(); f.field("example").click(); f.change("workspace-text", "draft");
  f.field("workspace-cancel").click(); assert.equal(f.field("workspace-text").value, "");
  assert.equal(f.field("rows").children.length, 2);
  pasteWorkspace(f, workspaceText([rehearsalExampleV2()])); f.field("workspace-apply").click();
  f.change("workspace-text", "private draft"); f.page.dispose();
  for (const id of ["workspace-receipt", "workspace-source", "workspace-stage"])
    assert.equal(f.field(id).textContent, "");
  assert.equal(f.field("workspace-text").value, "");
});

test("workspace overview labels missing agents and disables an empty export", () => {
  const f = setup(); assert.equal(f.field("workspace-save").disabled, true);
  assert.equal(f.field("workspace-rows").children.length, 3);
  assert.equal(f.field("workspace-rows").children[1].children[1].textContent, "未作成");
  f.field("example").click(); assert.equal(f.field("workspace-save").disabled, false);
});
test("three-agent switching preserves records, allocation and agent-specific undo", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve"); f.field("append-confirm").click();
  selectAgent(f, "EMA"); f.field("scenario").value = "loss"; f.field("example").click();
  selectAgent(f, "CAWELON"); f.field("scenario").value = "pending"; f.field("example").click();
  selectAgent(f, "DAT"); assert.equal(f.field("rows").children.length, 3);
  assert.equal(f.field("metrics").children[5].children[1].textContent, "2.8 SIM");
  f.field("undo").click(); assert.equal(f.field("rows").children.length, 2);
  selectAgent(f, "EMA"); assert.equal(f.field("metrics").children[2].children[1].textContent, "-42 SIM");
  assert.equal(f.field("undo").disabled, true);
  const saved = savedWorkspace(f); assert.equal(saved.ledgers.length, 3); assert.equal(saved.activeAgent, "EMA");
});
test("editing one agent retains its prior committed input alongside the other saved agents", () => {
  const f = setup(); f.field("example").click(); selectAgent(f, "EMA"); f.field("example").click();
  f.change("opening", "900"); const data = savedWorkspace(f);
  assert.deepEqual(data.ledgers.map(x => x.agent), ["DAT","EMA"]); assert.equal(data.activeAgent, "EMA");
  assert.equal(data.ledgers.find(x=>x.agent==="EMA").openingBalance,"1000000000");
  assert.equal(f.field("form-restore").disabled,false);
  selectAgent(f, "DAT"); assert.equal(f.field("save").disabled, false);
});
test("single-agent import never discards another agent's applied ledger", async () => {
  const f = setup(); f.field("example").click();
  f.file(encodeRehearsal(rehearsalExampleV2("EMA", "loss"))); await tick(); f.field("apply").click();
  const data = savedWorkspace(f); assert.deepEqual(data.ledgers.map(x => x.agent), ["DAT", "EMA"]);
  assert.equal(data.activeAgent, "EMA");
});
test("workspace review leaves the old export intact; cancel restores its displayed result", async () => {
  const f = setup(); f.field("example").click(); const before = encodeRehearsalWorkspace(savedWorkspace(f));
  workspaceFile(f, [rehearsalExampleV2("EMA", "loss")], "EMA"); await tick();
  assert.equal(f.field("workspace-apply").disabled, false);
  assert.match(f.field("workspace-preview").textContent, /DAT: 未作成に戻す/);
  assert.match(f.field("workspace-preview").textContent, /まだ反映していません/);
  assert.equal(encodeRehearsalWorkspace(savedWorkspace(f)), before);
  f.field("workspace-cancel").click(); f.field("workspace-apply").click();
  assert.equal(f.field("agent").value, "DAT"); assert.equal(f.field("rows").children.length, 2);
  assert.equal(encodeRehearsalWorkspace(savedWorkspace(f)), before);
});
test("confirmed workspace replaces all three histories exactly once, clearing undo", async () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve"); f.field("append-confirm").click();
  workspaceFile(f, [rehearsalExample("DAT"), rehearsalExampleV2("EMA", "loss"), rehearsalExampleV2("CAWELON", "pending")], "EMA");
  await tick(); f.field("workspace-apply").click(); f.field("workspace-apply").click();
  assert.equal(f.field("agent").value, "EMA"); assert.equal(f.field("undo").disabled, true);
  assert.equal(f.field("metrics").children[2].children[1].textContent, "-42 SIM");
  selectAgent(f, "DAT"); assert.equal(f.field("append-preview").disabled, true);
  assert.equal(f.field("undo").disabled, true); assert.equal(savedWorkspace(f).ledgers.length, 3);
});
test("workspace with one unsupported asset is rejected without replacing any current history", async () => {
  const f = setup(); f.field("example").click();
  const wrong = { ...rehearsalExampleV2("EMA"), asset: { ...rehearsalExampleV2().asset, decimals: 18 } };
  workspaceFile(f, [rehearsalExampleV2("CAWELON"), wrong]); await tick();
  assert.equal(f.field("workspace-apply").disabled, true);
  assert.deepEqual(savedWorkspace(f).ledgers.map(x => x.agent), ["DAT"]);
});
for (const action of ["cancel", "switch", "edit", "dispose"]) test(action + " prevents a late workspace read from reviving a review", async () => {
  const f = setup(); f.field("example").click(); let resolve;
  workspaceFile(f, [rehearsalExampleV2("EMA")], "EMA", { text: () => new Promise(done => { resolve = done; }) }); await tick();
  if (action === "cancel") f.field("workspace-cancel").click();
  else if (action === "switch") selectAgent(f, "CAWELON");
  else if (action === "edit") f.change("append-reference", "changed");
  else f.page.dispose();
  resolve(encodeRehearsalWorkspace({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent: "EMA", ledgers: [rehearsalExampleV2("EMA")] }));
  await tick(); assert.equal(f.field("workspace-apply").disabled, true);
  assert.equal(f.field("workspace-preview").textContent, "");
  if (action === "dispose") assert.equal(f.field("workspace-rows").children.length, 0);
});
test("a newer workspace file wins over a late older read", async () => {
  const f = setup(); f.field("example").click(); let resolve;
  workspaceFile(f, [], "DAT", { text: () => new Promise(done => { resolve = done; }) }); await tick();
  workspaceFile(f, [rehearsalExampleV2("CAWELON")], "CAWELON"); await tick();
  resolve(encodeRehearsalWorkspace({ schema: REHEARSAL_WORKSPACE_SCHEMA, simulationOnly: true, activeAgent: "DAT", ledgers: [] }));
  await tick(); f.field("workspace-apply").click();
  assert.equal(f.field("agent").value, "CAWELON"); assert.equal(savedWorkspace(f).ledgers[0].agent, "CAWELON");
});
test("oversized workspace is not read and an empty restore requires explicit confirmation", async () => {
  const f = setup(); f.field("example").click(); let called = false;
  workspaceFile(f, [], "DAT", { size: REHEARSAL_WORKSPACE_LIMIT + 1, text: async () => { called = true; return ""; } });
  await tick(); assert.equal(called, false); assert.equal(savedWorkspace(f).ledgers.length, 1);
  workspaceFile(f, [], "CAWELON"); await tick(); assert.equal(savedWorkspace(f).ledgers.length, 1);
  f.field("workspace-apply").click(); assert.equal(f.field("agent").value, "CAWELON");
  assert.equal(f.field("workspace-save").disabled, true); assert.equal(f.field("save").disabled, true);
});

test("append preview is explicit and cancellation never changes saved inputs", () => {
  const f = setup(); f.field("example").click();
  prepareAppend(f, "reserve");
  assert.equal(f.field("rows").children.length, 2); assert.equal(f.field("append-confirm").disabled, false);
  assert.match(f.field("append-summary").textContent, /まだ履歴には反映/);
  f.field("append-cancel").click(); f.field("append-confirm").click();
  f.field("save").click(); assert.equal(decodeRehearsal(f.downloads[0].text).events.length, 2);
});
test("append confirm reserves once; undo restores amount and cancels a newer preview", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve");
  f.field("append-confirm").click(); f.field("append-confirm").click();
  assert.equal(f.field("rows").children.length, 3);
  assert.equal(f.field("metrics").children[5].children[1].textContent, "2.8 SIM");
  assert.equal(f.field("undo").disabled, false);
  prepareAppend(f, "release"); f.field("undo").click();
  assert.equal(f.field("append-confirm").disabled, true);
  assert.equal(f.field("rows").children.length, 2);
  assert.equal(f.field("metrics").children[5].children[1].textContent, "0 SIM");
  assert.match(f.field("allocation-note").textContent, /2\.8 SIM/);
});
test("edited append fields revoke confirmation while retaining the applied ledger", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve");
  f.change("append-amount", "3"); assert.equal(f.field("append-confirm").disabled, true);
  assert.equal(f.field("save").disabled, false); assert.equal(f.field("rows").children.length, 2);
  f.field("append-confirm").click(); assert.equal(f.field("rows").children.length, 2);
});
test("a rejected reservation is explained before adding it; undo removes its blocker", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve", "3");
  assert.match(f.field("append-summary").textContent, /見送り/);
  f.field("append-confirm").click(); assert.match(f.field("allocation-note").textContent, /条件に合わない記録/);
  f.field("undo").click(); assert.match(f.field("allocation-note").textContent, /2\.8 SIM/);
});
test("CSV exports the applied ledger, never an unconfirmed preview", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve");
  f.field("csv-save").click(); assert.match(f.downloads[0].filename, /\.csv$/);
  assert.doesNotMatch(f.downloads[0].text, /"step-3"/);
  f.field("append-confirm").click(); f.field("csv-save").click();
  assert.match(f.downloads[1].text, /"step-3","reserve"/);
});
test("v1 import is preserved with append disabled instead of inventing fee limits", async () => {
  const f = setup(); f.file(encodeRehearsal(rehearsalExample())); await tick(); f.field("apply").click();
  assert.equal(f.field("append-preview").disabled, true); assert.match(f.field("ledger-details").textContent, /旧形式/);
  f.field("save").click(); assert.equal(decodeRehearsal(f.downloads[0].text).schema, "threecore.operation-rehearsal.v1");
});
test("switching agents and clearing revokes a ledger preview and undo", () => {
  const f = setup(); f.field("example").click(); prepareAppend(f, "reserve"); f.field("append-confirm").click();
  prepareAppend(f, "release"); f.field("agent").value = "EMA"; f.field("agent").dispatchEvent(new Event("change"));
  assert.equal(f.field("append-confirm").disabled, true); assert.equal(f.field("undo").disabled, true);
  f.field("example").click(); f.field("save").click(); assert.equal(decodeRehearsal(f.downloads[0].text).agent, "EMA");
  assert.equal(f.field("rows").children.length, 2);
});
test("pending fee reserve and settlement append use the original operation id", () => {
  const f = setup(); f.field("scenario").value = "pending"; f.field("example").click();
  assert.equal(f.field("metrics").children[4].children[1].textContent, "2 SIM");
  prepareAppend(f, "settle", "130", "one"); f.field("append-confirm").click();
  assert.equal(f.field("metrics").children[4].children[1].textContent, "0 SIM");
  assert.equal(f.field("metrics").children[2].children[1].textContent, "28 SIM");
});
test("explicit sample action is required; calculations never request a provider", () => {
  const f = setup();
  assert.equal(f.downloads.length, 0); assert.equal(f.field("save").disabled, true);
  f.field("example").click();
  assert.match(f.field("allocation-note").textContent, /2\.8 SIM/);
  assert.equal(f.field("rows").children.length, 2);
  assert.equal(f.field("save").disabled, false);
});
test("editing makes old results and exports unavailable until recalculated", () => {
  const f = setup(); f.field("example").click();
  f.change("principal", "150");
  assert.equal(f.field("metrics").children.length, 0);
  assert.equal(f.field("save").disabled, true);
  f.field("save").click(); assert.equal(f.downloads.length, 0);
  f.field("calculate").click();
  assert.match(f.field("status").textContent, /見送り/);
  assert.match(f.field("allocation-note").textContent, /0/);
});
test("save produces re-importable input, not a trusted result", () => {
  const f = setup(); f.field("example").click(); f.field("save").click();
  const saved = f.downloads[0];
  assert.equal(saved.filename, "ThreeCore-DAT-operation-rehearsal.json");
  const data = decodeRehearsal(saved.text);
  assert.equal(evaluateRehearsal(data).realizedPnl, "28000000");
  assert.equal(Object.hasOwn(data, "rows"), false);
});
test("import needs a distinct apply action and cannot apply twice", async () => {
  const f = setup(); f.file(encodeRehearsal(rehearsalExample("EMA", "loss")));
  await tick();
  assert.equal(f.field("save").disabled, true); assert.equal(f.field("apply").disabled, false);
  assert.match(f.field("preview").textContent, /EMA/);
  f.field("apply").click();
  assert.equal(f.field("agent").value, "EMA"); assert.equal(f.field("apply").disabled, true);
  assert.match(f.field("allocation-note").textContent, /利益なし/);
  assert.equal(f.field("metrics").children[2].children[1].textContent, "-42 SIM");
});
test("cancelled file read cannot restore a candidate or old report", async () => {
  const f = setup(); let resolve;
  f.file("x", { text: () => new Promise(done => { resolve = done; }) }); await tick();
  f.field("cancel").click();
  resolve(encodeRehearsal(rehearsalExample()));
  await tick();
  assert.equal(f.field("apply").disabled, true);
  assert.equal(f.field("save").disabled, true);
  assert.match(f.field("status").textContent, /クリア/);
});
test("a newer file wins even if an older read finishes later", async () => {
  const f = setup(); let resolve;
  f.file("x", { text: () => new Promise(done => { resolve = done; }) }); await tick();
  f.file(encodeRehearsal(rehearsalExample("CAWELON")));
  await tick(); resolve(encodeRehearsal(rehearsalExample("DAT"))); await tick();
  assert.match(f.field("preview").textContent, /CAWELON/);
  f.field("apply").click(); assert.equal(f.field("agent").value, "CAWELON");
});
test("changing an agent revokes an imported candidate", async () => {
  const f = setup(); f.file(encodeRehearsal(rehearsalExample()));
  await tick(); f.field("agent").value = "EMA"; f.field("agent").dispatchEvent(new Event("change"));
  assert.equal(f.field("apply").disabled, true); assert.equal(f.field("preview").textContent, "");
});
test("large files are refused before reading bytes", async () => {
  const f = setup(); let called = false;
  f.file("x", { size: REHEARSAL_LIMIT + 1, text: async () => { called = true; return ""; } });
  await tick(); assert.equal(called, false); assert.equal(f.field("apply").disabled, true);
});
test("foreign precision or asset cannot silently become editable SIM amounts", async () => {
  const f = setup(); const data = JSON.parse(encodeRehearsal(rehearsalExample()));
  data.asset.decimals = 18; f.file(encodeRehearsal(data)); await tick();
  assert.equal(f.field("apply").disabled, true); assert.match(f.field("status").textContent, /確認できません/);
});
test("unsupported percentages and excess monetary precision are refused", () => {
  const f = setup(); f.field("example").click(); f.change("allocation", "100.01");
  f.field("calculate").click(); assert.equal(f.field("save").disabled, true);
  f.field("example").click(); f.change("principal", "0.0000001");
  f.field("calculate").click(); assert.equal(f.field("save").disabled, true);
});
test("dispose prevents a pending file or stale handler from bringing back results", async () => {
  const f = setup(); let resolve;
  f.file("x", { text: () => new Promise(done => { resolve = done; }) }); await tick();
  f.page.dispose(); resolve(encodeRehearsal(rehearsalExample())); await tick();
  f.field("example").click();
  assert.equal(f.field("save").disabled, true);
  assert.equal(f.field("metrics").children.length, 0);
});
