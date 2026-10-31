import test from "node:test";
import assert from "node:assert/strict";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
import { indexRehearsalRecords,queryRehearsalRecords,queryRehearsalContextRecords,encodeRehearsalRecordReport,encodeRehearsalContextRecordReport,rehearsalContextRecordCsv,validateRehearsalContextRecordQuery,REHEARSAL_RECORD_QUERY,REHEARSAL_RECORD_REPORT_SCHEMA,REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA } from "../src/operation-rehearsal-records.js";
import { reviewRehearsalReport,encodeRehearsalReviewEvidence,reviewRehearsalEvidence } from "../src/operation-rehearsal-report-review.js";
import { describeRehearsalFileTarget } from "../src/file-read-status.js";
const source=rehearsalExampleV2(),foreignAccount="0x"+"2".repeat(40),spender="0x"+"3".repeat(40);
const input={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers:[{...source,events:[{...source.events[0],agent:"EMA",chainId:84532,account:foreignAccount,origin:"https://outside.example",spender},source.events[1]]}]};
const query=(search,searchScope="recorded")=>({...REHEARSAL_RECORD_QUERY,search,searchScope});

test("V1 search and replay retain their original stored-account semantics",async()=>{
  const legacy={...REHEARSAL_RECORD_QUERY,search:foreignAccount},index=indexRehearsalRecords(input);
  assert.equal(queryRehearsalRecords(index,legacy).matchedRecords,0);
  const text=encodeRehearsalRecordReport(input,legacy),report=JSON.parse(text);assert.equal(report.schema,REHEARSAL_RECORD_REPORT_SCHEMA);assert.equal(Object.hasOwn(report.query,"searchScope"),false);
  const checked=await reviewRehearsalReport(text);assert.equal(checked.differenceCount,0);assert.equal(checked.reportOutcome.matchedRecords,0);
});
test("recorded context locates a rejected foreign account without changing storage ownership",()=>{
  const report=queryRehearsalContextRecords(indexRehearsalRecords(input),query(foreignAccount));
  assert.equal(report.schema,REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA);assert.equal(report.matchedRecords,1);assert.equal(report.rows[0].agent,"DAT");assert.equal(report.rows[0].event.agent,"EMA");
  assert.equal(report.rows[0].result.withinEnteredLimits,false);assert.ok(report.rows[0].changes.every(change=>change.delta==="0"));assert.equal(report.inputs.ledgers[0].events.length,2);
});
test("recorded context searches agent, network, site and spender using all literal terms",()=>{
  const report=queryRehearsalContextRecords(indexRehearsalRecords(input),query(" EMA 84532 outside.example "+spender));
  assert.equal(report.matchedRecords,1);assert.equal(report.rows[0].event.id,"open-one");
  assert.equal(queryRehearsalContextRecords(indexRehearsalRecords(input),query("[a-z]")).matchedRecords,0);
});
test("both scope can intersect stored and recorded accounts; recorded scope cannot invent a stored value",()=>{
  const index=indexRehearsalRecords(input),search=source.account.slice(0,16)+" "+foreignAccount.slice(0,16);
  assert.equal(queryRehearsalContextRecords(index,query(search)).matchedRecords,0);
  assert.equal(queryRehearsalContextRecords(index,query(search,"both")).matchedRecords,1);
});
test("agent filter continues to mean the saved ledger and intersects kind and decision",()=>{
  const index=indexRehearsalRecords(input);
  assert.equal(queryRehearsalContextRecords(index,{...query(foreignAccount),agent:"EMA"}).matchedRecords,0);
  assert.equal(queryRehearsalContextRecords(index,{...query(foreignAccount),agent:"DAT",kind:"open",decision:"rejected"}).matchedRecords,1);
  assert.equal(queryRehearsalContextRecords(index,{...query(foreignAccount),decision:"accepted"}).matchedRecords,0);
});
test("new scope report, review evidence and CSV preserve the selected search semantics",async()=>{
  const text=encodeRehearsalContextRecordReport(input,query(foreignAccount,"both")),checked=await reviewRehearsalReport(text);
  assert.equal(checked.differenceCount,0);assert.equal(checked.inputSchema,REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA);assert.equal(checked.reportOutcome.query.searchScope,"both");
  const evidence=await reviewRehearsalEvidence(encodeRehearsalReviewEvidence(checked));assert.equal(evidence.differenceCount,0);assert.equal(evidence.matchesReceipt,true);
  const csv=rehearsalContextRecordCsv(input,query(foreignAccount,"both"));assert.match(csv,/"querySearchScope"/);assert.match(csv,/"both"/);assert.equal(csv.split("\r\n").length,3);
});
test("tampered V2 derived rows are detected, and version/shape mismatches are rejected",async()=>{
  const report=JSON.parse(encodeRehearsalContextRecordReport(input,query(foreignAccount)));report.rows[0].result.withinEnteredLimits=true;
  assert.ok((await reviewRehearsalReport(JSON.stringify(report))).differenceCount>0);
  report.schema=REHEARSAL_RECORD_REPORT_SCHEMA;await assert.rejects(reviewRehearsalReport(JSON.stringify(report)),{code:"INVALID_RECORD_QUERY"});
  report.schema=REHEARSAL_CONTEXT_RECORD_REPORT_SCHEMA;delete report.query.searchScope;await assert.rejects(reviewRehearsalReport(JSON.stringify(report)),{code:"INVALID_RECORD_QUERY"});
});
for(const scope of [undefined,null,"stored","all",{},"constructor"])test("invalid V2 scope "+String(scope)+" is rejected",()=>{
  assert.throws(()=>validateRehearsalContextRecordQuery({...query(""),searchScope:scope}),{code:"INVALID_RECORD_QUERY"});
});
test("scope capture rejects getters without invoking them and freezes the normalized query",()=>{
  let read=false;const bad=query("");Object.defineProperty(bad,"searchScope",{get(){read=true;return"both";}});
  assert.throws(()=>validateRehearsalContextRecordQuery(bad));assert.equal(read,false);
  const valid=validateRehearsalContextRecordQuery(query(" EMA "));assert.equal(valid.search,"ema");assert.equal(Object.isFrozen(valid),true);
});
test("wrong-field guidance recognizes the new report without applying its contents",()=>{
  const text=encodeRehearsalContextRecordReport(input,query(foreignAccount));assert.ok(describeRehearsalFileTarget(text,"record"));assert.equal(describeRehearsalFileTarget(text,"report"),null);
});
