import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {runCheckReview,parseCheckReviewArgs} from "../scripts/verify-report-checks.js";
import {prepareReportSetFile} from "../src/report-set-file.js";
import {prepareReportSetChecksFile} from "../src/report-set-export.js";
import {sequenceSet,sequenceHistory} from "./helpers/report-set-fixtures.js";
async function files(t){
 const prefix=join(tmpdir(),"threecore-check-review-"),folder=await mkdtemp(prefix);
 t.after(async()=>{assert.ok(resolve(folder).startsWith(resolve(prefix)));await rm(folder,{recursive:true,force:true});});
 const input=sequenceSet(sequenceHistory([0n,0n])),sourceText=(await prepareReportSetFile(input)).text,detailsText=(await prepareReportSetChecksFile(input)).text;
 const source=join(folder,"source.json"),details=join(folder,"details.json");await writeFile(source,sourceText);await writeFile(details,detailsText);
 return{folder,source,details,sourceText,detailsText};
}
async function run(args){let output="",errors="";const exitCode=await runCheckReview(args,{stdout:{write(v){output+=v;}},stderr:{write(v){errors+=v;}}});return{exitCode,output,errors};}
test("review CLI requires two explicit JSON files and rejects ambiguous options",async()=>{
 assert.deepEqual(parseCheckReviewArgs(["a.json","b.JSON","--json"]),{source:"a.json",details:"b.JSON",json:true});
 for(const args of [[],["a.json"],["a.csv","b.json"],["a.json","b.json","--other"],["a.json","b.json","--json","--json"],["-a.json","b.json"]]){
  assert.throws(()=>parseCheckReviewArgs(args));const result=await run(args);assert.equal(result.exitCode,1);assert.equal(result.output,"");
 }
 const help=await run(["--help"]);assert.equal(help.exitCode,0);assert.match(help.output,/No network or file writes/);
});
test("review CLI verifies standalone output and leaves both source and details untouched",async t=>{
 const f=await files(t),result=await run([f.source,f.details,"--json"]);assert.equal(result.exitCode,0);assert.equal(result.errors,"");
 const data=JSON.parse(result.output);assert.equal(data.matchesRecomputation,true);assert.equal(data.sourceChecksumVerified,true);assert.equal(data.summary.allContinuous,false);
 const child=spawnSync(process.execPath,["scripts/verify-report-checks.js",f.source,f.details,"--json"],{cwd:fileURLToPath(new URL("../",import.meta.url)),encoding:"utf8",timeout:15000});
 assert.equal(child.error,undefined);assert.equal(child.status,0);assert.equal(child.stdout,result.output);assert.equal(child.stderr,"");
 assert.equal(await readFile(f.source,"utf8"),f.sourceText);assert.equal(await readFile(f.details,"utf8"),f.detailsText);
});
test("well-formed altered details produce difference exit 2 and recalculated counts",async t=>{
 const f=await files(t),data=JSON.parse(f.detailsText);data.items=[];data.matched=0;await writeFile(f.details,JSON.stringify(data));
 const result=await run([f.source,f.details,"--json"]);assert.equal(result.exitCode,2);assert.equal(result.errors,"");
 const review=JSON.parse(result.output);assert.equal(review.matchesRecomputation,false);assert.ok(review.matched>0);assert.ok(review.differences.includes("items"));
 const plain=await run([f.source,f.details]);assert.equal(plain.exitCode,2);assert.match(plain.output,/DIFFERENCES/);
});
test("a source checksum failure is rejected before checklist conclusions can be emitted",async t=>{
 const f=await files(t),data=JSON.parse(f.sourceText);data.digest="0".repeat(64);await writeFile(f.source,JSON.stringify(data));
 const result=await run([f.source,f.details]);assert.equal(result.exitCode,1);assert.equal(result.output,"");assert.match(result.errors,/CHECKSUM/);
});
test("wrong file kinds, invalid UTF-8 and missing paths fail without exposing path contents",async t=>{
 const f=await files(t);
 for(const args of [[f.details,f.source],[f.source,f.source],[f.source,join(f.folder,"PRIVATE_PATH.json")]]){
  const result=await run(args);assert.equal(result.exitCode,1);assert.equal(result.output,"");assert.doesNotMatch(result.errors,/PRIVATE_PATH/);assert.ok(!result.errors.includes(f.folder));
 }
 await writeFile(f.details,new Uint8Array([0xc3,0x28]));const invalid=await run([f.source,f.details]);assert.equal(invalid.exitCode,1);assert.equal(invalid.output,"");
});
