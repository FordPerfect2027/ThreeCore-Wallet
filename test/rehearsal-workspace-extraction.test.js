import test from "node:test";
import assert from "node:assert/strict";
import {rehearsalExampleV2} from "../src/operation-rehearsal-examples.js";
import {REHEARSAL_WORKSPACE_SCHEMA,encodeRehearsalWorkspace,decodeRehearsalWorkspace} from "../src/operation-rehearsal-workspace.js";
import {encodeRehearsalOverview} from "../src/operation-rehearsal-overview.js";
import {encodeRehearsalComparison} from "../src/operation-rehearsal-comparison.js";
import {encodeRehearsalReferenceReport,encodeRehearsalRecordReport,encodeRehearsalContextRecordReport,encodeRehearsalReasonRecordReport,REHEARSAL_RECORD_QUERY} from "../src/operation-rehearsal-records.js";
import {reviewRehearsalReport,canExportReviewedRehearsalWorkspace,exportReviewedRehearsalWorkspace} from "../src/operation-rehearsal-report-review.js";
const input={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"EMA",ledgers:[rehearsalExampleV2(),rehearsalExampleV2("EMA","pending")]};
const texts=()=>[encodeRehearsalOverview(input),encodeRehearsalRecordReport(input,{...REHEARSAL_RECORD_QUERY,agent:"DAT"}),
 encodeRehearsalContextRecordReport(input,{...REHEARSAL_RECORD_QUERY,search:"absent",searchScope:"recorded"}),
 encodeRehearsalReasonRecordReport(input,{...REHEARSAL_RECORD_QUERY,reason:"WRONG_ACCOUNT",searchScope:"both"}),
 encodeRehearsalReferenceReport(input,"DAT:open-one")];

test("supported fresh reviews recover complete normalized inputs including filtered-out and missing agents",async()=>{
 const before=JSON.stringify(input);
 for(const text of texts()){
  const receipt=await reviewRehearsalReport(" \r\n"+text.replaceAll("\n","\r\n"));assert.equal(canExportReviewedRehearsalWorkspace(receipt),true);
  const output=exportReviewedRehearsalWorkspace(receipt);assert.equal(output,encodeRehearsalWorkspace(input));
  const restored=decodeRehearsalWorkspace(output);assert.equal(restored.activeAgent,"EMA");assert.equal(restored.ledgers.length,2);assert.equal(restored.ledgers[1].events.length,1);
  assert.ok(!restored.ledgers.some(row=>row.agent==="CAWELON"));assert.equal(receipt.sourceVerified,false);
 }
 assert.equal(JSON.stringify(input),before);
});

test("modified derived results and mismatching expected checksum cannot release a workspace",async()=>{
 const source=texts()[0],changed=JSON.parse(source);changed.rows[0].recordCount=999;
 for(const receipt of [await reviewRehearsalReport(JSON.stringify(changed)),await reviewRehearsalReport(source,{expectedSha256:"0".repeat(64)})]){
  assert.equal(canExportReviewedRehearsalWorkspace(receipt),false);assert.throws(()=>exportReviewedRehearsalWorkspace(receipt),e=>e.code==="REVIEW_WORKSPACE_UNAVAILABLE");
 }
 const original=await reviewRehearsalReport(source),matched=await reviewRehearsalReport(source,{expectedSha256:original.sha256});
 assert.equal(canExportReviewedRehearsalWorkspace(matched),true);
});

test("copied receipts, fabricated claims and getters cannot authorize input extraction",async()=>{
 const receipt=await reviewRehearsalReport(texts()[0]);let invoked=0;
 const forged={get matchesRecomputation(){invoked++;return true;}};
 for(const value of [{...receipt},JSON.parse(JSON.stringify(receipt)),forged,null,"receipt"]){
  assert.equal(canExportReviewedRehearsalWorkspace(value),false);assert.throws(()=>exportReviewedRehearsalWorkspace(value));
 }assert.equal(invoked,0);
});

test("a faithful before/after comparison cannot silently choose one workspace",async()=>{
 const receipt=await reviewRehearsalReport(encodeRehearsalComparison(input,input));
 assert.equal(receipt.matchesRecomputation,true);assert.equal(canExportReviewedRehearsalWorkspace(receipt),false);
 assert.throws(()=>exportReviewedRehearsalWorkspace(receipt),e=>e.code==="REVIEW_WORKSPACE_UNAVAILABLE");
});

import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";import {join,resolve,dirname,basename} from "node:path";import {spawnSync} from "node:child_process";
import {recoverRehearsalWorkspace} from "../scripts/recover-rehearsal-workspace.js";
test("workspace recovery command emits a restorable file and no partial output for refused sources",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"threecore-reviewed-workspace-")),path=join(dir,"report.json"),text=texts()[3];
 try{await writeFile(path,text);
  const good=spawnSync(process.execPath,["scripts/recover-rehearsal-workspace.js",path],{cwd:new URL("../",import.meta.url),encoding:"utf8",timeout:20000});
  assert.equal(good.status,0,good.stderr);assert.equal(good.stdout,encodeRehearsalWorkspace(input));assert.equal(await readFile(path,"utf8"),text);
  for(const [document,args,expected]of [[text,["--sha256","0".repeat(64)],2],[encodeRehearsalComparison(input,input),[],2],["{",[],1]]){
   await writeFile(path,document);let out="",err="";assert.equal(await recoverRehearsalWorkspace([path,...args],{write:value=>{out+=value;}},{write:value=>{err+=value;}}),expected);
   assert.equal(out,"");assert.ok(err.length>0);assert.equal(await readFile(path,"utf8"),document);
  }
 }finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith("threecore-reviewed-workspace-"));await rm(dir,{recursive:true,force:true});}
});
