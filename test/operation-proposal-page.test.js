import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { proposalFixture } from "./helpers/proposal-fixtures.js";
import { encodeOperationProposal,encodeProposalReviewPolicy } from "../src/operation-proposal.js";
import { prepareOperationProposalReview,inspectOperationProposalReviewFile } from "../src/operation-proposal-file.js";
import { mountOperationProposalPage } from "../examples/operation-proposal-page.js";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){const end=Date.now()+3000;while(!fn()){if(Date.now()>end)throw Error("WAIT_TIMEOUT");await new Promise(resolve=>setTimeout(resolve,1));}}
const texts=f=>[encodeOperationProposal(f.proposal),encodeProposalReviewPolicy(f.policy),f.evidenceText];
function setup(options={}){
  const elements=new Map(),downloads=[],view=new EventTarget();const document={defaultView:view,createElement:tag=>new Element(tag),getElementById(id){if(!elements.has(id))elements.set(id,new Element("div"));return elements.get(id);}};
  const get=name=>document.getElementById("proposal-"+name);get("check").disabled=true;get("save").disabled=true;get("result").hidden=true;
  const panel=mountOperationProposalPage(document,{...options,download:request=>{if(options.download)return options.download(request,get);downloads.push(request.prepared);}});
  const choose=(values,extras=[])=>{get("file").files=values.map((text,i)=>{const bytes=new TextEncoder().encode(text);return{size:bytes.length,arrayBuffer:async()=>bytes.buffer,...extras[i]};});get("file").dispatchEvent(new Event("change"));};
  return{get,choose,panel,downloads,view};
}
test("page previews text without executing it, then saves and reloads exact sources with current-time recheck",async()=>{
  const f=await proposalFixture({nowSeconds:Math.floor(Date.now()/1000)}),ui=setup();
  f.proposal.rationale='<img src=x onerror="doSomething()">';const source=texts(f);ui.choose(source);
  await until(()=>!ui.get("check").disabled);assert.equal(ui.get("result").hidden,true);assert.equal(ui.get("save").disabled,true);
  assert.equal(ui.get("rationale").textContent,f.proposal.rationale);assert.equal(ui.get("rationale").children.length,0);
  ui.get("check").click();await until(()=>!ui.get("save").disabled);assert.match(ui.get("outcome").textContent,/一致しました/);
  ui.get("save").click();const saved=ui.downloads[0].text,checked=await inspectOperationProposalReviewFile(saved);
  assert.deepEqual(Object.values(checked.files),source);ui.choose([saved]);await until(()=>!ui.get("check").disabled);
  assert.match(ui.get("recorded").textContent,/保存時の結果を再計算/);assert.equal(ui.get("save").disabled,true);
  ui.get("check").click();await until(()=>!ui.get("save").disabled);assert.equal(ui.get("reasons").children.length,0);ui.panel.dispose();
});
test("historical pass is not retained as a current pass after expiry",async()=>{
  const nowSeconds=Math.floor(Date.now()/1000)-1000,f=await proposalFixture({nowSeconds}),source=texts(f);
  const saved=await prepareOperationProposalReview({proposalFile:source[0],policyFile:source[1],budgetEvidenceFile:source[2]},{nowSeconds});
  const ui=setup();ui.choose([saved.text]);await until(()=>!ui.get("check").disabled);assert.equal(ui.get("result").hidden,true);
  ui.get("check").click();await until(()=>!ui.get("save").disabled);
  assert.match(ui.get("outcome").textContent,/期限の問題/);assert(ui.get("reasons").children.some(row=>row.textContent.includes("提案の期限")));
  ui.get("save").click();assert.equal((await inspectOperationProposalReviewFile(ui.downloads[0].text)).recordedResult.checksSatisfied,false);ui.panel.dispose();
});
for(const action of ["cancel","new-file","pagehide","dispose"])test(action+" discards stale comparison and aborts work",async()=>{
  const f=await proposalFixture(),source=texts(f);let release,signal;
  const result=await prepareOperationProposalReview({proposalFile:source[0],policyFile:source[1],budgetEvidenceFile:source[2]},{nowSeconds:f.nowSeconds});
  const ui=setup({prepare:async(input,options)=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});}});
  ui.choose(source);await until(()=>!ui.get("check").disabled);ui.get("check").click();await tick();
  if(action==="cancel")ui.get("cancel").click();if(action==="pagehide")ui.view.dispatchEvent(new Event("pagehide"));if(action==="dispose")ui.panel.dispose();
  if(action==="new-file"){ui.choose(source);await until(()=>!ui.get("check").disabled);}
  assert.equal(signal.aborted,true);release(result);await tick();assert.equal(ui.get("result").hidden,true);assert.equal(ui.get("save").disabled,true);ui.panel.dispose();
});
test("wrong file count, duplicate types, changed evidence and changed saved verdict never retain old result",async()=>{
  const f=await proposalFixture({nowSeconds:Math.floor(Date.now()/1000)}),source=texts(f),ui=setup();
  for(const files of [[source[0],source[0],source[2]],[source[0],source[1]],['{']]){
    ui.choose(files);await until(()=>ui.get("status").textContent.startsWith("読み込めません"));assert.equal(ui.get("check").disabled,true);
  }
  ui.choose(source);await until(()=>!ui.get("check").disabled);ui.get("check").click();await until(()=>!ui.get("save").disabled);ui.get("save").click();
  const tampered=JSON.parse(ui.downloads[0].text);tampered.result.checksSatisfied=false;ui.choose([JSON.stringify(tampered)]);
  await until(()=>ui.get("status").textContent.startsWith("読み込めません"));assert.equal(ui.get("result").hidden,true);assert.equal(ui.get("save").disabled,true);
  ui.choose([source[0],source[1],source[2]+"\n"]);await until(()=>!ui.get("check").disabled);ui.get("check").click();
  await until(()=>ui.get("status").textContent.startsWith("照合できません"));assert.equal(ui.get("save").disabled,true);ui.panel.dispose();
});
test("cancelled reads and saved-record verification cannot repopulate the page",async()=>{
  const f=await proposalFixture(),source=texts(f);let release;
  const ui=setup();ui.choose(source,[{arrayBuffer:()=>new Promise(resolve=>{release=resolve;})}]);await tick();ui.get("cancel").click();release(new TextEncoder().encode(source[0]).buffer);await tick();assert.equal(ui.get("check").disabled,true);ui.panel.dispose();
  let finish,signal;const savedUI=setup({inspectSaved:async(text,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}});
  savedUI.choose(["{}"]);await until(()=>!!finish);savedUI.get("cancel").click();assert.equal(signal.aborted,true);finish({});await tick();assert.equal(savedUI.get("preview").hidden,true);assert.equal(savedUI.get("check").disabled,true);savedUI.panel.dispose();
});
test("failed or reentrant download does not lose result or report revoked export success",async()=>{
  const f=await proposalFixture({nowSeconds:Math.floor(Date.now()/1000)});
  for(const revoke of [false,true]){
    const ui=setup({download(request,get){if(revoke)get("cancel").click();else throw Error("disk");}});ui.choose(texts(f));await until(()=>!ui.get("check").disabled);ui.get("check").click();await until(()=>!ui.get("save").disabled);ui.get("save").click();
    assert.equal(ui.get("result").hidden,revoke);assert.equal(ui.get("save").disabled,revoke);if(revoke)assert.equal(ui.get("save-status").textContent,"");else assert.match(ui.get("save-status").textContent,/保持/);ui.panel.dispose();
  }
});
