import test from "node:test";import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,readdir,rm,realpath} from "node:fs/promises";
import {tmpdir} from "node:os";import {join,dirname,resolve,basename} from "node:path";import {webcrypto} from "node:crypto";
import {newReportFixtures} from "./helpers/rehearsal-report-fixtures.js";
import {reviewRehearsalReport,encodeRehearsalReviewEvidence} from "../src/operation-rehearsal-report-review.js";
import {runRehearsalDifferenceQuery,parseRehearsalDifferenceQueryArgs} from "../scripts/query-rehearsal-differences.js";
async function run(args){let output="",errors="";const code=await runRehearsalDifferenceQuery(args,{write:s=>output+=s},{write:s=>errors+=s});return{code,output,errors};}
async function fixture(action){
 const root=await realpath(tmpdir()),dir=await mkdtemp(join(root,"threecore-difference-query-")),file=join(dir,"report.json"),evidenceFile=join(dir,"evidence.json");
 const report=structuredClone(newReportFixtures().filtered);report.totalRecords=99;
 for(let i=0;i<103;i++)report["extra"+String(i).padStart(3,"0")]=i;
 const text=JSON.stringify(report),evidence=JSON.parse(encodeRehearsalReviewEvidence(await reviewRehearsalReport(text,{subtle:webcrypto.subtle})));
 evidence.receipt.extra="receipt";evidence.receipt.differenceCount=17;const evidenceText=JSON.stringify(evidence);
 try{await writeFile(file,text);await writeFile(evidenceFile,evidenceText);await action({dir,file,evidenceFile,text,evidenceText});}
 finally{assert.equal(dirname(resolve(dir)),root);assert.ok(basename(dir).startsWith("threecore-difference-query-"));assert.equal(await realpath(dir),resolve(dir));await rm(dir,{recursive:true});}
}
test("offline query pages keep global indices and complete source outcome",()=>fixture(async({file,text,dir})=>{
 const before=await readdir(dir),indices=[];
 for(const page of [1,2,3]){
 const result=await run([file,"--kind","unexpected","--path","extra","--page",String(page)]);assert.equal(result.code,2);assert.equal(result.errors,"");
 const value=JSON.parse(result.output);assert.equal(value.totalDifferences,104);assert.equal(value.matchedDifferences,103);
 assert.equal(value.summary.matchesRecomputation,false);assert.equal(value.page,page);indices.push(...value.differences.map(d=>d.index));
 }
 assert.deepEqual(indices,Array.from({length:103},(_,i)=>i+1));assert.equal(await readFile(file,"utf8"),text);assert.deepEqual(await readdir(dir),before);
}));
test("offline no-match filters cannot turn a mismatched report into a success",()=>fixture(async({file})=>{
 const result=await run([file,"--path","absent"]);assert.equal(result.code,2);const value=JSON.parse(result.output);
 assert.equal(value.matchedDifferences,0);assert.equal(value.totalDifferences,104);assert.deepEqual(value.differences,[]);
 assert.equal(value.summary.matchesRecomputation,false);
}));
test("offline evidence filtering keeps receipt and source totals separate",()=>fixture(async({evidenceFile,evidenceText})=>{
 for(const [kind,total,matched]of [["receipt",2,1],["source",104,103]]){
 const result=await run([evidenceFile,"--evidence",kind,"--kind","unexpected","--path","extra"]);assert.equal(result.code,2);
 const value=JSON.parse(result.output);assert.equal(value.totalDifferences,total);assert.equal(value.matchedDifferences,matched);
 assert.equal(value.target,"evidence-"+kind);assert.equal(value.summary.matchesReceipt,false);assert.equal(value.summary.matchesRecomputation,false);
 }
 assert.equal(await readFile(evidenceFile,"utf8"),evidenceText);
}));
test("query arguments reject duplicates, bad values and out-of-range pages without partial output",()=>fixture(async({file})=>{
 for(const args of [[],["--bad"],[file,"--path"],[file,"--kind","bad"],[file,"--page","0"],[file,"--page","01"],
 [file,"--page","4"],[file,"--evidence","bad"],[file,"--path","x","--path","y"],[file,"--restore","true"],
 [file,"--path","absent","--page","2"],[file,"--path","x".repeat(129)],[file,"--path","x\n"]]){
 const result=await run(args);assert.equal(result.code,1);assert.equal(result.output,"");assert.notEqual(result.errors,"");
 }
}));
test("query defaults and help are explicit without requiring a file",async()=>{
 assert.deepEqual(parseRehearsalDifferenceQueryArgs(["report.json"]),{file:"report.json",page:1,evidence:null,query:{path:"",kind:"all"}});
 assert.deepEqual(parseRehearsalDifferenceQueryArgs(["report.json","--path","  /rows  "]).query,{path:"/rows",kind:"all"});
 const result=await run(["--help"]);assert.equal(result.code,0);assert.equal(result.errors,"");assert.match(result.output,/--path.*--kind.*--page/);
});
test("a consistent failed expectation remains visible under an empty difference filter",()=>fixture(async({file})=>{
 await writeFile(file,JSON.stringify(newReportFixtures().differing));
 const result=await run([file,"--kind","value"]);assert.equal(result.code,0);const value=JSON.parse(result.output);
 assert.equal(value.totalDifferences,0);assert.equal(value.matchedDifferences,0);assert.equal(value.summary.reportOutcome.allMatched,false);
}));

import {encodeRehearsalDifferenceQuery,reviewRehearsalEvidence} from "../src/operation-rehearsal-report-review.js";
test("offline all mode saves byte-identical complete core output for every target without changing inputs",()=>fixture(async({file,evidenceFile,text,evidenceText,dir})=>{
 const before=await readdir(dir),report=await reviewRehearsalReport(text,{subtle:webcrypto.subtle}),evidence=await reviewRehearsalEvidence(evidenceText,{subtle:webcrypto.subtle});
 for(const [path,review,target,flags]of [[file,report,"report",[]],[evidenceFile,evidence,"evidence-receipt",["--evidence","receipt"]],[evidenceFile,evidence,"evidence-source",["--evidence","source"]]]){
 const result=await run([path,"--all","--kind","unexpected","--path","extra",...flags]);assert.equal(result.code,2);assert.equal(result.errors,"");
 assert.equal(result.output,encodeRehearsalDifferenceQuery(review,{path:"extra",kind:"unexpected"},target));
 }
 assert.equal(await readFile(file,"utf8"),text);assert.equal(await readFile(evidenceFile,"utf8"),evidenceText);assert.deepEqual(await readdir(dir),before);
}));
test("all mode rejects duplicate, partial, or conflicting flags without partial output",()=>fixture(async({file})=>{
 for(const args of [[file,"--all","--all"],[file,"--all","--page","1"],[file,"--page","1","--all"],[file,"--all","--path"],[file,"--all","false"],[file,"--all","--unknown"]]){
 const result=await run(args);assert.equal(result.code,1);assert.equal(result.output,"");assert.notEqual(result.errors,"");
 }
 const result=await run([file,"--path","absent","--all"]);assert.equal(result.code,2);const value=JSON.parse(result.output);
 assert.equal(value.totalDifferences,104);assert.equal(value.matchedDifferences,0);assert.equal(value.allMatchingDifferencesIncluded,true);
 await writeFile(file,JSON.stringify(newReportFixtures().differing));const failed=await run([file,"--all"]);
 assert.equal(failed.code,0);assert.equal(JSON.parse(failed.output).summary.reportOutcome.allMatched,false);
}));
