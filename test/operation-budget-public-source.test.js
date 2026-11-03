import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { publicBatchFixture } from "./helpers/public-batch-fixture.js";
import { preparePublicTokenBatchFile } from "../src/public-token-batch-model.js";
import { mountOperationBudgetPage } from "../examples/operation-budget-page.js";
import { decodeOperationBudget } from "../src/operation-budget.js";
import { BUDGET_EVIDENCE_SCHEMA, inspectBudgetEvidence } from "../src/operation-budget-evidence.js";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw Error("TIMEOUT");await new Promise(resolve=>setTimeout(resolve,1));}}
function setup(options={}){
  const elements=new Map(),downloads=[],view=new EventTarget();
  const document={defaultView:view,createElement:tag=>new Element(tag),getElementById(id){if(!elements.has(id))elements.set(id,new Element("div"));return elements.get(id);}};
  const get=name=>document.getElementById("budget-"+name);
  const page=mountOperationBudgetPage(document,{...options,download:request=>downloads.push(request.prepared)});
  get("example").click();
  const choose=(text,extras={})=>{const bytes=new TextEncoder().encode(text);get("source-file").files=[{size:bytes.length,arrayBuffer:async()=>bytes.buffer,...extras}];get("source-file").dispatchEvent(new Event("change"));};
  return{get,page,downloads,choose,view};
}
for(const agent of ["DAT","EMA","CAWELON"])test(agent+" source preview changes nothing until apply; only exact balances/decimals change",async()=>{
  const f=setup(),batch=publicBatchFixture();f.get("agent").value=agent;
  batch.tokens.find(t=>t.agent===agent).balanceBaseUnits="123456789012345678901";batch.nativeBalanceBaseUnits="123456789012345";
  const source=(await preparePublicTokenBatchFile(batch)).text;
  const kept=["agent","chain","token-reserved","token-floor","token-spend","native-reserved","native-floor","native-value","gas","fee","l1","operator","buffer"];
  const before=kept.map(k=>f.get(k).value);f.choose(source);await until(()=>!f.get("source-apply").disabled);
  assert.equal(f.get("token-balance").value,"1000");assert.equal(f.get("source-rows").children.length,5);
  f.get("source-apply").click();assert.equal(f.get("token-balance").value,"123.456789012345678901");assert.equal(f.get("native-balance").value,"0.000123456789012345");
  assert.deepEqual(kept.map(k=>f.get(k).value),before);assert.equal(f.get("save").disabled,true);
  f.get("calculate").click();f.get("save").click();const saved=decodeOperationBudget(f.downloads[0].text);
  assert.equal(saved.token.balanceUnits,"123456789012345678901");assert.equal(saved.fees.operatorFeeBudgetWei,null);
  const evidence=await inspectBudgetEvidence({schema:BUDGET_EVIDENCE_SCHEMA,budgetFile:f.downloads[0].text,observationFiles:[source]});
  assert.equal(evidence.consistent,true);assert.equal(evidence.budgetResult.constraintsSatisfied,false);f.page.dispose();
});
test("wrong network, missing contract, mismatched token metadata, corrupt checksum and excessive size cannot replace input",async()=>{
  const f=setup(),valid=(await preparePublicTokenBatchFile(publicBatchFixture())).text;
  f.get("chain").value="8453";f.choose(valid);await until(()=>f.get("source-status").textContent.startsWith("残高を転記できません"));assert.equal(f.get("source-apply").disabled,true);f.get("chain").value="84532";
  const missing=publicBatchFixture();Object.assign(missing.tokens[0],{hasCode:false,metadata:null,balanceBaseUnits:null});
  const mismatch=publicBatchFixture();mismatch.tokens[0].metadata.symbol="FAKE";
  const corrupt=JSON.parse(valid);corrupt.batch.nativeBalanceBaseUnits="999";
  for(const text of [(await preparePublicTokenBatchFile(missing)).text,(await preparePublicTokenBatchFile(mismatch)).text,JSON.stringify(corrupt)," ".repeat(32769)]){
    f.choose(text);await until(()=>f.get("source-status").textContent.startsWith("残高を転記できません"));
    assert.equal(f.get("source-apply").disabled,true);assert.equal(f.get("token-balance").value,"1000");
  }f.page.dispose();
});
for(const action of ["cancel","edit","pagehide","dispose","regular-import"])test(action+" aborts source hashing and rejects its late result",async()=>{
  let release,signal;const f=setup({decodePublicSource:async(_text,options)=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});}});
  f.choose((await preparePublicTokenBatchFile(publicBatchFixture())).text);await until(()=>!!release);
  if(action==="cancel")f.get("source-cancel").click();else if(action==="edit")f.get("fee").dispatchEvent(new Event("input"));
  else if(action==="pagehide")f.view.dispatchEvent(new Event("pagehide"));else if(action==="dispose")f.page.dispose();
  else{f.get("file").files=[{size:1,arrayBuffer:async()=>new Uint8Array([123]).buffer}];f.get("file").dispatchEvent(new Event("change"));}
  assert.equal(signal.aborted,true);release({batch:publicBatchFixture()});await tick();assert.equal(f.get("source-apply").disabled,true);assert.equal(f.get("source-preview").hidden,true);f.page.dispose();
});
test("a context change without an input event still cannot apply a preview for the previous token",async()=>{
  const f=setup();f.choose((await preparePublicTokenBatchFile(publicBatchFixture())).text);await until(()=>!f.get("source-apply").disabled);
  f.get("agent").value="EMA";f.get("source-apply").click();assert.equal(f.get("source-apply").disabled,true);assert.equal(f.get("token-balance").value,"1000");assert.equal(f.get("source-preview").hidden,true);f.page.dispose();
});
