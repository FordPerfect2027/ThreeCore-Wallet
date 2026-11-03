import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { runRehearsalOverview } from "../scripts/summarize-rehearsal-workspace.js";
import { encodeRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { encodeRehearsalWorkspace, REHEARSAL_WORKSPACE_SCHEMA, REHEARSAL_WORKSPACE_LIMIT } from "../src/operation-rehearsal-workspace.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),"threecore-overview-")), path=join(dir,"input.json");
  const input={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers:[rehearsalExampleV2("DAT","limit")]};
  try { await writeFile(path,encodeRehearsalWorkspace(input)); await run({dir,path,input}); }
  finally { assert.equal(dirname(resolve(dir)),resolve(tmpdir())); assert.ok(basename(dir).startsWith("threecore-overview-")); await rm(dir,{recursive:true}); }
}
async function run(args) {
  let output="",errors=""; const code=await runRehearsalOverview(args,{write:s=>{output+=s}},{write:s=>{errors+=s}});
  return {code,output,errors};
}
test("offline output exactly matches browser export; rejected records do not imply CLI failure or authority",()=>fixture(async({path,input})=>{
  const result=await run([path]); assert.equal(result.code,0); assert.equal(result.errors,"");
  assert.equal(result.output,encodeRehearsalOverview(input));
  assert.equal(await readFile(path,"utf8"),encodeRehearsalWorkspace(input));
  const report=JSON.parse(result.output); assert.ok(report.rows[0].rejectedRecords>0); assert.equal(report.authorizesExecution,false);
}));
for(const [name,content] of [["invalid JSON","{"],["invalid UTF-8",new Uint8Array([255])],
  ["oversized"," ".repeat(REHEARSAL_WORKSPACE_LIMIT+1)],["duplicate keys",'{"x":1,"x":2}']])
  test(name+" produces no partial report",()=>fixture(async({path})=>{
    await writeFile(path,content); const result=await run([path]); assert.equal(result.code,1); assert.equal(result.output,"");
  }));
test("missing and directory inputs fail without report output",()=>fixture(async({dir})=>{
  for(const path of [dir,join(dir,"absent.json")]) { const result=await run([path]); assert.equal(result.code,1); assert.equal(result.output,""); }
}));
test("overview files cannot accidentally be treated as workspace inputs",()=>fixture(async({path,input})=>{
  await writeFile(path,encodeRehearsalOverview(input)); const result=await run([path]); assert.equal(result.code,1); assert.equal(result.output,"");
}));
test("bad arguments fail before accessing a file",async()=>{
  for(const args of [[],["a","b"],["--unknown"],[""],[null]]) {
    const result=await run(args); assert.equal(result.code,1); assert.equal(result.output,""); assert.match(result.errors,/CLI_ARGUMENTS/);
  }
});
