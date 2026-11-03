import test from "node:test";
import assert from "node:assert/strict";
import { capacityWorkspace, capacityCases } from "./helpers/rehearsal-capacity-fixtures.js";
import { evaluateRehearsal } from "../src/operation-rehearsal.js";
import { encodeRehearsalWorkspace, decodeRehearsalWorkspace } from "../src/operation-rehearsal-workspace.js";
import { encodeRehearsalScenarioSet, decodeRehearsalScenarioSet, encodeRehearsalScenarioSetReport } from "../src/operation-rehearsal-scenario-set.js";
import { captureRehearsalCheckSuite, encodeRehearsalCheckSuite, decodeRehearsalCheckSuite, encodeRehearsalCheckReport } from "../src/operation-rehearsal-check-suite.js";
import { encodeRehearsalRecordReport } from "../src/operation-rehearsal-records.js";
import { encodeRehearsalSession, decodeRehearsalSession, createRehearsalSession, REHEARSAL_SESSION_SCHEMA } from "../src/operation-rehearsal-session.js";
import { reviewRehearsalReport } from "../src/operation-rehearsal-report-review.js";

test("each of three maximum-count ledgers survives workspace export and decode without loss",()=>{
  const input=capacityWorkspace(),text=encodeRehearsalWorkspace(input),restored=decodeRehearsalWorkspace(text);
  assert.equal(encodeRehearsalWorkspace(restored),text);
  for(const ledger of restored.ledgers){assert.equal(ledger.events.length,200);assert.equal(ledger.events.at(-1).id,"deposit-199");
    const result=evaluateRehearsal(ledger);assert.equal(result.cash,"1000000200");assert.equal(result.realizedPnl,"0");}
  assert.throws(()=>encodeRehearsalWorkspace(capacityWorkspace(201)),{code:"INVALID_STRUCTURE"});
});
test("a complete 600-record query remains reviewable under bounded parser limits",async()=>{
  const text=encodeRehearsalRecordReport(capacityWorkspace()),report=JSON.parse(text),receipt=await reviewRehearsalReport(text);
  assert.equal(report.rows.length,600);assert.equal(report.rows.at(-1).key,"CAWELON:deposit-199");
  assert.equal(receipt.matchesRecomputation,true);assert.equal(receipt.reportOutcome.matchedRecords,600);
  assert.equal(receipt.byteLength,Buffer.byteLength(text));
});
test("twelve large cases remain roundtrip stable and their summary stays independently reviewable",async()=>{
  const input=capacityCases(160),text=encodeRehearsalScenarioSet(input);
  assert.ok(Buffer.byteLength(text)>900000);assert.equal(encodeRehearsalScenarioSet(decodeRehearsalScenarioSet(text)),text);
  assert.equal((await reviewRehearsalReport(encodeRehearsalScenarioSetReport(input))).matchesRecomputation,true);
  assert.throws(()=>encodeRehearsalScenarioSet(capacityCases(180)),{code:"FILE_TOO_LARGE"});
  assert.throws(()=>encodeRehearsalScenarioSet({...input,cases:[...input.cases,{...input.cases[0],id:"extra"}]}),{code:"INVALID_SCENARIO_SET"});
});
test("a large expected baseline can be saved, read and reported without parser/export mismatch",async()=>{
  const suite=captureRehearsalCheckSuite(capacityCases()),text=encodeRehearsalCheckSuite(suite);
  assert.ok(Buffer.byteLength(text)>900000);assert.equal(encodeRehearsalCheckSuite(decodeRehearsalCheckSuite(text)),text);
  const receipt=await reviewRehearsalReport(encodeRehearsalCheckReport(suite));
  assert.equal(receipt.matchesRecomputation,true);assert.equal(receipt.reportOutcome.cases,12);
});
test("an over-limit expected baseline leaves the valid case collection individually exportable",()=>{
  const input=capacityCases(140),before=encodeRehearsalScenarioSet(input);
  assert.throws(()=>captureRehearsalCheckSuite(input),{code:"FILE_TOO_LARGE"});
  for(const item of input.cases){const suite=captureRehearsalCheckSuite({...input,cases:[item]});
    assert.equal(decodeRehearsalCheckSuite(encodeRehearsalCheckSuite(suite)).inputs.cases[0].id,item.id);}
  assert.equal(encodeRehearsalScenarioSet(input),before);
});
test("combined maximum-count histories and twelve large cases restore atomically and reexport identically",()=>{
  const source={schema:REHEARSAL_SESSION_SCHEMA,simulationOnly:true,workspace:capacityWorkspace(),cases:capacityCases()};
  const text=encodeRehearsalSession(source),store=createRehearsalSession();
  const pending=store.preview(decodeRehearsalSession(text));assert.equal(store.snapshot().workspace.ledgers.length,0);
  store.commit(pending);assert.equal(encodeRehearsalSession(store.snapshot()),text);
  assert.equal(store.cases.state().undoCount,0);store.dispose();
});
