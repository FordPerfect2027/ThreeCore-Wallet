import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { encodeRehearsal, decodeRehearsal } from "../src/operation-rehearsal.js";
import { createRehearsalWorkspace, encodeRehearsalWorkspace, decodeRehearsalWorkspace } from "../src/operation-rehearsal-workspace.js";
import { readRehearsalInputFile, runRehearsalCheck } from "../scripts/check-rehearsal.js";
import { runRehearsalCompare } from "../scripts/compare-rehearsal-workspaces.js";
import { runRehearsalScenario } from "../scripts/compare-rehearsal-scenarios.js";
import { runRehearsalOverview } from "../scripts/summarize-rehearsal-workspace.js";

const ledger=encodeRehearsal(rehearsalExampleV2());
const store=createRehearsalWorkspace();store.reset(rehearsalExampleV2());
const workspace=encodeRehearsalWorkspace(store.snapshot());store.dispose();
async function fixture(run) {
  const dir=await mkdtemp(join(tmpdir(),"threecore-rehearsal-encoding-")),file=join(dir,"input.json"),good=join(dir,"good.json");
  try { await run({file,good}); }
  finally {
    assert.equal(dirname(resolve(dir)),resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("threecore-rehearsal-encoding-"));
    await rm(dir,{recursive:true});
  }
}
for(const isWorkspace of [false,true]) {
  test(`strict browser and offline ${isWorkspace?"workspace":"ledger"} readers reject identical BOM bytes`,()=>fixture(async({file})=>{
    const text="\ufeff"+(isWorkspace?workspace:ledger);
    const digest=createHash("sha256").update(text).digest("hex");await writeFile(file,text);
    assert.throws(()=>(isWorkspace?decodeRehearsalWorkspace:decodeRehearsal)(text),{code:"INVALID_JSON"});
    await assert.rejects(readRehearsalInputFile(file,digest,isWorkspace),{code:"INVALID_JSON"});
  }));
  test(`offline ${isWorkspace?"workspace":"ledger"} hash still covers exact CRLF bytes`,()=>fixture(async({file})=>{
    const text=(isWorkspace?workspace:ledger).replaceAll("\n","\r\n");await writeFile(file,text);
    const digest=createHash("sha256").update(text).digest("hex");
    const result=await readRehearsalInputFile(file,digest,isWorkspace);
    assert.equal(result.sha256,digest);assert.equal(result.byteLength,Buffer.byteLength(text));
    assert.equal(result.expectedChecksumMatched,true);
  }));
}
for(const command of ["ledger-check","workspace-check","workspace-compare","scenario-compare","overview"]) {
  test(command+" emits no report for a BOM-prefixed file",()=>fixture(async({file,good})=>{
    const isWorkspace=!['ledger-check','scenario-compare'].includes(command),text=isWorkspace?workspace:ledger;
    await writeFile(file,"\ufeff"+text);await writeFile(good,text);
    let output="",errors="";
    const out={write:value=>{output+=value;}},err={write:value=>{errors+=value;}};
    const result=command==="ledger-check"?await runRehearsalCheck([file,"--json"],out,err)
      :command==="workspace-check"?await runRehearsalCheck([file,"--workspace","--json"],out,err)
      :command==="workspace-compare"?await runRehearsalCompare([good,file,"--json"],out,err)
      :command==="scenario-compare"?await runRehearsalScenario([good,file],out,err)
      :await runRehearsalOverview([file],out,err);
    assert.equal(result,1);assert.equal(output,"");assert.match(errors,/INVALID_JSON/);
  }));
}
