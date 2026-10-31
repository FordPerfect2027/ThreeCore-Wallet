import test from "node:test";
import assert from "node:assert/strict";
import {rehearsalExampleV2} from "../src/operation-rehearsal-examples.js";
import {REHEARSAL_WORKSPACE_SCHEMA,encodeRehearsalWorkspace} from "../src/operation-rehearsal-workspace.js";
import {indexRehearsalRecords,queryRehearsalRecords,queryRehearsalReasonRecords,validateRehearsalReasonRecordQuery,encodeRehearsalReasonRecordReport,rehearsalReasonRecordCsv,encodeRehearsalRecordReport,rehearsalRecordCsv,REHEARSAL_RECORD_QUERY} from "../src/operation-rehearsal-records.js";
import {reviewRehearsalReport,encodeRehearsalReviewEvidence,reviewRehearsalEvidence} from "../src/operation-rehearsal-report-review.js";
import {describeRehearsalFileTarget} from "../src/file-read-status.js";
const base={...REHEARSAL_RECORD_QUERY,searchScope:"stored",reason:"WRONG_ACCOUNT"};
function source(){const dat=structuredClone(rehearsalExampleV2());
 dat.events.push({...dat.events[0],id:"WRONG_ACCOUNT_named",operationId:"named"},
   {...dat.events[0],id:"wrong-context",account:"0x"+"9".repeat(40)},
   {...dat.events[0],id:"too-large",operationId:"large",principal:"150000000"});
 return {schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers:[dat,rehearsalExampleV2("EMA","limit")]};
}

test("exact rejection reason is distinct from similar ID text and combines with existing filters",()=>{
 const index=indexRehearsalRecords(source()),report=queryRehearsalReasonRecords(index,base);
 assert.deepEqual(report.rows.map(row=>row.key),["DAT:wrong-context"]);
 assert.equal(queryRehearsalRecords(index,{...REHEARSAL_RECORD_QUERY,search:"wrong_account"}).matchedRecords,2);
 assert.equal(queryRehearsalReasonRecords(index,{...base,decision:"accepted"}).matchedRecords,0);
 assert.equal(queryRehearsalReasonRecords(index,{...base,kind:"settle"}).matchedRecords,0);
 assert.equal(queryRehearsalReasonRecords(index,{...base,agent:"EMA"}).matchedRecords,0);
 const limited=queryRehearsalReasonRecords(index,{...base,reason:"PER_OPERATION_LIMIT",agent:"DAT"});
 assert.equal(limited.matchedRecords,1);assert.ok(limited.rows[0].result.reasons.includes("OUTSTANDING_LIMIT"));
 assert.equal(queryRehearsalReasonRecords(index,{...base,reason:"all"}).matchedRecords,6);
});

test("exact reason retains the chosen stored or recorded context semantics",()=>{
 const index=indexRehearsalRecords(source()),search="0x"+"9".repeat(40);
 assert.equal(queryRehearsalReasonRecords(index,{...base,search}).matchedRecords,0);
 for(const searchScope of ["recorded","both"])assert.equal(queryRehearsalReasonRecords(index,{...base,search,searchScope}).matchedRecords,1);
 assert.ok(Object.isFrozen(queryRehearsalReasonRecords(index,base).query));
});

test("reason queries reject unknown codes, coercion, extra fields and accessors",()=>{
 for(const reason of ["wrong_account","WRONG","__proto__",null,{toString(){throw Error("Never coerce");}}])
  assert.throws(()=>validateRehearsalReasonRecordQuery({...base,reason}));
 assert.throws(()=>validateRehearsalReasonRecordQuery({...base,ignored:true}));
 let reads=0;const getter={...base};Object.defineProperty(getter,"reason",{get(){reads++;return "WRONG_ACCOUNT";}});
 assert.throws(()=>validateRehearsalReasonRecordQuery(getter));assert.equal(reads,0);
 assert.throws(()=>validateRehearsalReasonRecordQuery({...base,searchScope:"unknown"}));
 assert.throws(()=>queryRehearsalReasonRecords({...indexRehearsalRecords(source())},base));
});

test("reason-specific JSON and CSV preserve whole-match scope while legacy formats stay reason-free",async()=>{
 const input=source(),text=encodeRehearsalReasonRecordReport(input,base),report=JSON.parse(text),review=await reviewRehearsalReport(text);
 assert.equal(report.schema,"threecore.operation-rehearsal-record-query.v3");assert.equal(report.totalRecords,6);assert.equal(report.matchedRecords,1);
 assert.equal(review.matchesRecomputation,true);assert.equal(review.reportOutcome.query.reason,"WRONG_ACCOUNT");
 const csv=rehearsalReasonRecordCsv(input,base);assert.match(csv,/"queryReason"/);assert.equal(csv.trim().split("\r\n").length,2);
 assert.doesNotMatch(rehearsalRecordCsv(input),/"queryReason"/);assert.equal(JSON.parse(encodeRehearsalRecordReport(input)).schema,"threecore.operation-rehearsal-record-query.v1");
 const empty=rehearsalReasonRecordCsv(input,{...base,decision:"accepted"});assert.equal(empty.trim().split("\r\n").length,1);
 assert.equal(describeRehearsalFileTarget(text,"report"),null);assert.match(describeRehearsalFileTarget(text,"workspace"),/資料を再計算して確認/);
 const evidence=await reviewRehearsalEvidence(encodeRehearsalReviewEvidence(review));assert.equal(evidence.reportReview.matchesRecomputation,true);
});

test("tampered reason, match count and execution claims are detected by full recomputation",async()=>{
 const text=encodeRehearsalReasonRecordReport(source(),base),changed=JSON.parse(text);changed.query.reason="PER_OPERATION_LIMIT";changed.authorizesExecution=true;
 const review=await reviewRehearsalReport(JSON.stringify(changed));assert.equal(review.matchesRecomputation,false);
 assert.ok(review.differences.some(row=>row.path==="/matchedRecords"));assert.ok(review.differences.some(row=>row.path==="/authorizesExecution"));
 const changedCount=JSON.parse(text);changedCount.matchedRecords=999;
 assert.equal((await reviewRehearsalReport(JSON.stringify(changedCount))).matchesRecomputation,false);
});

import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";import {join,resolve,dirname,basename} from "node:path";import {spawnSync} from "node:child_process";
test("offline reason query emits shared JSON and CSV without modifying the workspace",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"threecore-reason-query-")),path=join(dir,"workspace.json"),input=source(),original=encodeRehearsalWorkspace(input);
 try{await writeFile(path,original);
  for(const format of ["json","csv"]){const result=spawnSync(process.execPath,["scripts/inspect-rehearsal-records.js",path,"--reason","WRONG_ACCOUNT","--format",format],{cwd:new URL("../",import.meta.url),encoding:"utf8",timeout:20000});
   assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,format==="json"?encodeRehearsalReasonRecordReport(input,base):rehearsalReasonRecordCsv(input,base));}
  const invalid=spawnSync(process.execPath,["scripts/inspect-rehearsal-records.js",path,"--reason","WRONG_ACCOUNT","--reason","PER_OPERATION_LIMIT"],{cwd:new URL("../",import.meta.url),encoding:"utf8",timeout:20000});
  assert.equal(invalid.status,1);assert.equal(invalid.stdout,"");assert.equal(await readFile(path,"utf8"),original);
 }finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith("threecore-reason-query-"));await rm(dir,{recursive:true,force:true});}
});
