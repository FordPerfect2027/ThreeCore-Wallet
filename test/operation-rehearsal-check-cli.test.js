import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve,dirname,basename } from "node:path";
import { runCheckSuite } from "../scripts/run-rehearsal-check-suite.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA } from "../src/operation-rehearsal-scenario-set.js";
import { captureRehearsalCheckSuite,encodeRehearsalCheckSuite,encodeRehearsalCheckReport,REHEARSAL_CHECK_SUITE_LIMIT } from "../src/operation-rehearsal-check-suite.js";
const before=rehearsalExampleV2(),suite=captureRehearsalCheckSuite({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:"one",label:"基準",before,after:before}]});
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),"threecore-check-suite-")),file=join(dir,"expected.json");
  try{await writeFile(file,encodeRehearsalCheckSuite(suite));await fn({dir,file});}
  finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith("threecore-check-suite-"));await rm(dir,{recursive:true});}}
async function run(args){let output="",errors="";const code=await runCheckSuite(args,{write:s=>{output+=s;}},{write:s=>{errors+=s;}});return{code,output,errors};}
test("offline expected-outcome report equals browser encoder and does not write input",()=>fixture(async({file})=>{
  const result=await run([file]);assert.equal(result.code,0);assert.equal(result.errors,"");assert.equal(result.output,encodeRehearsalCheckReport(suite));assert.equal(await readFile(file,"utf8"),encodeRehearsalCheckSuite(suite));
}));
test("valid disagreement exits two with concrete comparison and no stderr error",()=>fixture(async({file})=>{
  const changed=JSON.parse(encodeRehearsalCheckSuite(suite));changed.expected[0].after.metrics.cash="0";await writeFile(file,JSON.stringify(changed));
  const result=await run([file]);assert.equal(result.code,2);assert.equal(result.errors,"");assert.equal(JSON.parse(result.output).rows[0].differences[0].actual,"1028000000");
}));
for(const [label,content]of[["invalid JSON","{"],["duplicate keys",'{"x":1,"x":2}'],["UTF8",new Uint8Array([255])],["size"," ".repeat(REHEARSAL_CHECK_SUITE_LIMIT+1)],["BOM","\ufeff{}"]])
  test(label+" exits one without partial output",()=>fixture(async({file})=>{await writeFile(file,content);const result=await run([file]);assert.equal(result.code,1);assert.equal(result.output,"");}));
test("invalid arguments, directory and missing file do not generate a report",()=>fixture(async({dir,file})=>{
  for(const args of[[],[file,file],["--unknown"],[dir],[join(dir,"missing.json")]]){const result=await run(args);assert.equal(result.code,1);assert.equal(result.output,"");}
}));
