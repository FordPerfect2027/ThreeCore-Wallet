import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Element } from "./helpers/panel-dom.js";
import { mountRehearsalBatchReviewPanel } from "../examples/operation-rehearsal-review-panel.js";
import { reportRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
const source=JSON.stringify(reportRehearsalOverview({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers:[rehearsalExampleV2()]}));
const fast={digest:async(_,bytes)=>Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer};
function setup(subtle=fast){const nodes=new Map(),downloads=[];let action=()=>{};
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Element("div"));return nodes.get(id);},createElement:tag=>new Element(tag)};
  const q=id=>document.getElementById("report-batch-"+id);
  const panel=mountRehearsalBatchReviewPanel(document,{subtle,download:({prepared})=>{const result=action();downloads.push(prepared);return result;}});
  return {q,panel,downloads,action:fn=>{action=fn;},choose(files){q("files").files=files;q("files").dispatchEvent(new Event("change"));}};
}
const file=(name="a.json",text=source)=>new File([text],name);
const wait=async predicate=>{const end=Date.now()+5000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,5));assert(predicate());};
const done=f=>wait(()=>f.q("status").getAttribute("aria-busy")==="false");
test("batch panel waits for explicit start, shows every result and exports compatible filenames",async()=>{
  const f=setup();try{f.choose([file(),file("bad.json","{oops"),file("other.json","{}")]);assert.equal(f.q("run").disabled,false);assert.equal(f.q("save").disabled,true);
    assert.match(f.q("status").textContent,/3件/);f.q("run").click();await done(f);assert.equal(f.q("rows").children.length,3);
    assert.match(f.q("summary").textContent,/確認済み 3件／未確認 0件/);assert.match(f.q("summary").textContent,/一致 1件/);
    assert.equal(f.q("manifest").disabled,false);f.q("save").click();f.q("manifest").click();
    assert.deepEqual(f.downloads.map(r=>r.filename),["ThreeCore-report-batch-review.json","SHA256SUMS.txt"]);
    assert.equal(JSON.parse(f.downloads[0].text).complete,true);assert.equal(f.downloads[1].text.split("\n").length,4);
    f.q("clear").click();assert.equal(f.q("save").disabled,true);assert.equal(f.q("run").disabled,true);assert.equal(f.q("rows").children.length,0);
  }finally{f.panel.dispose();}
});
for(const mode of ["count","duplicate","oversized","combined","unsafe-name"])test("batch panel refuses selection "+mode+" before reading",async()=>{
  const f=setup();let calls=0;const entry=(name,size)=>({name,size,arrayBuffer(){calls++;throw Error();}});
  try{const files=mode==="count"?Array.from({length:21},(_,i)=>entry(i+".json",1)):mode==="duplicate"?[entry("a.json",1),entry("A.JSON",1)]:mode==="oversized"?[entry("a.json",2097153)]:mode==="combined"?Array.from({length:5},(_,i)=>entry(i+".json",2097152)):[entry("../a.json",1)];
    f.choose(files);assert.equal(f.q("run").disabled,true);assert.match(f.q("status").textContent,/1〜20個/);assert.equal(calls,0);
  }finally{f.panel.dispose();}
});
test("cancel during digest retains completed results and leaves the remaining file unchecked",async()=>{
  let release,calls=0;const f=setup({digest(...args){calls++;return calls===2?new Promise(r=>{release=r;}):fast.digest(...args);}});
  try{f.choose([file(),file("b.json")]);f.q("run").click();await wait(()=>calls===2);f.q("cancel").click();await done(f);
    assert.match(f.q("summary").textContent,/確認済み 1件／未確認 1件/);assert.equal(f.q("save").disabled,false);assert.equal(f.q("manifest").disabled,true);
    f.q("save").click();assert.equal(JSON.parse(f.downloads[0].text).phase,"cancelled");
    const state=f.q("summary").textContent;release(new Uint8Array(32).buffer);await new Promise(r=>setTimeout(r,10));assert.equal(f.q("summary").textContent,state);
  }finally{release?.(new Uint8Array(32).buffer);f.panel.dispose();}
});
for(const change of ["clear","replace","dispose"])test("pending digest cannot overwrite "+change,async()=>{
  let release,calls=0;const f=setup({digest(...args){calls++;return calls===1?new Promise(r=>{release=r;}):fast.digest(...args);}});
  try{f.choose([file()]);f.q("run").click();await wait(()=>calls===1);
    if(change==="clear")f.q("clear").click();if(change==="dispose")f.panel.dispose();
    if(change==="replace"){f.choose([file("new.json")]);f.q("run").click();await done(f);}
    release(new Uint8Array(32).buffer);await new Promise(r=>setTimeout(r,10));
    if(change==="replace"){f.q("save").click();assert.equal(JSON.parse(f.downloads[0].text).files[0].name,"new.json");}
    else{assert.equal(f.q("save").disabled,true);assert.equal(f.q("rows").children.length,0);}
  }finally{release?.(new Uint8Array(32).buffer);f.panel.dispose();}
});
test("loading cancellation does not claim any recomputation and permits explicit retry",async()=>{
  let release,calls=0;const f=setup();
  try{f.choose([{name:"a.json",size:1,arrayBuffer(){calls++;return new Promise(r=>{release=r;});}}]);f.q("run").click();await wait(()=>calls===1);
    f.q("cancel").click();await done(f);assert.match(f.q("status").textContent,/結果はまだありません/);assert.equal(f.q("save").disabled,true);
    f.choose([file()]);f.q("run").click();await done(f);assert.match(f.q("summary").textContent,/一致 1件/);
  }finally{release?.(new Uint8Array([65]).buffer);f.panel.dispose();}
});
test("unreadable file is not reported as an empty or matching report",async()=>{
  const f=setup();try{f.choose([{name:"a.json",size:1,arrayBuffer(){throw Error("private marker");}}]);f.q("run").click();await done(f);
    assert.match(f.q("status").textContent,/読み込めません/);assert(!f.q("status").textContent.includes("private marker"));assert.equal(f.q("save").disabled,true);
  }finally{f.panel.dispose();}
});
for(const failure of [()=>false,()=>{throw Error("private marker");},()=>Promise.reject(Error("private marker"))])test("batch export failure keeps results for retry "+failure.toString(),async()=>{
  const f=setup();try{f.choose([file()]);f.q("run").click();await done(f);f.action(failure);f.q("save").click();await new Promise(r=>setTimeout(r,0));
    assert.match(f.q("export-status").textContent,/保存できません/);assert.equal(f.q("save").disabled,false);assert(!f.q("export-status").textContent.includes("private marker"));
    f.action(()=>{});f.q("save").click();assert.match(f.q("export-status").textContent,/保存し始め/);
  }finally{f.panel.dispose();}
});
test("clearing during download delivery cannot claim stale export success",async()=>{
  const f=setup();try{f.choose([file()]);f.q("run").click();await done(f);f.action(()=>f.q("clear").click());f.q("manifest").click();
    assert.equal(f.q("export-status").textContent,"");assert.equal(f.q("save").disabled,true);
  }finally{f.panel.dispose();}
});
