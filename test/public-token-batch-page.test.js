import test from "node:test";
import assert from "node:assert/strict";
import { Element } from "./helpers/panel-dom.js";
import { publicBatchFixture } from "./helpers/public-batch-fixture.js";
import { decodePublicTokenBatchFile, preparePublicTokenBatchFile } from "../src/public-token-batch-model.js";
import { mountPublicTokenBatchPage } from "../examples/public-token-batch-page.js";
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){const end=Date.now()+2000;while(!check()){if(Date.now()>end)throw Error("TIMEOUT");await new Promise(resolve=>setTimeout(resolve,1));}}
function setup(options={}){
  const elements=new Map(),downloads=[],view=new EventTarget();let calls=0;
  const document={defaultView:view,createElement:tag=>new Element(tag),getElementById(id){if(!elements.has(id))elements.set(id,new Element("div"));return elements.get(id);}};
  const get=name=>document.getElementById("batch-"+name);get("account").value=publicBatchFixture().account;get("chain").value="84532";
  const page=mountPublicTokenBatchPage(document,{...options,read:async(...args)=>{calls++;return options.read?options.read(...args):publicBatchFixture();},
    download:req=>{if(options.download)return options.download(req,get);downloads.push(req.prepared);}});
  return{get,view,page,downloads,calls:()=>calls};
}
test("no automatic reads; explicit read shows all tokens and one native balance, save is independently decodable",async()=>{
  const f=setup();assert.equal(f.calls(),0);assert.equal(f.get("save").disabled,true);f.get("read").click();await until(()=>!f.get("save").disabled);
  assert.equal(f.calls(),1);assert.equal(f.get("rows").children.length,3);assert.equal(f.get("native").textContent,"この口座のETH：0.01 ETH");
  assert.equal(f.get("rows").children[0].children[2].textContent,"1000");assert.match(f.get("status").textContent,/取得と情報照合が完了/);
  f.get("save").click();const decoded=await decodePublicTokenBatchFile(f.downloads[0].text);assert.equal(decoded.batch.blockNumber,"42");assert.equal(decoded.walletConnected,false);f.page.dispose();
});
for(const action of ["cancel","account","chain","block","pagehide","dispose"])test(action+" cancels and prevents late network result from displaying/saving",async()=>{
  let release,signal;const f=setup({read:async(_req,options)=>{signal=options.signal;return new Promise(resolve=>{release=resolve;});}});
  f.get("read").click();await tick();
  if(action==="cancel")f.get("cancel").click();else if(action==="pagehide")f.view.dispatchEvent(new Event("pagehide"));else if(action==="dispose")f.page.dispose();
  else f.get(action).dispatchEvent(new Event("input"));
  assert.equal(signal.aborted,true);release(publicBatchFixture());await tick();assert.equal(f.get("result").hidden,true);assert.equal(f.get("save").disabled,true);f.page.dispose();
});
test("cancel during checksum generation discards late export even when implementation ignores abort",async()=>{
  let release;const f=setup({prepare:()=>new Promise(resolve=>{release=resolve;})});f.get("read").click();await until(()=>!!release);
  f.get("cancel").click();release(await preparePublicTokenBatchFile(publicBatchFixture()));await tick();assert.equal(f.get("save").disabled,true);assert.equal(f.get("result").hidden,true);f.page.dispose();
});
test("invalid input never reads; retry after failure and response context mismatch remain explicit",async()=>{
  let mode="failure";const f=setup({read:async()=>{if(mode==="failure")throw Error();const r=publicBatchFixture();if(mode==="mismatch")r.account="0x"+"2".repeat(40);return r;}});
  f.get("account").value="seed words";f.get("read").click();assert.equal(f.calls(),0);f.get("account").value=publicBatchFixture().account;
  for(mode of ["failure","mismatch"]){f.get("read").click();await until(()=>!f.get("read").disabled);assert.equal(f.get("save").disabled,true);assert.match(f.get("status").textContent,/取得できません/);}
  mode="success";f.get("read").click();await until(()=>!f.get("save").disabled);assert.equal(f.calls(),3);f.page.dispose();
});
test("missing code and metadata mismatch are visible rather than claimed as verified zero",async()=>{
  const f=setup({read:async()=>{const r=publicBatchFixture();Object.assign(r.tokens[0],{hasCode:false,metadata:null,balanceBaseUnits:null});r.tokens[1].metadata.symbol="WRONG";return r;}});
  f.get("read").click();await until(()=>!f.get("save").disabled);assert.match(f.get("status").textContent,/不一致・未確認/);
  assert.equal(f.get("rows").children[0].children[2].textContent,"未確認");assert.match(f.get("rows").children[1].children[3].textContent,/不一致/);f.page.dispose();
});
test("failed download preserves completed result and reentrant input change prevents a stale save receipt",async()=>{
  let mode="throw";const f=setup({download(_request,get){if(mode==="throw")throw Error();get("account").dispatchEvent(new Event("input"));}});
  f.get("read").click();await until(()=>!f.get("save").disabled);f.get("save").click();assert.match(f.get("save-status").textContent,/結果は保持/);assert.equal(f.get("save").disabled,false);
  mode="edit";f.get("save").click();assert.equal(f.get("save-status").textContent,"");assert.equal(f.get("save").disabled,true);f.page.dispose();
});
