import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { decodeRehearsalBatchManifest, matchRehearsalBatchManifest, reviewRehearsalReportBatch,
  encodeRehearsalBatchReview, encodeRehearsalBatchManifest } from "../src/operation-rehearsal-report-review.js";
import { reportRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
const source=JSON.stringify(reportRehearsalOverview({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers:[rehearsalExampleV2()]}));
const hash=text=>createHash("sha256").update(text).digest("hex");
const fast={digest:async(_,bytes)=>Uint8Array.from(createHash("sha256").update(bytes).digest()).buffer};
const row=(name="a.json",text=source)=>({name,text});
const manifest=rows=>rows.map(r=>hash(r.text)+"  "+r.name).join("\n")+"\n";

test("saved basenames, BOM, CRLF, binary markers and uppercase hash remain an exact captured reference",async()=>{
  const rows=[row("資料.json"),row("b.json")];
  const reference="\uFEFF"+rows.slice().reverse().map(r=>hash(r.text).toUpperCase()+" *"+r.name).join("\r\n")+"\r\n";
  const result=await reviewRehearsalReportBatch(rows,{manifestText:reference,subtle:fast});
  assert.equal(result.schema,"threecore.operation-rehearsal-batch-review.v2");assert.equal(result.reference.text,reference);
  assert.equal(result.reference.sha256,hash(reference));assert.equal(result.summary.checksumsCompared,2);assert.equal(result.summary.checksumsMatching,2);
  assert.equal(result.allExternalChecksumsMatch,true);assert.equal(result.allRecomputationsMatch,true);
  assert.deepEqual(result.files.map(r=>r.expectedSha256),rows.map(r=>hash(r.text)));
  assert.deepEqual(result.reference.entries.map(r=>r.name),rows.map(r=>r.name));
});
test("changed whitespace mismatches its reference before any semantic report claim",async()=>{
  const original=[row()],rows=[row("a.json",source+"\n")],reference=manifest(original);
  const result=await reviewRehearsalReportBatch(rows,{manifestText:reference,subtle:fast});
  assert.equal(result.complete,true);assert.equal(result.summary.checksumMismatches,1);assert.equal(result.allExternalChecksumsMatch,false);
  assert.equal(result.files[0].status,"checksum-mismatch");assert.equal(result.files[0].inputSchema,null);assert.equal(result.files[0].differenceCount,null);
  assert.equal(result.files[0].expectedSha256,hash(source));assert.equal(result.files[0].sha256,hash(source+"\n"));
  assert.equal(result.reference.text,reference);assert.equal(encodeRehearsalBatchManifest(result),manifest(rows));
});
test("a matching checksum does not make unsupported data a valid report",async()=>{
  const rows=[row("a.json","{}")],result=await reviewRehearsalReportBatch(rows,{manifestText:manifest(rows),subtle:fast});
  assert.equal(result.allExternalChecksumsMatch,true);assert.equal(result.allRecomputationsMatch,false);assert.equal(result.summary.unsupported,1);
});
for(const reference of ["", "bad", hash(source)+" a.json\n", hash(source)+"  ../a.json\n", hash(source)+"  dir/a.json\n",hash(source)+"  CON.json\n",hash(source)+"  a.json\n\n",hash(source)+"  a.json\n"+hash(source)+"  A.JSON\n"," ".repeat(16385)])test("reference decoder refuses ambiguous or unsupported text "+reference.length,()=>{
  assert.throws(()=>decodeRehearsalBatchManifest(reference),{code:"INVALID_REVIEW_BATCH_MANIFEST"});
});
for(const names of [["b.json"],["a.json","b.json"],["A.json"]])test("reference must cover the exact selected names "+names.join(),async()=>{
  let calls=0;await assert.rejects(reviewRehearsalReportBatch([row()],{manifestText:manifest(names.map(name=>row(name))),subtle:{digest(){calls++;}}}),{code:"REVIEW_BATCH_REFERENCE_SELECTION"});assert.equal(calls,0);
});
test("selected extra file cannot be silently left outside the reference",()=>{
  assert.throws(()=>matchRehearsalBatchManifest([{name:"a.json",byteLength:1},{name:"b.json",byteLength:1}],manifest([row()])),{code:"REVIEW_BATCH_REFERENCE_SELECTION"});
});
test("reference option is captured without invoking accessors",async()=>{
  let gets=0;await assert.rejects(reviewRehearsalReportBatch([row()],{get manifestText(){gets++;return manifest([row()]);}}),{code:"INVALID_REVIEW_BATCH_OPTIONS"});assert.equal(gets,0);
});
test("a caller cannot replace the saved reference during progress",async()=>{
  const reference=manifest([row()]),options={manifestText:reference,subtle:fast,onProgress(){options.manifestText="bad";}};
  const result=await reviewRehearsalReportBatch([row()],options);assert.equal(result.reference.text,reference);assert.equal(result.allExternalChecksumsMatch,true);
});
test("partial reference review preserves expected hashes for unchecked files",async()=>{
  const rows=[row(),row("b.json")],abort=new AbortController();
  const result=await reviewRehearsalReportBatch(rows,{manifestText:manifest(rows),subtle:fast,signal:abort.signal,onProgress(p){if(p.reviewed===1)abort.abort();}});
  assert.equal(result.complete,false);assert.equal(result.summary.checksumsCompared,1);assert.equal(result.files[1].checksumMatches,null);
  assert.equal(result.files[1].expectedSha256,hash(source));assert.equal(result.allExternalChecksumsMatch,false);assert.throws(()=>encodeRehearsalBatchManifest(result));
});
test("cancelled reference digest cannot start any file digest or claim checksum comparisons",async()=>{
  const abort=new AbortController();let release,entered,calls=0;const ready=new Promise(r=>{entered=r;});
  const pending=reviewRehearsalReportBatch([row()],{manifestText:manifest([row()]),signal:abort.signal,subtle:{digest(){calls++;entered();return new Promise(r=>{release=r;});}}});
  await ready;abort.abort();const result=await pending;assert.equal(result.summary.checksumsCompared,0);assert.equal(result.externalChecksumsCompared,false);assert.equal(result.reference.sha256,null);
  release(new Uint8Array(32).buffer);await new Promise(r=>setImmediate(r));assert.equal(calls,1);assert.equal(result.files[0].status,"pending");
});
test("reference hashing failure refuses the run instead of falling back to unchecked review",async()=>{
  let calls=0;await assert.rejects(reviewRehearsalReportBatch([row()],{manifestText:manifest([row()]),subtle:{digest(){calls++;throw Error("private marker");}}}),{code:"REVIEW_BATCH_REFERENCE_HASH_UNAVAILABLE"});assert.equal(calls,1);
});
test("previous V1 batch receipts remain byte-identical when no reference is supplied",async()=>{
  const base=new URL("../docs/evidence/2026-11-01-browser-report-batch/",import.meta.url);
  const expected=await readFile(new URL("browser-api-batch-review.json",base),"utf8"),receipt=JSON.parse(expected);
  const rows=[];for(const file of receipt.files)rows.push({name:file.name,text:await readFile(new URL(file.name,base),"utf8")});
  const result=await reviewRehearsalReportBatch(rows,{subtle:fast});assert.equal(encodeRehearsalBatchReview(result),expected);
});
