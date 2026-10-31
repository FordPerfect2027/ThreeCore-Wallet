import test from "node:test";import assert from "node:assert/strict";import {webcrypto} from "node:crypto";
import {newReportFixtures} from "./helpers/rehearsal-report-fixtures.js";
import {reviewRehearsalReport,reviewRehearsalEvidence,encodeRehearsalReviewEvidence,encodeRehearsalReviewReceipt,
 queryReviewedRehearsalDifferences,queryRehearsalEvidenceReceiptDifferences,validateRehearsalDifferenceQuery,
 inspectReviewedRehearsalDifference} from "../src/operation-rehearsal-report-review.js";
const original=newReportFixtures().filtered,changed=structuredClone(original);changed.totalRecords=99;delete changed.matchedRecords;
for(let i=0;i<103;i++)changed["extra"+String(i).padStart(3,"0")]=i;
const receipt=await reviewRehearsalReport(JSON.stringify(changed),{subtle:webcrypto.subtle});
test("difference filters retain all totals and original detail indices through pages",()=>{
 const before=encodeRehearsalReviewReceipt(receipt),query={kind:"unexpected",path:"extra"};
 const pages=[0,40,80].map(offset=>queryReviewedRehearsalDifferences(receipt,query,offset));
 assert.deepEqual(pages.map(page=>page.differences.length),[40,40,23]);
 assert.ok(pages.every(page=>page.totalDifferences===105&&page.matchedDifferences===103));
 const rows=pages.flatMap(page=>page.differences);assert.equal(new Set(rows.map(row=>row.index)).size,103);
 for(const row of rows)assert.equal(inspectReviewedRehearsalDifference(receipt,row.index).path,row.path);
 assert.equal(encodeRehearsalReviewReceipt(receipt),before);
});
test("literal case-sensitive path matches and zero matches cannot hide a global discrepancy",()=>{
 const selected=queryReviewedRehearsalDifferences(receipt,{kind:"all",path:"extra10"});
 assert.equal(selected.matchedDifferences,3);assert.deepEqual(selected.differences.map(d=>d.path),["/extra100","/extra101","/extra102"]);
 const empty=queryReviewedRehearsalDifferences(receipt,{kind:"all",path:"EXTRA"},999);
 assert.equal(empty.matchedDifferences,0);assert.equal(empty.totalDifferences,105);assert.equal(empty.page,1);
 assert.equal(empty.hasPrevious,false);assert.equal(empty.hasNext,false);assert.equal(receipt.matchesRecomputation,false);
});
test("kind filters never change or merge discrepancy classes",()=>{
 for(const [kind,count]of [["value",1],["missing",1],["unexpected",103],["type",0],["array-length",0]]){
 const result=queryReviewedRehearsalDifferences(receipt,{kind,path:""});
 assert.equal(result.matchedDifferences,count);assert.ok(result.differences.every(row=>row.kind===kind));
 }
});
test("query paging normalizes offsets, clamps overflow, and returns immutable metadata",()=>{
 const query={kind:"unexpected",path:"extra"},result=queryReviewedRehearsalDifferences(receipt,query,Number.MAX_SAFE_INTEGER);
 assert.equal(result.offset,80);assert.equal(result.page,3);assert.equal(queryReviewedRehearsalDifferences(receipt,query,41).offset,40);
 assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.query)&&Object.isFrozen(result.differences)&&Object.isFrozen(result.differences[0]));
 for(const offset of [-1,0.5,NaN,Infinity,"0",null,{}])assert.throws(()=>queryReviewedRehearsalDifferences(receipt,query,offset),{code:"INVALID_REVIEW_DIFFERENCE_OFFSET"});
});
test("query capture rejects extra fields and accessors without coercion",()=>{
 let reads=0;const getter={kind:"all",get path(){reads++;return "";}};
 for(const query of [null,{},[],{kind:"unknown",path:""},{kind:"all",path:"x".repeat(129)},{kind:"all",path:"a\nb"},{kind:"all",path:"\u202e"},{kind:"all",path:0},{kind:"all",path:"",extra:true},getter])
 assert.throws(()=>validateRehearsalDifferenceQuery(query),{code:"INVALID_REVIEW_DIFFERENCE_QUERY"});
 assert.equal(reads,0);assert.deepEqual(validateRehearsalDifferenceQuery({kind:"value",path:"  /totalRecords  "}),{kind:"value",path:"/totalRecords"});
});
test("evidence receipt filtering remains separate from its source discrepancies",async()=>{
 const evidence=JSON.parse(encodeRehearsalReviewEvidence(receipt));evidence.receipt.differenceCount=77;evidence.receipt.extra="receipt";
 const verified=await reviewRehearsalEvidence(JSON.stringify(evidence),{subtle:webcrypto.subtle});
 const result=queryRehearsalEvidenceReceiptDifferences(verified,{kind:"unexpected",path:"extra"});
 assert.equal(result.totalDifferences,2);assert.equal(result.matchedDifferences,1);assert.equal(result.differences[0].path,"/extra");
 assert.equal(queryReviewedRehearsalDifferences(verified.reportReview).totalDifferences,105);
 for(const copy of [null,{},JSON.parse(JSON.stringify(verified))])assert.throws(()=>queryRehearsalEvidenceReceiptDifferences(copy),{code:"UNRECOGNIZED_EVIDENCE_REVIEW"});
});
test("zero-difference source keeps one empty page and foreign review identities are rejected",async()=>{
 const good=await reviewRehearsalReport(JSON.stringify(original),{subtle:webcrypto.subtle}),page=queryReviewedRehearsalDifferences(good);
 assert.equal(page.totalDifferences,0);assert.equal(page.matchedDifferences,0);assert.equal(page.totalPages,1);
 for(const copy of [null,{},JSON.parse(JSON.stringify(receipt))])assert.throws(()=>queryReviewedRehearsalDifferences(copy),{code:"UNRECOGNIZED_REVIEW_RECEIPT"});
});
