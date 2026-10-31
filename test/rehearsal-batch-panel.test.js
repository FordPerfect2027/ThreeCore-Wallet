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
function setup(subtle=fast,inspectSource=null){const nodes=new Map(),downloads=[];let action=()=>{};
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Element("div"));return nodes.get(id);},createElement:tag=>new Element(tag)};
  const q=id=>document.getElementById("report-batch-"+id);
  const panel=mountRehearsalBatchReviewPanel(document,{subtle,inspectSource,download:({prepared})=>{const result=action();downloads.push(prepared);return result;}});
  return {q,panel,downloads,action:fn=>{action=fn;},choose(files){q("files").files=files;q("files").dispatchEvent(new Event("change"));}};
}
const file=(name="a.json",text=source)=>new File([text],name);
const wait=async predicate=>{const end=Date.now()+5000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,5));assert(predicate());};
const done=f=>wait(()=>f.q("status").getAttribute("aria-busy")==="false");
const manifest=(name="a.json",text=source)=>createHash("sha256").update(text).digest("hex")+"  "+name+"\n";
const paste=(f,text)=>{f.q("reference-text").value=text;f.q("reference-text").dispatchEvent(new Event("input"));};
const details=(f,index=0)=>f.q("rows").children[index].children.at(-1).children[0];

test("stopped file loading resumes only pending files and keeps earlier detail sources",async()=>{
 const opened=[],reads=[],f=setup(fast,value=>opened.push(value));let release,second=0;
 const item=(name,index)=>({name,size:Buffer.byteLength(source),arrayBuffer(){reads.push(index);if(index===1&&++second===1)return new Promise(resolve=>{release=resolve;});return Promise.resolve(new TextEncoder().encode(source).buffer);}});
 try{f.choose([item('first.json',0),item('second.json',1),item('third.json',2)]);f.q('run').click();await wait(()=>Boolean(release));f.q('cancel').click();await done(f);f.q('save').click();const previous=JSON.parse(f.downloads.at(-1).text);assert.equal(previous.summary.reviewed,1);assert.equal(f.q('resume').disabled,false);f.q('resume').click();await done(f);f.q('save').click();const next=JSON.parse(f.downloads.at(-1).text);assert.equal(next.complete,true);assert.equal(next.continuation.retainedReviews,1);assert.deepEqual(reads,[0,1,1,2]);assert.match(f.q('summary').textContent,/保持 1件/);details(f).click();assert.equal(opened[0].text,source);assert.equal(opened[0].name,'first.json');release(new TextEncoder().encode(source).buffer);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.q('resume').disabled,true);f.q('clear').click();assert.equal(f.q('resume').disabled,true);}finally{release?.(new TextEncoder().encode(source).buffer);f.panel.dispose();}
});
test("unreadable middle file does not erase prior or later report reviews",async()=>{
 const f=setup();try{f.choose([file('first.json'),new File([Uint8Array.of(255)],'unreadable.json'),file('last.json')]);f.q('run').click();await done(f);f.q('save').click();const result=JSON.parse(f.downloads.at(-1).text);assert.deepEqual(result.files.map(row=>row.status),['matched','source-unavailable','matched']);assert.match(f.q('summary').textContent,/読み込み失敗 1件/);assert.equal(f.q('manifest').disabled,true);assert.equal(details(f,1).disabled,true);f.q('csv').click();assert.match(f.downloads.at(-1).text,/sourceUnavailable/);}finally{f.panel.dispose();}
});
test("failed continuation linkage retains a saveable prior result",async()=>{
 let fail=false,release,calls=0;const f=setup({digest(...args){if(fail)throw Error('PRIVATE');if(++calls===2)return new Promise(resolve=>{release=resolve;});return fast.digest(...args);}});
 try{f.choose([file(),file('second.json')]);f.q('run').click();await wait(()=>Boolean(release));f.q('cancel').click();await done(f);f.q('save').click();const previous=f.downloads.at(-1).text;fail=true;f.q('resume').click();await done(f);assert.match(f.q('status').textContent,/前回の確認結果は保持/);assert.doesNotMatch(f.q('status').textContent,/PRIVATE/);assert.equal(f.q('resume').disabled,false);f.q('save').click();assert.equal(f.downloads.at(-1).text,previous);}finally{release?.(new ArrayBuffer(32));f.panel.dispose();}
});

test("batch detail handoff retains original bytes and reference instead of substituting its actual hash",async()=>{
  const calls=[],f=setup(fast,row=>{calls.push(row);return true;});try{
    f.choose([file("a.json",source+"\r\n")]);paste(f,manifest());f.q("run").click();await done(f);const before=f.q("summary").textContent;
    details(f).click();assert.deepEqual(calls,[{name:"a.json",text:source+"\r\n",expectedSha256:createHash("sha256").update(source).digest("hex")}]);assert(Object.isFrozen(calls[0]));assert.equal(f.q("summary").textContent,before);assert.equal(f.q("save").disabled,false);
    const old=details(f);f.q("clear").click();old.click();assert.equal(calls.length,1);
    f.choose([file()]);f.q("run").click();await done(f);details(f).click();assert.equal(calls[1].expectedSha256,null);
  }finally{f.panel.dispose();}
});
test("stopped batches expose only completed sources and CSV retains pending scope",async()=>{
  let release,calls=0;const opened=[],f=setup({digest(...args){return ++calls===2?new Promise(r=>{release=r;}):fast.digest(...args);}},row=>{opened.push(row);return true;});
  try{f.choose([file(),file("b.json")]);f.q("run").click();await wait(()=>calls===2);f.q("cancel").click();await done(f);assert.equal(details(f).disabled,false);assert.equal(details(f,1).disabled,true);details(f,1).click();assert.equal(opened.length,0);
    f.q("csv").click();assert.equal(f.downloads.at(-1).filename,"ThreeCore-report-batch-summary.csv");assert.match(f.downloads.at(-1).text,/"cancelled","false","2","1","1"/);assert.match(f.downloads.at(-1).text,/"b.json","pending"/);
    f.q("clear").click();assert.equal(f.q("csv").disabled,true);
  }finally{release?.(new Uint8Array(32).buffer);f.panel.dispose();}
});
for(const mode of ["throws","false","async","clears","disposes"])test("detail handoff failure or stale completion preserves honest state "+mode,async()=>{
  let f;f=setup(fast,()=>{if(mode==="throws")throw Error("private");if(mode==="false")return false;if(mode==="async")return Promise.reject(Error("private"));if(mode==="clears")f.q("clear").click();if(mode==="disposes")f.panel.dispose();return true;});
  try{f.choose([file()]);f.q("run").click();await done(f);details(f).click();await new Promise(r=>setTimeout(r,0));
    if(["clears","disposes"].includes(mode)){assert.equal(f.q("export-status").textContent,"");assert.equal(f.q("save").disabled,true);}else{assert.match(f.q("export-status").textContent,/渡せません/);assert.equal(f.q("save").disabled,false);}assert(!f.q("export-status").textContent.includes("private"));
  }finally{f.panel.dispose();}
});
test("CSV failed delivery retains the owned result for retry",async()=>{
  const f=setup();try{f.choose([file()]);f.q("run").click();await done(f);f.action(()=>false);f.q("csv").click();assert.match(f.q("export-status").textContent,/保存できません/);assert.equal(f.q("csv").disabled,false);f.action(()=>{});f.q("csv").click();assert.match(f.q("export-status").textContent,/CSVで保存し始め/);}finally{f.panel.dispose();}
});
test("reference digest failure displays useful retry guidance without null or undefined",async()=>{
 const f=setup({digest(){throw Error("private");}});try{f.choose([file()]);paste(f,manifest());f.q("run").click();await done(f);assert.match(f.q("status").textContent,/照合値/);for(const value of ["null","undefined","private"])assert(!f.q("status").textContent.includes(value));assert.equal(f.q("save").disabled,true);}finally{f.panel.dispose();}
});

test("previous checksum paste binds exact files and preserves the reference when the selected bytes differ",async()=>{
  const f=setup(),reference=manifest();try{
    f.choose([file()]);paste(f,reference);f.q("run").click();await done(f);f.q("save").click();
    let result=JSON.parse(f.downloads.pop().text);assert.equal(result.schema,"threecore.operation-rehearsal-batch-review.v2");assert.equal(result.allExternalChecksumsMatch,true);
    f.choose([file("a.json",source+"\n")]);assert.equal(f.q("reference-text").value,reference);f.q("run").click();await done(f);f.q("save").click();
    result=JSON.parse(f.downloads.pop().text);assert.equal(result.files[0].status,"checksum-mismatch");assert.equal(result.files[0].differenceCount,null);assert.equal(result.reference.text,reference);
    assert.match(f.q("summary").textContent,/以前の照合値との一致 0件、不一致 1件/);
    f.q("manifest").click();assert.equal(f.downloads.at(-1).filename,"ThreeCore-selected-content-SHA256SUMS.txt");assert.equal(f.downloads.at(-1).text,manifest("a.json",source+"\n"));assert.equal(f.q("reference-text").value,reference);
    f.q("reference-clear").click();assert.equal(f.q("run").disabled,false);assert.equal(f.q("save").disabled,true);f.q("run").click();await done(f);f.q("save").click();
    result=JSON.parse(f.downloads.pop().text);assert.equal(result.schema,"threecore.operation-rehearsal-batch-review.v1");assert.equal(result.files[0].status,"matched");
  }finally{f.panel.dispose();}
});
for(const reference of ["invalid",manifest("other.json"),manifest("A.json")])test("invalid or unmatched reference never silently falls back "+reference.slice(0,10),async()=>{
  const f=setup();try{paste(f,reference);f.choose([file()]);assert.equal(f.q("run").disabled,true);assert.equal(f.q("reference-text").value,reference);assert.equal(f.q("save").disabled,true);
    paste(f,manifest());assert.equal(f.q("run").disabled,false);
  }finally{f.panel.dispose();}
});
test("native reference File preserves its exact bytes and rejects an unreadable replacement",async()=>{
  const f=setup(),reference="\ufeff"+manifest().replace("\n","\r\n");try{
    f.choose([file()]);f.q("reference-file").files=[new File([reference],"SHA256SUMS.txt")];f.q("reference-file").dispatchEvent(new Event("change"));
    await wait(()=>f.q("reference-status").getAttribute("aria-busy")==="false");assert.equal(f.q("reference-text").value,reference);f.q("run").click();await done(f);f.q("save").click();
    assert.equal(JSON.parse(f.downloads.pop().text).reference.text,reference);
    f.q("reference-file").files=[{size:1,arrayBuffer(){throw Error("private");}}];f.q("reference-file").dispatchEvent(new Event("change"));await wait(()=>f.q("reference-status").getAttribute("aria-busy")==="false");
    assert.equal(f.q("run").disabled,true);assert.equal(f.q("save").disabled,true);assert(!f.q("reference-status").textContent.includes("private"));
  }finally{f.panel.dispose();}
});
for(const action of ["replace","clear","paste","dispose"])test("late reference read cannot overwrite "+action,async()=>{
  let release;const f=setup();try{
    f.choose([file()]);f.q("reference-file").files=[{size:manifest().length,arrayBuffer(){return new Promise(r=>{release=r;});}}];f.q("reference-file").dispatchEvent(new Event("change"));await wait(()=>Boolean(release));assert.equal(f.q("run").disabled,true);
    if(action==="replace")f.choose([file()]);if(action==="clear")f.q("reference-clear").click();if(action==="paste")paste(f,manifest());if(action==="dispose")f.panel.dispose();
    release(new TextEncoder().encode(manifest()).buffer);await new Promise(r=>setTimeout(r,10));assert.equal(f.q("run").disabled,action==="replace"||action==="dispose");
    assert.equal(f.q("reference-text").value,action==="paste"?manifest():"");assert.equal(f.q("save").disabled,true);
  }finally{release?.(new TextEncoder().encode(manifest()).buffer);f.panel.dispose();}
});
test("an explicitly selected empty checksum file is not treated as an absent reference",async()=>{
  const f=setup();try{f.choose([file()]);f.q("reference-file").files=[new File([""],"SHA256SUMS.txt")];f.q("reference-file").dispatchEvent(new Event("change"));await wait(()=>f.q("reference-status").getAttribute("aria-busy")==="false");assert.equal(f.q("run").disabled,true);assert.match(f.q("reference-status").textContent,/確認してください/);}finally{f.panel.dispose();}
});
test("reference edit retires pending verification before a late digest returns",async()=>{
  let release,calls=0;const f=setup({digest(...args){return ++calls===1?new Promise(r=>{release=r;}):fast.digest(...args);}});
  try{f.choose([file()]);paste(f,manifest());f.q("run").click();await wait(()=>calls===1);paste(f,"bad");release(new Uint8Array(32).buffer);await new Promise(r=>setTimeout(r,10));
    assert.equal(f.q("rows").children.length,0);assert.equal(f.q("save").disabled,true);assert.equal(f.q("run").disabled,true);paste(f,manifest());f.q("run").click();await done(f);f.q("save").click();assert.equal(JSON.parse(f.downloads.pop().text).allExternalChecksumsMatch,true);
  }finally{release?.(new Uint8Array(32).buffer);f.panel.dispose();}
});
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
    f.q("cancel").click();await done(f);assert.match(f.q("summary").textContent,/確認済み 0件／未確認 1件/);assert.equal(f.q("save").disabled,false);assert.equal(f.q("resume").disabled,false);
    f.choose([file()]);f.q("run").click();await done(f);assert.match(f.q("summary").textContent,/一致 1件/);
  }finally{release?.(new Uint8Array([65]).buffer);f.panel.dispose();}
});
test("unreadable file is not reported as an empty or matching report",async()=>{
  const f=setup();try{f.choose([{name:"a.json",size:1,arrayBuffer(){throw Error("private marker");}}]);f.q("run").click();await done(f);
    assert.match(f.q("status").textContent,/読み込めない資料/);assert(!f.q("status").textContent.includes("private marker"));assert.equal(f.q("save").disabled,false);f.q("save").click();assert.equal(JSON.parse(f.downloads.at(-1).text).files[0].status,"source-unavailable");
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
