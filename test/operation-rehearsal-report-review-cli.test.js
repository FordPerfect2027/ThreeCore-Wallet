import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createHash, webcrypto } from "node:crypto";
import { newReportFixtures } from "./helpers/rehearsal-report-fixtures.js";
import { runRehearsalReportReview } from "../scripts/verify-rehearsal-report.js";
import { reportRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { reviewRehearsalReport, encodeRehearsalReviewReceipt, REHEARSAL_REPORT_REVIEW_LIMIT } from "../src/operation-rehearsal-report-review.js";
const text=JSON.stringify(reportRehearsalOverview({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers:[rehearsalExampleV2()]}),null,2)+"\n";
const hash=createHash("sha256").update(text).digest("hex");
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),"threecore-report-review-")),file=join(dir,"report.json");
  try {await writeFile(file,text);await run({dir,file});}
  finally {assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith("threecore-report-review-"));await rm(dir,{recursive:true});}
}
async function run(args){let output="",errors="";const code=await runRehearsalReportReview(args,{write:s=>{output+=s}},{write:s=>{errors+=s}});return {code,output,errors};}
test("offline review reproduces browser receipt exactly and does not modify report",()=>fixture(async({file})=>{
  const result=await run([file,"--sha256",hash]);assert.equal(result.code,0);assert.equal(result.errors,"");
  assert.equal(result.output,encodeRehearsalReviewReceipt(await reviewRehearsalReport(text,{expectedSha256:hash,subtle:webcrypto.subtle})));
  assert.equal(await readFile(file,"utf8"),text);
}));
test("wrong expected checksum produces a mismatch receipt and exit two",()=>fixture(async({file})=>{
  const result=await run([file,"--sha256","0".repeat(64)]);assert.equal(result.code,2);
  assert.equal(JSON.parse(result.output).checksumMatches,false);assert.equal(result.errors,"");
}));
test("altered derived values produce a mismatch receipt and exit two",()=>fixture(async({file})=>{
  const report=JSON.parse(text);report.rows[0].recordCount=999;await writeFile(file,JSON.stringify(report));
  const result=await run([file]);assert.equal(result.code,2);assert.equal(JSON.parse(result.output).matchesRecomputation,false);
}));
for(const [name,bytes]of[["invalid JSON","{"],["invalid UTF-8",new Uint8Array([255])],
  ["UTF-8 BOM",new Uint8Array([239,187,191,...new TextEncoder().encode(text)])],
  ["oversized"," ".repeat(REHEARSAL_REPORT_REVIEW_LIMIT+1)],["unsupported receipt",'{"schema":"threecore.operation-rehearsal-report-review.v1"}']])
  test(name+" emits no partial receipt",()=>fixture(async({file})=>{
    await writeFile(file,bytes);const result=await run([file]);assert.equal(result.code,1);assert.equal(result.output,"");
  }));
test("bad arguments, absent paths and directories fail",()=>fixture(async({file,dir})=>{
  for(const args of[[],[file,"--json"],[file,"--sha256","bad"],["--unknown"],[dir],[join(dir,"absent.json")]]){
    const result=await run(args);assert.equal(result.code,1);assert.equal(result.output,"");
  }
}));
test("different line endings retain byte-specific checksum while recomputation still agrees",()=>fixture(async({file})=>{
  const crlf=text.replace(/\n/g,"\r\n");await writeFile(file,crlf);
  const result=await run([file]);assert.equal(result.code,0);const receipt=JSON.parse(result.output);
  assert.equal(receipt.sha256,createHash("sha256").update(crlf).digest("hex"));assert.notEqual(receipt.sha256,hash);
}));
test("a faithful expectation discrepancy exits zero for report fidelity and preserves the failed outcome",()=>fixture(async({file})=>{
  const text=JSON.stringify(newReportFixtures().differing,null,2)+"\n";await writeFile(file,text);
  const result=await run([file]);assert.equal(result.code,0);assert.equal(result.errors,"");
  assert.equal(JSON.parse(result.output).reportOutcome.allMatched,false);
  assert.equal(result.output,encodeRehearsalReviewReceipt(await reviewRehearsalReport(text,{subtle:webcrypto.subtle})));
}));
test("filtered query receipt is exact and does not modify the source file",()=>fixture(async({file})=>{
  const text=JSON.stringify(newReportFixtures().filtered,null,2)+"\n";await writeFile(file,text);
  const result=await run([file]);assert.equal(result.code,0);
  assert.equal(result.output,encodeRehearsalReviewReceipt(await reviewRehearsalReport(text,{subtle:webcrypto.subtle})));
  assert.equal(await readFile(file,"utf8"),text);
}));
test("query output tampering yields two while invalid source conditions yield one without receipt",()=>fixture(async({file})=>{
  const report=JSON.parse(JSON.stringify(newReportFixtures().filtered));report.matchedRecords=0;
  await writeFile(file,JSON.stringify(report));assert.equal((await run([file])).code,2);
  delete report.query;await writeFile(file,JSON.stringify(report));const result=await run([file]);
  assert.equal(result.code,1);assert.equal(result.output,"");
}));
