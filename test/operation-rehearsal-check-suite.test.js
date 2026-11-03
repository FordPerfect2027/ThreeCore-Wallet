import test from "node:test";
import assert from "node:assert/strict";
import { rehearsalExample, rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { buildRehearsalScenario,rehearsalScenarioParameters } from "../src/operation-rehearsal-scenario.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA } from "../src/operation-rehearsal-scenario-set.js";
import { captureRehearsalCheckSuite,validateRehearsalCheckSuite,encodeRehearsalCheckSuite,decodeRehearsalCheckSuite,runRehearsalCheckSuite,REHEARSAL_CHECK_SUITE_SCHEMA,REHEARSAL_CHECK_SUITE_LIMIT } from "../src/operation-rehearsal-check-suite.js";
const clone=value=>JSON.parse(JSON.stringify(value));
const collection=(source=rehearsalExampleV2())=>({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:"limit50",label:"上限50",before:source,after:buildRehearsalScenario(source,{...rehearsalScenarioParameters(source),maxPerOperation:"50000000"})}]});
const captured=()=>captureRehearsalCheckSuite(collection());
test("manually calculated profit and cascading rejection expectations match exactly",()=>{
  const inputs=collection();
  const suite={schema:REHEARSAL_CHECK_SUITE_SCHEMA,simulationOnly:true,expectationOrigin:"manually-specified",inputs,expected:[{id:"limit50",
    before:{metrics:{cash:"1028000000",outstanding:"0",realizedPnl:"28000000",fees:"2000000",reservedExitFees:"0",reservedAllocations:"0",availableCash:"1028000000",allocationShortfall:"0",proposedOwnTokenBuybackBudget:"2800000"},openPositions:0,allocationBlockers:[],records:[{id:"open-one",withinEnteredLimits:true,reasons:[]},{id:"settle-one",withinEnteredLimits:true,reasons:[]}]},
    after:{metrics:{cash:"1000000000",outstanding:"0",realizedPnl:"0",fees:"0",reservedExitFees:"0",reservedAllocations:"0",availableCash:"1000000000",allocationShortfall:"0",proposedOwnTokenBuybackBudget:"0"},openPositions:0,allocationBlockers:["REJECTED_RECORDS","NO_NET_PROFIT"],records:[{id:"open-one",withinEnteredLimits:false,reasons:["PER_OPERATION_LIMIT"]},{id:"settle-one",withinEnteredLimits:false,reasons:["NO_OPEN_POSITION"]}]}
  }]};
  assert.equal(runRehearsalCheckSuite(suite).summary.allMatched,true);
});
test("recorded baseline is immutable and round-trips without claiming independent verification",()=>{
  const input=collection(),suite=captureRehearsalCheckSuite(input);input.cases[0].label="changed";
  assert.equal(suite.inputs.cases[0].label,"上限50");assert.equal(suite.expectationOrigin,"recorded-calculation");
  assert.ok(Object.isFrozen(suite.expected[0].before.metrics));assert.deepEqual(decodeRehearsalCheckSuite(encodeRehearsalCheckSuite(suite)),suite);
  const report=runRehearsalCheckSuite(suite);assert.equal(report.sourceVerified,false);assert.equal(report.authorizesExecution,false);
});
test("a changed final amount identifies side, expected amount and actual amount",()=>{
  const suite=clone(captured());suite.expected[0].after.metrics.cash="999000000";const report=runRehearsalCheckSuite(suite);
  assert.deepEqual(report.summary,{cases:1,matched:0,differing:1,allMatched:false});
  assert.deepEqual(report.rows[0].differences,[{side:"after",field:"cash",recordId:null,expected:"999000000",actual:"1000000000"}]);
});
test("per-record decisions and reasons are checked even with equal final amounts",()=>{
  const suite=clone(captured());suite.expected[0].after.records[0]={id:"open-one",withinEnteredLimits:true,reasons:[]};
  const row=runRehearsalCheckSuite(suite).rows[0];assert.equal(row.differenceCount,2);assert.equal(row.differences[0].recordId,"open-one");
  assert.deepEqual(row.differences.map(d=>d.field),["withinEnteredLimits","reasons"]);
});
test("blocker and open position changes are independently visible",()=>{
  const suite=clone(captured());suite.expected[0].before.openPositions=1;suite.expected[0].before.allocationBlockers=["PAUSED"];
  assert.deepEqual(runRehearsalCheckSuite(suite).rows[0].differences.map(d=>d.field),["openPositions","allocationBlockers"]);
});
test("missing cases, reordered IDs and partial record coverage are rejected",()=>{
  for(const change of[s=>{s.expected=[];},s=>{s.expected[0].id="wrong";},s=>{s.expected[0].before.records.pop();},s=>{s.expected[0].before.records.reverse();}]){
    const suite=clone(captured());change(suite);assert.throws(()=>validateRehearsalCheckSuite(suite));
  }
});
test("amounts retain exact integers and prohibit signed unsigned values or negative zero",()=>{
  for(const value of[0,"-0","01","1.0","1e3","9".repeat(82),"-1"]){const suite=clone(captured());suite.expected[0].before.metrics.cash=value;assert.throws(()=>validateRehearsalCheckSuite(suite));}
  const loss=captureRehearsalCheckSuite(collection(rehearsalExampleV2("EMA","loss")));assert.equal(loss.expected[0].before.metrics.realizedPnl,"-42000000");assert.equal(runRehearsalCheckSuite(loss).summary.allMatched,true);
});
test("inconsistent decisions, repeated reasons, extra expected keys and getters are refused",()=>{
  for(const change of[s=>{s.expected[0].before.records[0].reasons=["PAUSED"];},s=>{s.expected[0].after.allocationBlockers=["PAUSED","PAUSED"];},s=>{s.expected[0].before.metrics.extra="0";}]){
    const suite=clone(captured());change(suite);assert.throws(()=>validateRehearsalCheckSuite(suite));
  }
  let read=false;const input=clone(captured());Object.defineProperty(input,"expected",{get(){read=true;return[];}});assert.throws(()=>validateRehearsalCheckSuite(input));assert.equal(read,false);
});
test("strict parser refuses unsafe keys, duplicate keys, oversized data and BOM",()=>{
  for(const text of["{",'{"x":1,"x":2}','{"constructor":{}}'," ".repeat(REHEARSAL_CHECK_SUITE_LIMIT+1),"\ufeff{}"])
    assert.throws(()=>decodeRehearsalCheckSuite(text));
});
test("empty collections do not claim a passing verification",()=>{
  assert.throws(()=>captureRehearsalCheckSuite({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[]}));
});
test("version one remains version one without inventing fee caps",()=>{
  const suite=captureRehearsalCheckSuite(collection(rehearsalExample()));assert.equal(suite.inputs.cases[0].before.schema,"threecore.operation-rehearsal.v1");
  assert.equal(Object.hasOwn(suite.inputs.cases[0].before.policy,"maxEntryFee"),false);assert.equal(runRehearsalCheckSuite(suite).summary.allMatched,true);
});
test("difference display is bounded but reports the true count",()=>{
  const original=rehearsalExampleV2(),source={...original,events:Array.from({length:30},(_,i)=>({id:"deposit-"+i,kind:"deposit",agent:original.agent,chainId:original.chainId,account:original.account,amount:"1"}))};
  const suite=clone(captureRehearsalCheckSuite(collection(source)));
  for(const side of["before","after"])for(const row of suite.expected[0][side].records){row.withinEnteredLimits=false;row.reasons=["PAUSED"];}
  const result=runRehearsalCheckSuite(suite).rows[0];assert.equal(result.differenceCount,120);assert.equal(result.differences.length,40);assert.equal(result.differencesTruncated,true);
});
