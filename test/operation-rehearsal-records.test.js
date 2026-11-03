import test from "node:test";
import assert from "node:assert/strict";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { REHEARSAL_WORKSPACE_SCHEMA } from "../src/operation-rehearsal-workspace.js";
import { indexRehearsalRecords,queryRehearsalRecords,relatedRehearsalRecords,encodeRehearsalRecordReport,validateRehearsalRecordQuery,REHEARSAL_RECORD_QUERY } from "../src/operation-rehearsal-records.js";
const workspace=(...ledgers)=>({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:"DAT",ledgers});
const sample=()=>workspace(rehearsalExampleV2("EMA","loss"),rehearsalExampleV2("DAT"),rehearsalExampleV2("CAWELON","pending"));
test("record keys remain distinct across agents with the same event IDs and canonical ordering",()=>{
  const index=indexRehearsalRecords(sample());assert.equal(index.rows.length,5);assert.deepEqual(index.rows.map(row=>row.key),["DAT:open-one","DAT:settle-one","EMA:open-one","EMA:settle-one","CAWELON:open-one"]);
  assert.equal(new Set(index.rows.map(row=>row.key)).size,5);assert.equal(index.rows[2].account,"0x"+"2".repeat(40));
});
test("first-record and settlement money changes use the immediately preceding state",()=>{
  const index=indexRehearsalRecords(sample());assert.deepEqual(index.rows[0].changes.find(row=>row.field==="cash"),{field:"cash",before:"1000000000",after:"899000000",delta:"-101000000"});
  assert.deepEqual(index.rows[1].changes.find(row=>row.field==="realizedPnl"),{field:"realizedPnl",before:"-1000000",after:"28000000",delta:"29000000"});
  assert.equal(index.rows[1].changes.find(row=>row.field==="reservedExitFees").delta,"-2000000");
});
test("missing and present empty ledgers stay distinguishable",()=>{
  const empty={...rehearsalExampleV2(),events:[]},report=queryRehearsalRecords(indexRehearsalRecords(workspace(empty)));
  assert.deepEqual(report.subjects,[{agent:"DAT",present:true,recordCount:0},{agent:"EMA",present:false,recordCount:null},{agent:"CAWELON",present:false,recordCount:null}]);assert.equal(report.rows.length,0);
});
test("related records stay within one agent and distinguish operation from reservation IDs",()=>{
  const source=rehearsalExampleV2();const reserve={id:"reserve-one",kind:"reserve",agent:source.agent,chainId:source.chainId,account:source.account,reservationId:"one",amount:"1000000"};
  const index=indexRehearsalRecords(workspace({...source,events:[...source.events,reserve]},rehearsalExampleV2("EMA")));
  assert.deepEqual(relatedRehearsalRecords(index,"DAT:open-one").map(row=>row.key),["DAT:settle-one"]);
  assert.deepEqual(relatedRehearsalRecords(index,"DAT:reserve-one"),[]);
});
test("a rejected foreign context remains visible separately from its storage context and never moves money",()=>{
  const source=rehearsalExampleV2(),index=indexRehearsalRecords(workspace({...source,events:[{...source.events[0],agent:"EMA"}]}));
  const row=index.rows[0];assert.equal(row.agent,"DAT");assert.equal(row.event.agent,"EMA");assert.deepEqual(row.result.reasons,["WRONG_AGENT"]);assert.ok(row.changes.every(change=>change.delta==="0"));
});
test("agent, kind and decision filters intersect and keep the complete source",()=>{
  const source=rehearsalExampleV2(),index=indexRehearsalRecords(workspace(source,{...rehearsalExampleV2("EMA"),policy:{...source.policy,maxEntryFee:"0"}}));
  const report=queryRehearsalRecords(index,{agent:"EMA",kind:"settle",decision:"rejected",search:""});assert.equal(report.matchedRecords,1);assert.equal(report.rows[0].event.id,"settle-one");assert.equal(report.inputs.ledgers.length,2);
});
test("literal case-insensitive search matches all tokens without interpreting regex",()=>{
  const index=indexRehearsalRecords(sample());const query=search=>queryRehearsalRecords(index,{...REHEARSAL_RECORD_QUERY,search});
  assert.equal(query(" EMA OPEN ").matchedRecords,1);assert.equal(query("[a-z]").matchedRecords,0);assert.equal(query("0x222222").matchedRecords,2);
});
test("search can locate an exact rejection code",()=>{
  const source=rehearsalExampleV2(),index=indexRehearsalRecords(workspace({...source,policy:{...source.policy,paused:true}}));
  assert.equal(queryRehearsalRecords(index,{...REHEARSAL_RECORD_QUERY,search:"paused"}).matchedRecords,1);
});
test("invalid filters, unsafe controls and getter queries are rejected",()=>{
  for(const change of[{agent:"OTHER"},{kind:"send"},{decision:"success"},{search:"x".repeat(81)},{search:"x\ny"}])assert.throws(()=>validateRehearsalRecordQuery({...REHEARSAL_RECORD_QUERY,...change}));
  let read=false;const query={...REHEARSAL_RECORD_QUERY};Object.defineProperty(query,"search",{get(){read=true;return"";}});assert.throws(()=>validateRehearsalRecordQuery(query));assert.equal(read,false);
});
test("index inputs and results are frozen snapshots; forged indexes and missing keys are rejected",()=>{
  const source=JSON.parse(JSON.stringify(sample())),index=indexRehearsalRecords(source);source.ledgers[0].events[0].id="edited";assert.equal(index.rows[2].event.id,"open-one");
  assert.ok(Object.isFrozen(index.rows[0].changes[0]));assert.throws(()=>queryRehearsalRecords({...index}));assert.throws(()=>relatedRehearsalRecords(index,"DAT:missing"));
});
test("a no-match report is reproducible and explicitly unverified",()=>{
  const report=JSON.parse(encodeRehearsalRecordReport(sample(),{...REHEARSAL_RECORD_QUERY,search:"missing"}));assert.equal(report.matchedRecords,0);assert.equal(report.totalRecords,5);assert.equal(report.sourceVerified,false);assert.equal(report.authorizesExecution,false);assert.equal(report.inputs.ledgers.length,3);
});
