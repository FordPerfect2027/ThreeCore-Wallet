import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { Element } from "./helpers/panel-dom.js";
import { mountRehearsalReviewPanel } from "../examples/operation-rehearsal-review-panel.js";
import { reportRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { reviewRehearsalReport, REHEARSAL_REPORT_REVIEW_LIMIT } from "../src/operation-rehearsal-report-review.js";
class Node extends Element {set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}}
const text=JSON.stringify(reportRehearsalOverview({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers:[rehearsalExampleV2()]}),null,2)+"\n";
const hash=createHash("sha256").update(text).digest("hex");
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(subtle={digest:async(_algorithm,bytes)=>Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer}) {
  const elements=new Map(),downloads=[];
  const document={getElementById(id){if(!elements.has(id))elements.set(id,new Node("div"));return elements.get(id);},createElement:tag=>new Node(tag)};
  const field=id=>document.getElementById("report-review-"+id);
  const panel=mountRehearsalReviewPanel(document,{subtle,download:({prepared})=>downloads.push(prepared)});
  const change=(id,value)=>{field(id).value=value;field(id).dispatchEvent(new Event("input"));};
  const paste=value=>{change("text",value);field("paste").click();};
  const file=(value,extras={})=>{const bytes=new TextEncoder().encode(value);field("file").files=[{name:"report.json",size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer,...extras}];field("file").dispatchEvent(new Event("change"));};
  return {field,panel,downloads,change,paste,file};
}
async function finished(f) {for(let i=0;i<100&&f.field("status").getAttribute("aria-busy")==="true";i++)await tick();assert.equal(f.field("status").getAttribute("aria-busy"),"false");}
test("file review keeps exact UTF-8 text digest and exports the same receipt as the core",async()=>{
  const f=setup();f.file(text);await finished(f);assert.match(f.field("status").textContent,/再計算と一致/);
  assert.match(f.field("source").textContent,/report.json/);assert.match(f.field("digest").textContent,new RegExp(hash));
  f.field("save").click();assert.deepEqual(JSON.parse(f.downloads[0].text),await reviewRehearsalReport(text,{subtle:webcrypto.subtle}));
});
test("paste fallback clears raw textarea and labels its byte provenance",async()=>{
  const f=setup();f.paste(text);await finished(f);assert.equal(f.field("text").value,"");
  assert.match(f.field("source").textContent,/貼り付けた文字列/);assert.equal(f.field("save").disabled,false);
});
test("derived tampering remains exportable as a discrepancy receipt, not an agreement",async()=>{
  const input=JSON.parse(text);input.rows[0].recordCount=42;
  const f=setup();f.paste(JSON.stringify(input));await finished(f);assert.match(f.field("status").textContent,/不一致/);
  assert.equal(f.field("differences").children[0].children[0].textContent,"/rows/0/recordCount");
  f.field("save").click();assert.equal(JSON.parse(f.downloads[0].text).matchesRecomputation,false);
});
test("editing expected hash revokes prior result and reuses only the selected source",async()=>{
  const f=setup();f.paste(text);await finished(f);f.change("expected","0".repeat(64));
  assert.equal(f.field("save").disabled,true);assert.equal(f.field("run").disabled,false);
  f.field("run").click();await finished(f);assert.match(f.field("status").textContent,/指定された照合値と一致しません/);
  f.change("expected",hash);f.field("run").click();await finished(f);assert.match(f.field("summary").textContent,/照合値: 一致/);
});
test("new pasted input revokes old source and cannot recheck the old file",async()=>{
  const f=setup();f.file(text);await finished(f);f.change("text","{");
  assert.equal(f.field("run").disabled,true);assert.equal(f.field("save").disabled,true);assert.equal(f.field("source").textContent,"");
});
for(const action of ["clear","edit","dispose"])test(action+" prevents an older hash completion from restoring a result",async()=>{
  let release;const f=setup({digest:()=>new Promise(resolve=>{release=resolve;})});f.paste(text);
  if(action==="clear")f.field("clear").click();if(action==="edit")f.change("expected",hash);if(action==="dispose")f.panel.dispose();
  release(await webcrypto.subtle.digest("SHA-256",new TextEncoder().encode(text)));await tick();
  assert.equal(f.field("save").disabled,true);assert.equal(f.field("scope").children.length,0);
});
test("a new source wins over a late file read",async()=>{
  let release;const f=setup();f.file(text,{arrayBuffer:()=>new Promise(resolve=>{release=resolve;})});
  f.paste(text);await finished(f);release(new TextEncoder().encode("{").buffer);await tick();
  assert.match(f.field("source").textContent,/貼り付けた文字列/);assert.equal(f.field("save").disabled,false);
});
test("oversized files are rejected before reading and invalid UTF-8 cannot yield a misleading digest",async()=>{
  const f=setup();let read=false;f.file(text,{size:REHEARSAL_REPORT_REVIEW_LIMIT+1,arrayBuffer:()=>{read=true;}});await tick();
  assert.equal(read,false);assert.equal(f.field("save").disabled,true);
  f.file(text,{size:1,arrayBuffer:async()=>new Uint8Array([255]).buffer});await tick();assert.match(f.field("status").textContent,/読み込めません/);
});
test("file chooser cancel and empty change preserve the reviewed receipt",async()=>{
  const f=setup();f.file(text);await finished(f);f.field("file").files=[];f.field("file").dispatchEvent(new Event("change"));
  f.field("file").dispatchEvent(new Event("cancel"));assert.equal(f.field("save").disabled,false);
});
test("invalid expected hash and malformed report never enable receipt export",async()=>{
  const f=setup();f.change("expected","bad");f.paste(text);await finished(f);assert.match(f.field("status").textContent,/64桁/);
  f.change("expected","");f.paste("{");await finished(f);assert.equal(f.field("save").disabled,true);
});
