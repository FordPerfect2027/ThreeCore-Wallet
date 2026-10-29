import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { webcrypto } from "node:crypto";
import { runRehearsalScenarioSet } from "../scripts/summarize-rehearsal-scenario-set.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { buildRehearsalScenario, rehearsalScenarioParameters } from "../src/operation-rehearsal-scenario.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA, REHEARSAL_SCENARIO_SET_LIMIT, encodeRehearsalScenarioSet, encodeRehearsalScenarioSetReport } from "../src/operation-rehearsal-scenario-set.js";
import { reviewRehearsalReport } from "../src/operation-rehearsal-report-review.js";
const before=rehearsalExampleV2();
const data={schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:"limit50",label:"上限50",before,after:buildRehearsalScenario(before,{...rehearsalScenarioParameters(before),maxPerOperation:"50000000"})}]};
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),"threecore-case-set-")),file=join(dir,"cases.json");
  try{await writeFile(file,encodeRehearsalScenarioSet(data));await fn({dir,file});}
  finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith("threecore-case-set-"));await rm(dir,{recursive:true});}}
async function run(args){let output="",errors="";const code=await runRehearsalScenarioSet(args,{write:s=>{output+=s;}},{write:s=>{errors+=s;}});return{output,errors,code};}
test("offline scenario set report matches UI bytes and leaves input intact",()=>fixture(async({file})=>{
  const result=await run([file]);assert.equal(result.code,0);assert.equal(result.errors,"");assert.equal(result.output,encodeRehearsalScenarioSetReport(data));
  assert.equal(await readFile(file,"utf8"),encodeRehearsalScenarioSet(data));assert.equal(JSON.parse(result.output).rows[0].summary.newlyRejected,2);
}));
for(const [name,content]of[["bad JSON","{"],["duplicate keys",'{"a":1,"a":2}'],["UTF8",new Uint8Array([255])],["BOM","\ufeff{}"],["limit"," ".repeat(REHEARSAL_SCENARIO_SET_LIMIT+1)]])
  test(name+" produces no partial report",()=>fixture(async({file})=>{await writeFile(file,content);const result=await run([file]);assert.equal(result.code,1);assert.equal(result.output,"");}));
test("argument errors, directories and missing input cannot produce a report",()=>fixture(async({dir,file})=>{
  for(const args of[[],[file,file],["--json"],[dir],[join(dir,"missing.json")]]){const result=await run(args);assert.equal(result.code,1);assert.equal(result.output,"");}
}));
test("collection report review verifies each distinct case and identifies derived tampering",async()=>{
  const text=encodeRehearsalScenarioSetReport(data), receipt=await reviewRehearsalReport(text,{subtle:webcrypto.subtle});
  assert.equal(receipt.matchesRecomputation,true);assert.deepEqual(receipt.scope,[{agent:"DAT",caseId:"limit50",beforeRecords:2,afterRecords:2}]);
  const changed=JSON.parse(text);changed.rows[0].metrics[0].after="5";
  const bad=await reviewRehearsalReport(JSON.stringify(changed),{subtle:webcrypto.subtle});
  assert.equal(bad.matchesRecomputation,false);assert.equal(bad.differences[0].path,"/rows/0/metrics/0/after");
});
