import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { newReportFixtures } from "./helpers/rehearsal-report-fixtures.js";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
import { reportRehearsalOverview } from "../src/operation-rehearsal-overview.js";
import { compareRehearsalWorkspaces } from "../src/operation-rehearsal-comparison.js";
import { compareRehearsalScenario, buildRehearsalScenario, rehearsalScenarioParameters } from "../src/operation-rehearsal-scenario.js";
import { reviewRehearsalReport, encodeRehearsalReviewReceipt, REHEARSAL_REPORT_REVIEW_LIMIT } from "../src/operation-rehearsal-report-review.js";
const pack = (...ledgers) => ({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers});
const before=rehearsalExampleV2(), after=buildRehearsalScenario(before,{...rehearsalScenarioParameters(before),maxPerOperation:"50000000"});
const reports=[reportRehearsalOverview(pack(before,rehearsalExampleV2("CAWELON","pending"))),
  compareRehearsalWorkspaces(pack(before),pack(after)),compareRehearsalScenario(before,after)];
const review=(text,options={})=>reviewRehearsalReport(text,{subtle:webcrypto.subtle,...options});
for(const report of reports) test("recomputes supported report "+report.schema,async()=>{
  const text=JSON.stringify(report,null,2)+"\n", result=await review(text);
  assert.equal(result.matchesRecomputation,true); assert.equal(result.differenceCount,0);
  assert.equal(result.sha256,createHash("sha256").update(text).digest("hex"));
  assert.equal(result.byteLength,Buffer.byteLength(text)); assert.equal(result.checksumMatches,null);
  assert.equal(result.sourceVerified,false); assert.equal(result.authorizesExecution,false);
  assert.ok(Object.isFrozen(result.scope[0])); assert.equal(JSON.parse(encodeRehearsalReviewReceipt(result)).sha256,result.sha256);
});
test("derived value and authority-flag tampering is reported without believing the flag",async()=>{
  const report=JSON.parse(JSON.stringify(reports[2])); report.metrics[0].after="1"; report.sourceVerified=true;
  const result=await review(JSON.stringify(report)); assert.equal(result.matchesRecomputation,false);
  assert.equal(result.differenceCount,2); assert.deepEqual(result.differences.map(row=>row.path),["/sourceVerified","/metrics/0/after"]);
  assert.equal(result.sourceVerified,false);
});
test("overview and restore reports are independently recomputed",async()=>{
  const overview=JSON.parse(JSON.stringify(reports[0])); overview.rows[0].recordCount=999;
  assert.equal((await review(JSON.stringify(overview))).matchesRecomputation,false);
  const comparison=JSON.parse(JSON.stringify(reports[1])); comparison.rows[0].after.amounts.cash="1";
  assert.equal((await review(JSON.stringify(comparison))).matchesRecomputation,false);
});
test("JSON property order and whitespace do not affect content agreement but do affect exact text hash",async()=>{
  const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==="object"
    ?Object.fromEntries(Object.entries(value).reverse().map(([key,item])=>[key,reorder(item)])):value;
  const first=await review(JSON.stringify(reports[2])), second=await review(JSON.stringify(reorder(reports[2]),null,2));
  assert.equal(second.matchesRecomputation,true); assert.notEqual(first.sha256,second.sha256);
});
test("array order remains significant",async()=>{
  const report=JSON.parse(JSON.stringify(reports[2])); report.metrics.reverse();
  const result=await review(JSON.stringify(report)); assert.equal(result.matchesRecomputation,false);
});
test("expected checksum agreement and disagreement are independent of recomputation",async()=>{
  const text=JSON.stringify(reports[0]), hash=createHash("sha256").update(text).digest("hex");
  assert.equal((await review(text,{expectedSha256:hash.toUpperCase()})).checksumMatches,true);
  const result=await review(text,{expectedSha256:"0".repeat(64)});
  assert.equal(result.matchesRecomputation,true); assert.equal(result.checksumMatches,false);
  await assert.rejects(review(text,{expectedSha256:"short"}),{code:"INVALID_EXPECTED_CHECKSUM"});
});
test("unknown, missing and type-mismatched result fields have bounded precise paths",async()=>{
  const report=JSON.parse(JSON.stringify(reports[0])); report["odd/name~"]="x";
  delete report.rows[0].recordCount; report.rows[1].present="false";
  const result=await review(JSON.stringify(report));
  assert.ok(result.differences.some(row=>row.path==="/odd~1name~0"&&row.kind==="unexpected"));
  assert.ok(result.differences.some(row=>row.path==="/rows/0/recordCount"&&row.kind==="missing"));
  assert.ok(result.differences.some(row=>row.path==="/rows/1/present"&&row.kind==="type"));
});
test("difference list truncates at forty locations while retaining total mismatch count",async()=>{
  const report=JSON.parse(JSON.stringify(reports[2])); for(let i=0;i<80;i++) report["extra"+i]=i;
  const result=await review(JSON.stringify(report)); assert.equal(result.differenceCount,80);
  assert.equal(result.differences.length,40); assert.equal(result.differencesTruncated,true);
});
test("a self-consistent changed report does not authenticate its source",async()=>{
  const source={...before,account:"0x"+"9".repeat(40)};
  const report=reportRehearsalOverview(pack(source)); const result=await review(JSON.stringify(report));
  assert.equal(result.matchesRecomputation,true); assert.equal(result.sourceVerified,false);
});
test("context-changing condition comparisons cannot be reviewed as a valid replay",async()=>{
  const report=JSON.parse(JSON.stringify(reports[2])); report.inputs.after.account="0x"+"9".repeat(40);
  await assert.rejects(review(JSON.stringify(report)),{code:"SCENARIO_CONTEXT_OR_EVENTS_CHANGED"});
});
test("malformed, duplicate-key, unsafe, excessively deep and oversized inputs fail boundedly",async()=>{
  for(const text of ["", "{", '{"schema":"x","schema":"y"}', '{"__proto__":{}}',
    "[".repeat(25)+"0"+"]".repeat(25), " ".repeat(REHEARSAL_REPORT_REVIEW_LIMIT+1)])
    await assert.rejects(review(text),{code:"INVALID_REVIEW_REPORT"});
  await assert.rejects(review(JSON.stringify(pack(before))),{code:"UNSUPPORTED_REVIEW_REPORT"});
});
test("hash failure produces no success receipt",async()=>{
  const text=JSON.stringify(reports[0]);
  for(const subtle of [null,{}, {digest:async()=>{throw new Error("unavailable");}}, {digest:async()=>new Uint8Array(1)}])
    await assert.rejects(review(text,{subtle}),{code:"REVIEW_HASH_UNAVAILABLE"});
});
test("uncreated ledgers remain null counts in review scope",async()=>{
  const result=await review(JSON.stringify(reportRehearsalOverview(pack())));
  assert.equal(result.matchesRecomputation,true); assert.equal(result.scope[0].beforeRecords,null);
});

test("expected-result review separates report fidelity from a recorded baseline's outcome",async()=>{
  const result=await review(JSON.stringify(newReportFixtures().matching));
  assert.equal(result.matchesRecomputation,true);
  assert.deepEqual(result.reportOutcome,{kind:"expected-outcomes",expectationOrigin:"recorded-calculation",
    cases:1,matched:1,differing:0,allMatched:true});
  assert.deepEqual(result.scope,[{agent:"DAT",caseId:"dat-example",beforeRecords:2,afterRecords:2}]);
});
test("a faithfully reported manual expectation failure still matches recomputation",async()=>{
  const result=await review(JSON.stringify(newReportFixtures().differing));
  assert.equal(result.matchesRecomputation,true);assert.equal(result.reportOutcome.allMatched,false);
  assert.equal(result.reportOutcome.expectationOrigin,"manually-specified");assert.equal(result.reportOutcome.differing,1);
  assert.equal(result.sourceVerified,false);assert.ok(Object.isFrozen(result.reportOutcome));
});
test("altered expected-result summary and omitted difference cannot conceal the outcome",async()=>{
  const changed=JSON.parse(JSON.stringify(newReportFixtures().differing));
  changed.summary.allMatched=true;changed.rows[0].differences=[];
  const result=await review(JSON.stringify(changed));
  assert.equal(result.matchesRecomputation,false);assert.equal(result.reportOutcome.allMatched,false);
  assert.deepEqual(result.differences.map(d=>d.path),["/summary/allMatched","/rows/0/differences"]);
});
test("expected-result inputs must retain complete case and record coverage",async()=>{
  const changed=JSON.parse(JSON.stringify(newReportFixtures().matching));changed.inputs.expected[0].after.records=[];
  await assert.rejects(review(JSON.stringify(changed)),{code:"EXPECTED_RECORD_SCOPE_MISMATCH"});
});
test("filtered search is recomputed from all included inputs with original ledger scope",async()=>{
  const result=await review(JSON.stringify(newReportFixtures().filtered));
  assert.equal(result.matchesRecomputation,true);assert.deepEqual(result.scope.map(s=>s.beforeRecords),[2,2,1]);
  assert.deepEqual(result.reportOutcome,{kind:"record-query",query:{agent:"EMA",kind:"settle",decision:"all",search:""},
    totalRecords:5,matchedRecords:1});assert.ok(Object.isFrozen(result.reportOutcome.query));
});
test("zero search matches retains total source count",async()=>{
  const result=await review(JSON.stringify(newReportFixtures().empty));
  assert.equal(result.matchesRecomputation,true);assert.equal(result.reportOutcome.matchedRecords,0);
  assert.equal(result.reportOutcome.totalRecords,5);
});
test("search result omissions, changed balances and hidden total counts are detected",async()=>{
  const changed=JSON.parse(JSON.stringify(newReportFixtures().all));
  changed.rows.pop();changed.rows[0].changes[0].delta="0";changed.totalRecords=4;
  const result=await review(JSON.stringify(changed));assert.equal(result.matchesRecomputation,false);
  assert.equal(result.reportOutcome.matchedRecords,5);assert.equal(result.reportOutcome.totalRecords,5);
  assert.ok(result.differences.some(d=>d.path==="/rows/0/changes/0/delta"));
  assert.ok(result.differences.some(d=>d.path==="/rows"&&d.kind==="array-length"));
});
test("missing and invalid search conditions are not silently replaced by defaults",async()=>{
  for(const query of [undefined,{agent:"DAT"},{agent:"all",kind:"send",decision:"all",search:""}]){
    const changed=JSON.parse(JSON.stringify(newReportFixtures().all));changed.query=query;
    await assert.rejects(review(JSON.stringify(changed)),{code:"INVALID_RECORD_QUERY"});
  }
});
test("query search strings stay literal and reordered result rows remain significant",async()=>{
  const changed=JSON.parse(JSON.stringify(newReportFixtures().all));changed.rows.reverse();
  assert.equal((await review(JSON.stringify(changed))).matchesRecomputation,false);
  changed.query.search="<img src=x>";changed.rows=[];changed.matchedRecords=0;
  const result=await review(JSON.stringify(changed));assert.equal(result.matchesRecomputation,true);
  assert.equal(result.reportOutcome.query.search,"<img src=x>");
});
test("existing schemas retain their receipt shape and do not add a fabricated report outcome",async()=>{
  const result=await review(JSON.stringify(reports[0]));assert.equal(Object.hasOwn(result,"reportOutcome"),false);
});
