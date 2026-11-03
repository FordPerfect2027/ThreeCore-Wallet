import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { runRehearsalCompare, parseRehearsalCompareArgs } from "../scripts/compare-rehearsal-workspaces.js";
import { encodeRehearsalComparison } from "../src/operation-rehearsal-comparison.js";
import { encodeRehearsalWorkspace, REHEARSAL_WORKSPACE_SCHEMA, REHEARSAL_WORKSPACE_LIMIT } from "../src/operation-rehearsal-workspace.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
const pack = ledger => ({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers:[ledger]});
async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), "threecore-comparison-"));
  const before = pack(rehearsalExampleV2()), after = pack(rehearsalExampleV2("DAT", "loss"));
  const left = join(dir,"before.json"), right = join(dir,"after.json");
  try { await writeFile(left, encodeRehearsalWorkspace(before)); await writeFile(right, encodeRehearsalWorkspace(after));
    await run({dir,left,right,before,after}); }
  finally { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith("threecore-comparison-")); await rm(dir,{recursive:true}); }
}
test("offline comparison matches the browser encoder exactly and does not modify inputs", () => fixture(async ({left,right,before,after}) => {
  let output="", errors=""; const stdout={write:s=>{output+=s}}, stderr={write:s=>{errors+=s}};
  assert.equal(await runRehearsalCompare([left,right,"--json"],stdout,stderr),0);
  assert.equal(errors,""); assert.equal(output,encodeRehearsalComparison(before,after));
  assert.equal(await readFile(left,"utf8"),encodeRehearsalWorkspace(before));
  assert.equal(await readFile(right,"utf8"),encodeRehearsalWorkspace(after));
  assert.equal(JSON.parse(output).rows[0].action,"replaced");
}));
test("text comparison prints checksums and distinguishes completion from equality or authority", () => fixture(async ({left,right}) => {
  let output=""; const stream={write:s=>{output+=s}};
  assert.equal(await runRehearsalCompare([left,right],stream,stream),0);
  assert.match(output,/Before SHA-256: [a-f0-9]{64}/); assert.match(output,/DAT: replaced/);
  assert.match(output,/not that inputs are equal/);
}));
for (const [name,content] of [["invalid JSON","{"],["duplicate keys",'{"x":1,"x":2}'],
  ["invalid UTF-8",new Uint8Array([255])],["oversized"," ".repeat(REHEARSAL_WORKSPACE_LIMIT+1)]])
  test(name+" second input produces no partial comparison",()=>fixture(async ({left,right})=>{
    await writeFile(right,content); let output="",errors="";
    assert.equal(await runRehearsalCompare([left,right,"--json"],{write:s=>{output+=s}},{write:s=>{errors+=s}}),1);
    assert.equal(output,""); assert.match(errors,/comparison failed/);
  }));
test("directories and missing inputs fail before emitting a comparison",()=>fixture(async ({dir,left})=>{
  let output=""; const stream={write:s=>{output+=s}};
  assert.equal(await runRehearsalCompare([left,dir],stream,stream),1);
  assert.equal(await runRehearsalCompare([join(dir,"missing.json"),left],stream,stream),1);
  assert.doesNotMatch(output,/"rows"/);
}));
for (const args of [[],["a"],["a","b","c"],["a","b","--json","--json"],["--unknown","b"],["a","b","--workspace"],["a",""]])
  test("rejects comparison arguments "+JSON.stringify(args),()=>assert.throws(()=>parseRehearsalCompareArgs(args),{code:"CLI_ARGUMENTS"}));
