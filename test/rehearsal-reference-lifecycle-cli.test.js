import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {join,resolve,dirname,basename} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {rehearsalExampleV2} from "../src/operation-rehearsal-examples.js";
import {REHEARSAL_WORKSPACE_SCHEMA,encodeRehearsalWorkspace} from "../src/operation-rehearsal-workspace.js";
import {encodeRehearsalReferenceReport} from "../src/operation-rehearsal-records.js";
import {inspectRehearsalReference} from "../scripts/inspect-rehearsal-reference.js";
test("reference CLI reproduces selected-agent summary, verifies it offline and preserves workspace bytes",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"threecore-reference-")),path=join(directory,"workspace.json"),reportPath=join(directory,"report.json");
  const input={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers:[rehearsalExampleV2(),rehearsalExampleV2("EMA","pending")]},text=encodeRehearsalWorkspace(input);
  try{
    await writeFile(path,text);const run=spawnSync(process.execPath,["scripts/inspect-rehearsal-reference.js",path,"EMA:open-one"],{cwd:new URL("../",import.meta.url),encoding:"utf8",timeout:20000});
    assert.equal(run.status,0,run.stderr);assert.equal(run.stdout,encodeRehearsalReferenceReport(input,"EMA:open-one"));await writeFile(reportPath,run.stdout);
    const verified=spawnSync(process.execPath,["scripts/verify-rehearsal-report.js",reportPath],{cwd:new URL("../",import.meta.url),encoding:"utf8",timeout:20000});
    assert.equal(verified.status,0,verified.stderr);assert.equal(JSON.parse(verified.stdout).reportOutcome.summary.phase,"open");assert.equal(await readFile(path,"utf8"),text);
  }finally{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith("threecore-reference-"));await rm(directory,{recursive:true,force:true});}
});
test("reference CLI refuses invalid destinations and does not expose missing-file paths",async()=>{
  for(const args of [[],["workspace.json"],["PRIVATE_MISSING.json","DAT:open-one"],["--restore","DAT:open-one"],["a.txt","DAT:open-one"]]){
    let out="",err="";const code=await inspectRehearsalReference(args,{write:value=>{out+=value;}},{write:value=>{err+=value;}});
    assert.equal(code,1);assert.equal(out,"");assert.doesNotMatch(err,/PRIVATE_MISSING/);
  }
});
