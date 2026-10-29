import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { runRehearsalScenario } from "../scripts/compare-rehearsal-scenarios.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { encodeRehearsal, REHEARSAL_LIMIT } from "../src/operation-rehearsal.js";
import { buildRehearsalScenario, rehearsalScenarioParameters, encodeRehearsalScenario } from "../src/operation-rehearsal-scenario.js";
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),"threecore-scenario-")), left=join(dir,"before.json"), right=join(dir,"after.json");
  const before=rehearsalExampleV2(), after=buildRehearsalScenario(before,{...rehearsalScenarioParameters(before),maxPerOperation:"50000000"});
  try { await writeFile(left,encodeRehearsal(before)); await writeFile(right,encodeRehearsal(after)); await run({dir,left,right,before,after}); }
  finally { assert.equal(dirname(resolve(dir)),resolve(tmpdir())); assert.ok(basename(dir).startsWith("threecore-scenario-")); await rm(dir,{recursive:true}); }
}
async function run(args) { let output="",errors="";
  const code=await runRehearsalScenario(args,{write:s=>{output+=s}},{write:s=>{errors+=s}}); return {code,output,errors}; }
test("offline scenario exactly matches browser encoder and leaves files unchanged",()=>fixture(async({left,right,before,after})=>{
  const result=await run([left,right]); assert.equal(result.code,0); assert.equal(result.errors,"");
  assert.equal(result.output,encodeRehearsalScenario(before,after));
  assert.equal(await readFile(left,"utf8"),encodeRehearsal(before)); assert.equal(await readFile(right,"utf8"),encodeRehearsal(after));
  assert.equal(JSON.parse(result.output).summary.newlyRejected,2);
}));
for (const [name,content] of [["invalid JSON","{"],["duplicate keys",'{"x":1,"x":2}'],
  ["invalid UTF-8",new Uint8Array([255])],["oversized"," ".repeat(REHEARSAL_LIMIT+1)]])
  test(name+" second file produces no partial comparison",()=>fixture(async({left,right})=>{
    await writeFile(right,content); const result=await run([left,right]); assert.equal(result.code,1); assert.equal(result.output,"");
  }));
test("changed context or events are rejected offline",()=>fixture(async({left,right,before})=>{
  await writeFile(right,encodeRehearsal({...before,account:"0x"+"9".repeat(40)}));
  const result=await run([left,right]); assert.equal(result.code,1); assert.equal(result.output,"");
  assert.match(result.errors,/SCENARIO_CONTEXT_OR_EVENTS_CHANGED/);
}));
test("missing files, directory and invalid arguments produce no report",()=>fixture(async({dir,left})=>{
  for(const args of [[],[left],[left,left,"--json"],["--unknown",left],[left,dir],[left,join(dir,"absent.json")]]) {
    const result=await run(args); assert.equal(result.code,1); assert.equal(result.output,"");
  }
}));
