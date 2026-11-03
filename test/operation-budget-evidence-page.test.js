import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { observation } from "./helpers/identity-fixtures.js";
import { prepareTokenIdentityFile } from "../src/token-identity-report.js";
import { operationBudgetExample, encodeOperationBudget } from "../src/operation-budget.js";
import { BUDGET_EVIDENCE_SCHEMA, inspectBudgetEvidence, encodeBudgetEvidence, decodeBudgetEvidence } from "../src/operation-budget-evidence.js";
import { mountBudgetEvidencePage } from "../examples/operation-budget-evidence-page.js";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(condition){const end=Date.now()+2000;while(!condition()){if(Date.now()>end)throw Error("WAIT_TIMEOUT");await new Promise(resolve=>setTimeout(resolve,1));}}
async function fixture(){const b=structuredClone(operationBudgetExample());b.fees.operatorFeeBudgetWei="0";
 return {schema:BUDGET_EVIDENCE_SCHEMA,budgetFile:encodeOperationBudget(b),observationFiles:[(await prepareTokenIdentityFile(observation({balanceBaseUnits:b.token.balanceUnits,nativeBalanceBaseUnits:b.native.balanceWei},"DAT",84532))).text]};}
function setup(options={}){
 const elements=new Map(),downloads=[],view=new EventTarget();const document={defaultView:view,createElement:tag=>new Element(tag),getElementById(id){if(!elements.has(id))elements.set(id,new Element("div"));return elements.get(id);}};
 const get=name=>document.getElementById("evidence-"+name);get("check").disabled=true;get("save").disabled=true;get("result").hidden=true;
 const panel=mountBudgetEvidencePage(document,{...options,download:request=>{if(options.download)return options.download(request,get);downloads.push(request.prepared);}});
 const choose=(texts,extras=[])=>{get("file").files=texts.map((text,i)=>{const bytes=new TextEncoder().encode(text);return {size:bytes.length,arrayBuffer:async()=>bytes.buffer,...extras[i]};});get("file").dispatchEvent(new Event("change"));};
 return {get,choose,panel,downloads,view};
}
test("selected original files are reviewed before hashing and preserve exact bytes through saved evidence",async()=>{
 const f=setup(),data=await fixture();f.choose([data.budgetFile,...data.observationFiles]);await until(()=>!f.get("check").disabled);
 assert.equal(f.get("result").hidden,true);f.get("check").click();await until(()=>!f.get("save").disabled);
 assert.match(f.get("outcome").textContent,/整合しています/);assert.match(f.get("budget").textContent,/足ります/);
 assert.match(f.get("rows").children[0].children[2].textContent,/Base Sepolia \/ 42/);
 f.get("save").click();assert.deepEqual(decodeBudgetEvidence(f.downloads[0].text),data);
 f.choose([f.downloads[0].text]);await until(()=>!f.get("check").disabled);assert.equal(f.get("result").hidden,true);
 f.get("check").click();await until(()=>!f.get("save").disabled);f.get("save").click();assert.equal(f.downloads[1].text,f.downloads[0].text);f.panel.dispose();
});
test("checksum failure clears old results and mismatched balances remain a visible non-pass",async()=>{
 const f=setup(),data=await fixture(),file=JSON.parse(data.observationFiles[0]);file.observation.balanceBaseUnits="1";
 data.observationFiles[0]=JSON.stringify(file);f.choose([encodeBudgetEvidence(data)]);await until(()=>!f.get("check").disabled);f.get("check").click();
 await until(()=>f.get("status").textContent.startsWith("照合できません"));assert.equal(f.get("save").disabled,true);
 data.observationFiles[0]=(await prepareTokenIdentityFile(file.observation)).text;
 f.choose([encodeBudgetEvidence(data)]);await until(()=>!f.get("check").disabled);f.get("check").click();await until(()=>!f.get("save").disabled);
 assert.match(f.get("outcome").textContent,/不一致/);assert.match(f.get("rows").children[0].children[3].textContent,/トークン残高が異なる/);f.panel.dispose();
});
for(const action of ["cancel","new-file","pagehide","dispose"])test(action+" revokes pending checksum work and discards late completion",async()=>{
 const data=await fixture(),result=await inspectBudgetEvidence(data);let release,signal;
 const f=setup({inspect:async(input,options)=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});}});
 f.choose([encodeBudgetEvidence(data)]);await until(()=>!f.get("check").disabled);f.get("check").click();await tick();
 if(action==="cancel")f.get("cancel").click();if(action==="pagehide")f.view.dispatchEvent(new Event("pagehide"));if(action==="dispose")f.panel.dispose();
 if(action==="new-file"){f.choose([encodeBudgetEvidence(data)]);await until(()=>!f.get("check").disabled);}
 assert.equal(signal.aborted,true);release(result);await tick();assert.equal(f.get("result").hidden,true);assert.equal(f.get("save").disabled,true);f.panel.dispose();
});
test("cancelled file read cannot later offer its old review",async()=>{
 const f=setup(),text=encodeBudgetEvidence(await fixture());let release;
 f.choose([text],[{arrayBuffer:()=>new Promise(resolve=>{release=resolve;})}]);await tick();f.get("cancel").click();release(new TextEncoder().encode(text).buffer);await tick();
 assert.equal(f.get("check").disabled,true);assert.equal(f.get("result").hidden,true);f.panel.dispose();
});
test("excess file count, duplicate budget files and malformed bytes are rejected",async()=>{
 const f=setup(),data=await fixture();for(const files of [Array(5).fill(data.budgetFile),[data.budgetFile,data.budgetFile],['{']]){
  f.choose(files);await until(()=>f.get("status").textContent.startsWith("読み込めません"));assert.equal(f.get("check").disabled,true);
 }f.panel.dispose();
});
test("reentrant export does not report a saved revoked result",async()=>{
 const f=setup({download(request,get){get("cancel").click();}});f.choose([encodeBudgetEvidence(await fixture())]);await until(()=>!f.get("check").disabled);f.get("check").click();await until(()=>!f.get("save").disabled);
 f.get("save").click();assert.equal(f.get("save-status").textContent,"");assert.equal(f.get("result").hidden,true);f.panel.dispose();
});
