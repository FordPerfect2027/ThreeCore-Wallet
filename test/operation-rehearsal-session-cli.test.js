import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve,dirname,basename } from "node:path";
import { createHash } from "node:crypto";
import { checkRehearsalSession } from "../scripts/check-rehearsal-session.js";
import { createRehearsalSession,encodeRehearsalSession,REHEARSAL_SESSION_LIMIT } from "../src/operation-rehearsal-session.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
const session=createRehearsalSession();session.workspace.reset(rehearsalExampleV2());const text=encodeRehearsalSession(session.snapshot());
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),"threecore-session-")),file=join(dir,"session.json");try{await writeFile(file,text);await fn({dir,file});}finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith("threecore-session-"));await rm(dir,{recursive:true});}}
async function run(args){let output="",errors="";const code=await checkRehearsalSession(args,{write:s=>{output+=s;}},{write:s=>{errors+=s;}});return{code,output,errors};}
test("offline inspection reports scope and hashes exact input without rewriting it",()=>fixture(async({file})=>{
  const result=await run([file]),report=JSON.parse(result.output);assert.equal(result.code,0);assert.equal(result.errors,"");assert.equal(report.sha256,createHash("sha256").update(text).digest("hex"));assert.equal(report.workspace[0].recordCount,2);assert.equal(report.workspace[1].recordCount,null);assert.equal(report.cases.length,0);assert.equal(report.authorizesExecution,false);assert.equal(await readFile(file,"utf8"),text);
}));
for(const [label,content]of[["invalid JSON","{"],["invalid UTF8",new Uint8Array([255])],["oversize"," ".repeat(REHEARSAL_SESSION_LIMIT+1)],["duplicate keys",'{"a":1,"a":2}']])test(label+" cannot produce partial inspection",()=>fixture(async({file})=>{
  await writeFile(file,content);const result=await run([file]);assert.equal(result.code,1);assert.equal(result.output,"");
}));
test("missing paths, directories and invalid arguments produce no report",()=>fixture(async({dir,file})=>{
  for(const args of[[],[file,file],["--json"],[dir],[join(dir,"missing.json")]]){const result=await run(args);assert.equal(result.code,1);assert.equal(result.output,"");}
}));
