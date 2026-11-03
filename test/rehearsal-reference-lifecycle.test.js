import test from "node:test";
import assert from "node:assert/strict";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
import { indexRehearsalRecords, reportRehearsalReference, encodeRehearsalReferenceReport } from "../src/operation-rehearsal-records.js";
import { reviewRehearsalReport, encodeRehearsalReviewEvidence, reviewRehearsalEvidence } from "../src/operation-rehearsal-report-review.js";
import { describeRehearsalFileTarget } from "../src/file-read-status.js";
const workspace=(...ledgers)=>({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers});
const reference=(input,key="DAT:open-one")=>reportRehearsalReference(indexRehearsalRecords(input),key);
test("reference summary includes both entry and exit fees and distinguishes pending return from zero",()=>{
  const closed=reference(workspace(rehearsalExampleV2()));assert.equal(closed.summary.phase,"closed");assert.equal(closed.summary.totalFeeUnits,"2000000");
  assert.equal(closed.summary.realizedPnlUnits,"28000000");assert.equal(closed.summary.grossReturnUnits,"130000000");assert.equal(closed.summary.pendingPrincipalUnits,"0");
  const pending=reference(workspace(rehearsalExampleV2("DAT","pending")));assert.equal(pending.summary.phase,"open");assert.equal(pending.summary.grossReturnUnits,null);
  assert.equal(pending.summary.exitFeeUnits,"0");assert.equal(pending.summary.realizedPnlUnits,"-1000000");assert.equal(pending.summary.pendingPrincipalUnits,"100000000");
});
test("rejected attempts and another agent with the same ID never contribute to a lifecycle's amounts",()=>{
  const source=rehearsalExampleV2(),foreign={...source.events[0],id:"foreign-open",agent:"EMA"},duplicate={...source.events[1],id:"repeated-settle"};
  const input=workspace({...source,events:[foreign,...source.events,duplicate]},rehearsalExampleV2("EMA","loss"));
  const report=reference(input);assert.equal(report.recordCount,4);assert.equal(report.summary.acceptedRecords,2);assert.equal(report.summary.rejectedRecords,2);
  assert.equal(report.summary.openingRecordId,"open-one");assert.equal(report.summary.closingRecordId,"settle-one");assert.equal(report.summary.realizedPnlUnits,"28000000");
  assert.ok(report.rows.every(row=>row.agent==="DAT"));assert.equal(reference(input,"EMA:open-one").agent,"EMA");
});
test("an unstarted reference does not report an accepted principal, return or fee",()=>{
  const report=reference(workspace(rehearsalExampleV2("DAT","limit")));
  assert.equal(report.summary.phase,"not-started");assert.equal(report.summary.principalUnits,null);assert.equal(report.summary.grossReturnUnits,null);
  assert.equal(report.summary.totalFeeUnits,"0");assert.equal(report.summary.realizedPnlUnits,"0");assert.equal(report.summary.acceptedRecords,0);
});
test("reservation and release preserve exact reserved amounts while separating operation IDs",()=>{
  const source=rehearsalExampleV2(),reserve={id:"reserve-one",kind:"reserve",agent:source.agent,chainId:source.chainId,account:source.account,reservationId:"one",amount:"2800000"};
  const release={id:"release-one",kind:"release",agent:source.agent,chainId:source.chainId,account:source.account,reservationId:"one"};
  const pending=reference(workspace({...source,events:[...source.events,reserve]}),"DAT:reserve-one");assert.equal(pending.summary.pendingReservedAmountUnits,"2800000");
  const report=reference(workspace({...source,events:[...source.events,reserve,release,{...release,id:"release-twice"}]}),"DAT:release-one");
  assert.equal(report.recordCount,3);assert.equal(report.summary.phase,"closed");assert.equal(report.summary.rejectedRecords,1);assert.equal(report.summary.releasedAmountUnits,"2800000");
  assert.equal(report.summary.pendingReservedAmountUnits,"0");assert.equal(report.summary.realizedPnlUnits,null);assert.equal(report.summary.grossReturnUnits,null);
});
test("lifecycle outputs are frozen and source data cannot be replaced by forged indexes",()=>{
  const input=workspace(rehearsalExampleV2()),index=indexRehearsalRecords(input),report=reportRehearsalReference(index,"DAT:open-one");
  input.ledgers.length=0;assert.equal(report.inputs.ledgers.length,1);assert.ok(Object.isFrozen(report.summary));assert.ok(Object.isFrozen(report.rows));
  assert.throws(()=>reportRehearsalReference({...index},"DAT:open-one"));assert.throws(()=>reportRehearsalReference(index,"EMA:open-one"));
  const deposit=workspace(rehearsalExampleV2("DAT","deposit"));assert.throws(()=>reference(deposit,"DAT:"+deposit.ledgers[0].events[0].id),e=>e.code==="RECORD_HAS_NO_REFERENCE");
});
test("focused reference reports reproduce independently and altered metrics are exposed by the existing evidence verifier",async()=>{
  const text=encodeRehearsalReferenceReport(workspace(rehearsalExampleV2(),rehearsalExampleV2("EMA")),"DAT:settle-one");
  const checked=await reviewRehearsalReport(text);assert.equal(checked.matchesRecomputation,true);assert.equal(checked.reportOutcome.kind,"record-reference");
  assert.equal(checked.reportOutcome.summary.realizedPnlUnits,"28000000");
  const altered=JSON.parse(text);altered.summary.realizedPnlUnits="999";altered.authorizesExecution=true;
  const review=await reviewRehearsalReport(JSON.stringify(altered));assert.equal(review.matchesRecomputation,false);
  assert.ok(review.differences.some(row=>row.path==="/summary/realizedPnlUnits"));assert.ok(review.differences.some(row=>row.path==="/authorizesExecution"));
  const evidence=await reviewRehearsalEvidence(encodeRehearsalReviewEvidence(checked));assert.equal(evidence.reportReview.matchesRecomputation,true);
});

test("reference report destination guidance never treats the report as a restorable workspace",()=>{
  const text=encodeRehearsalReferenceReport(workspace(rehearsalExampleV2()),"DAT:open-one");
  assert.equal(describeRehearsalFileTarget(text,"report"),null);
  assert.match(describeRehearsalFileTarget(text,"workspace"),/資料を再計算して確認/);
  assert.throws(()=>indexRehearsalRecords(JSON.parse(text)));
});

test("closed loss and zero return keep their exact sign and do not become missing values",()=>{
  const source=structuredClone(rehearsalExampleV2());source.events[1].grossReturn="0";
  const report=reference(workspace(source));assert.equal(report.summary.phase,"closed");
  assert.equal(report.summary.grossReturnUnits,"0");assert.equal(report.summary.realizedPnlUnits,"-102000000");
  assert.equal(report.summary.totalFeeUnits,"2000000");
});
