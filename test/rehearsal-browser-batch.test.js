import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { reviewRehearsalReportBatch, encodeRehearsalBatchReview, encodeRehearsalBatchManifest,
  validateRehearsalReportBatchSelection, reviewRehearsalReport } from "../src/operation-rehearsal-report-review.js";
import { reviewRehearsalReportBatch as reviewDiskBatch } from "../scripts/rehearsal-report-batch.js";
import { reportRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA } from "../src/operation-rehearsal-scenario-set.js";
import { captureRehearsalCheckSuite, encodeRehearsalCheckReport } from "../src/operation-rehearsal-check-suite.js";

const input = rehearsalExampleV2();
const overview = reportRehearsalOverview({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers:[input]});
const text = " \r\n" + JSON.stringify(overview,null,2).replaceAll("\n","\r\n") + "\r\n";
const row = (name="original.json",value=text) => ({name,text:value});
const digest = value => createHash("sha256").update(value).digest("hex");
const fast = { digest: async (_, bytes) => Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer };
const altered = structuredClone(overview);altered.rows[0].recordCount=999;
const suite = structuredClone(captureRehearsalCheckSuite({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,
  cases:[{id:"same",label:"Same inputs",before:input,after:input}]}));
suite.expectationOrigin="manually-specified";suite.expected[0].before.metrics.cash="999";

test("batch review keeps matching, altered, invalid and unsupported files distinct with exact hashes",async()=>{
  const rows=[row("資料.json"),row("changed.json",JSON.stringify(altered)),row("invalid.json","{broken"),row("unsupported.json","{}"),row("failed-expectation.json",encodeRehearsalCheckReport(suite))];
  const before=structuredClone(rows),progress=[];
  const result=await reviewRehearsalReportBatch(rows,{subtle:webcrypto.subtle,onProgress:p=>progress.push(p)});
  assert.deepEqual(result.files.map(r=>r.status),["matched","different","invalid","unsupported","matched"]);
  assert.equal(result.summary.reportsWithFailedExpectations,1);assert.equal(result.summary.reviewed,5);
  assert.equal(result.allRecomputationsMatch,false);assert.equal(result.complete,true);assert.equal(result.externalChecksumsCompared,false);
  assert.deepEqual(result.files.map(r=>r.sha256),rows.map(r=>digest(r.text)));
  assert.deepEqual(progress.map(p=>p.reviewed),[0,1,2,3,4,5]);assert.deepEqual(rows,before);
  const single=await reviewRehearsalReport(rows[1].text,{subtle:webcrypto.subtle});
  assert.equal(result.files[1].differenceCount,single.differenceCount);
  assert.equal(JSON.parse(encodeRehearsalBatchReview(result)).files.length,5);
  assert.equal(encodeRehearsalBatchManifest(result).split("\n").length,6);
  assert.throws(()=>{result.files[0].sha256="0".repeat(64);});
});
test("browser batch manifest is usable by the existing bounded offline verifier",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"threecore-browser-batch-"));
  try {
    const rows=[row(),row("changed.json",JSON.stringify(altered))],result=await reviewRehearsalReportBatch(rows,{subtle:fast});
    for(const r of rows)await writeFile(join(folder,r.name),r.text);
    const manifest=join(folder,"SHA256SUMS.txt");await writeFile(manifest,encodeRehearsalBatchManifest(result));
    const disk=await reviewDiskBatch(manifest);
    assert.deepEqual(disk.files.map(r=>r.status),["matched","different"]);
    assert.equal(disk.allChecksumsAndRecomputationsMatch,false);
  } finally {
    const absolute=resolve(folder),base=resolve(tmpdir())+sep;
    if(!absolute.startsWith(base)||!absolute.slice(base.length).startsWith("threecore-browser-batch-"))throw Error("Invalid cleanup target");
    await rm(absolute,{recursive:true,force:true});
  }
});
test("failed expected outcomes are visible even if every report matches recomputation",async()=>{
  const result=await reviewRehearsalReportBatch([row("case.json",encodeRehearsalCheckReport(suite))],{subtle:fast});
  assert.equal(result.allRecomputationsMatch,true);assert.equal(result.summary.reportsWithFailedExpectations,1);
});
for(const name of ["../a.json","sub/a.json","bad\\a.json","CON.json","prn.test.json","LPT1.json","a.json\n","a\u202e.json"," a.json",".hidden.json","a:bad.json","a*.json","not-json.txt", "a".repeat(181)+".json"])test("batch refuses nonportable selection name "+JSON.stringify(name),()=>{
  assert.throws(()=>validateRehearsalReportBatchSelection([{name,byteLength:1}]),{code:"INVALID_REVIEW_BATCH_SELECTION"});
});
for(const entries of [[],[row("A.json"),row("a.JSON")],[row("é.json"),row("e\u0301.json")],Array.from({length:21},(_,i)=>row(i+".json")),[row("large.json"," ".repeat(2097153))],Array.from({length:9},(_,i)=>row(i+".json"," ".repeat(1048576)))])test("batch rejects invalid count, duplicate identity or byte budget before hashing "+entries.length,async()=>{
  let calls=0;await assert.rejects(reviewRehearsalReportBatch(entries,{subtle:{digest(){calls++;throw Error();}}}));assert.equal(calls,0);
});
test("batch captures all source texts before callbacks can mutate caller inputs",async()=>{
  const rows=[row(),row("second.json")];
  const result=await reviewRehearsalReportBatch(rows,{subtle:fast,onProgress(){rows[1].text="{}";rows[0].name="changed.json";}});
  assert.equal(result.files[0].name,"original.json");assert.equal(result.summary.matching,2);
});
test("batch rejects accessor input and options without execution",async()=>{
  let gets=0;await assert.rejects(reviewRehearsalReportBatch([{name:"a.json",get text(){gets++;return text;}}]),{code:"INVALID_REVIEW_BATCH_INPUT"});
  await assert.rejects(reviewRehearsalReportBatch([row()],{get onProgress(){gets++;return undefined;}}),{code:"INVALID_REVIEW_BATCH_OPTIONS"});assert.equal(gets,0);
});
test("cancellation keeps completed rows and labels the remainder unchecked",async()=>{
  const abort=new AbortController();
  const result=await reviewRehearsalReportBatch([row(),row("second.json")],{subtle:fast,signal:abort.signal,onProgress(p){if(p.reviewed===1)abort.abort();}});
  assert.equal(result.phase,"cancelled");assert.equal(result.complete,false);assert.equal(result.summary.reviewed,1);
  assert.deepEqual(result.files.map(r=>r.status),["matched","pending"]);assert.equal(result.allRecomputationsMatch,false);
  assert.throws(()=>encodeRehearsalBatchManifest(result),{code:"REVIEW_BATCH_HASHES_INCOMPLETE"});assert.equal(JSON.parse(encodeRehearsalBatchReview(result)).summary.pending,1);
});
for(const action of ["cancel","deadline"])test("pending digest "+action+" cannot later append a result",async()=>{
  const abort=new AbortController();let release,entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  const promise=reviewRehearsalReportBatch([row()],{signal:abort.signal,timeoutMs:action==="deadline"?10:1000,
    subtle:{digest(){entered();return new Promise(resolve=>{release=resolve;});}}});
  await ready;if(action==="cancel")abort.abort();const result=await promise;
  assert.equal(result.phase,action==="cancel"?"cancelled":"timed-out");assert.equal(result.summary.reviewed,0);
  release(new Uint8Array(32).buffer);await new Promise(resolve=>setImmediate(resolve));assert.equal(result.summary.reviewed,0);
});
test("unavailable hash is never a successful report or usable manifest",async()=>{
  const result=await reviewRehearsalReportBatch([row()],{subtle:{digest(){throw Error("private marker");}}});
  assert.equal(result.summary.hashUnavailable,1);assert.equal(result.allRecomputationsMatch,false);
  assert(!encodeRehearsalBatchReview(result).includes("private marker"));assert.throws(()=>encodeRehearsalBatchManifest(result));
});
test("only owned completed results authorize encoded receipts and manifests",async()=>{
  const result=await reviewRehearsalReportBatch([row()],{subtle:fast});
  for(const encode of [encodeRehearsalBatchReview,encodeRehearsalBatchManifest])assert.throws(()=>encode({...result}),{code:"UNRECOGNIZED_REVIEW_BATCH"});
});
test("maximum twenty-file selection preserves all rows and authentic progress counts",async()=>{
  const seen=[];const result=await reviewRehearsalReportBatch(Array.from({length:20},(_,i)=>row(i+".json")),{subtle:fast,onProgress:p=>seen.push(p)});
  assert.equal(result.summary.matching,20);assert.equal(result.allRecomputationsMatch,true);assert.equal(seen[0].phase,"reviewing");
  assert.equal(seen.at(-1).reviewed,20);assert.equal(encodeRehearsalBatchManifest(result).trim().split("\n").length,20);
});
test("already cancelled native state cannot be concealed by an instance property",async()=>{
  const controller=new AbortController();controller.abort();Object.defineProperty(controller.signal,"aborted",{value:false});let calls=0;
  const result=await reviewRehearsalReportBatch([row()],{signal:controller.signal,subtle:{digest(){calls++;}}});
  assert.equal(result.phase,"cancelled");assert.equal(result.summary.pending,1);assert.equal(calls,0);
});
test("invalid native cancellation signal fails before hashing",async()=>{
  let calls=0;await assert.rejects(reviewRehearsalReportBatch([row()],{signal:{},subtle:{digest(){calls++;}}}),{code:"INVALID_REVIEW_BATCH_SIGNAL"});assert.equal(calls,0);
});
