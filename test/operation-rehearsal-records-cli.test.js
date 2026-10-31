import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve,dirname,basename } from "node:path";
import { inspectRehearsalRecords } from "../scripts/inspect-rehearsal-records.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA,REHEARSAL_WORKSPACE_LIMIT,encodeRehearsalWorkspace } from "../src/operation-rehearsal-workspace.js";
import { encodeRehearsalRecordReport,rehearsalRecordCsv } from "../src/operation-rehearsal-records.js";
const input={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers:[rehearsalExampleV2(),rehearsalExampleV2("EMA","loss")]};
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),"threecore-record-query-")),file=join(dir,"workspace.json");
  try{await writeFile(file,encodeRehearsalWorkspace(input));await fn({dir,file});}finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith("threecore-record-query-"));await rm(dir,{recursive:true});}}
async function run(args){let output="",errors="";const code=await inspectRehearsalRecords(args,{write:s=>{output+=s;}},{write:s=>{errors+=s;}});return{code,output,errors};}
test("offline query reproduces normalized browser export and preserves input",()=>fixture(async({file})=>{
  const result=await run([file,"--agent","EMA","--kind","settle","--decision","accepted","--search"," ONE "]);
  assert.equal(result.code,0);assert.equal(result.errors,"");assert.equal(result.output,encodeRehearsalRecordReport(input,{agent:"EMA",kind:"settle",decision:"accepted",search:"one"}));assert.equal(await readFile(file,"utf8"),encodeRehearsalWorkspace(input));
}));
test("no matches is a valid query result with original scope",()=>fixture(async({file})=>{
  const result=await run([file,"--search","missing"]);assert.equal(result.code,0);assert.equal(JSON.parse(result.output).matchedRecords,0);assert.equal(JSON.parse(result.output).totalRecords,4);
}));
test("unknown, duplicated or incomplete flags and invalid enums fail without output",()=>fixture(async({file})=>{
  for(const args of[[],[file,"--agent"],[file,"--agent","DAT","--agent","EMA"],[file,"--bad","x"],[file,"--kind","send"],[file,"--search","x".repeat(81)]]){const result=await run(args);assert.equal(result.code,1);assert.equal(result.output,"");}
}));
for(const [label,content]of[["bad JSON","{"],["invalid UTF8",new Uint8Array([255])],["oversize"," ".repeat(REHEARSAL_WORKSPACE_LIMIT+1)]])test(label+" cannot produce a partial query",()=>fixture(async({file})=>{
  await writeFile(file,content);const result=await run([file]);assert.equal(result.code,1);assert.equal(result.output,"");
}));
test("directory and missing input report failure without reading another source",()=>fixture(async({dir})=>{
  for(const file of[dir,join(dir,"missing.json")]){const result=await run([file]);assert.equal(result.code,1);assert.equal(result.output,"");}
}));

test("offline CSV reproduces the browser encoder with all four filters and unchanged source",()=>fixture(async({file})=>{
  const before=await readFile(file),result=await run([file,"--format","csv","--agent","EMA","--kind","settle","--decision","accepted","--search"," ONE "]);
  assert.equal(result.code,0);assert.equal(result.errors,"");assert.equal(result.output,rehearsalRecordCsv(input,{agent:"EMA",kind:"settle",decision:"accepted",search:"one"}));
  assert.deepEqual(await readFile(file),before);
}));
test("explicit JSON format is backward compatible and duplicate or unsupported formats fail",()=>fixture(async({file})=>{
  assert.equal((await run([file,"--format","json"])).output,encodeRehearsalRecordReport(input));
  for(const args of [[file,"--format","xml"],[file,"--format","CSV"],[file,"--format","csv","--format","json"],[file,"--format"]]){
    const result=await run(args);assert.equal(result.code,1);assert.equal(result.output,"");assert.match(result.errors,/CLI_ARGUMENTS/);
  }
}));
test("invalid CSV input produces no BOM, header or partial rows",()=>fixture(async({file})=>{
  await writeFile(file,"{");const result=await run([file,"--format","csv"]);assert.equal(result.code,1);assert.equal(result.output,"");
}));
