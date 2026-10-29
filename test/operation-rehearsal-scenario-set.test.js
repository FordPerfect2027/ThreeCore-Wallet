import test from "node:test";
import assert from "node:assert/strict";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { buildRehearsalScenario, rehearsalScenarioParameters } from "../src/operation-rehearsal-scenario.js";
import { createRehearsalScenarioSet, validateRehearsalScenarioSet, encodeRehearsalScenarioSet,
  decodeRehearsalScenarioSet, reportRehearsalScenarioSet, REHEARSAL_SCENARIO_SET_SCHEMA,
  REHEARSAL_SCENARIO_SET_LIMIT } from "../src/operation-rehearsal-scenario-set.js";
const source=rehearsalExampleV2();
const entry=(id="case-one",label="上限比較",agent="DAT")=>{const before=rehearsalExampleV2(agent);return{id,label,before,
  after:buildRehearsalScenario(before,{...rehearsalScenarioParameters(before),maxPerOperation:"50000000"})};};
const pack=(...cases)=>({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases});
const add=(set,item=entry())=>set.commit(set.previewPut(item));
test("canonical set round-trips without derived results or caller references",()=>{
  const item=entry(), input=pack(item), normalized=validateRehearsalScenarioSet(input);
  item.label="changed";assert.equal(normalized.cases[0].label,"上限比較");assert.ok(Object.isFrozen(normalized.cases[0].before.events));
  assert.deepEqual(decodeRehearsalScenarioSet(encodeRehearsalScenarioSet(normalized)),normalized);
  assert.equal(Object.hasOwn(normalized.cases[0],"summary"),false);
});
test("labels normalize Unicode and surrounding spaces but reject invisible, control, bidi and malformed text",()=>{
  assert.equal(validateRehearsalScenarioSet(pack(entry("a","  e\u0301  "))).cases[0].label,"é");
  for(const name of [""," ","\u200b","bad\nname","bad\u202ename","\ud800","x".repeat(81)])
    assert.throws(()=>validateRehearsalScenarioSet(pack(entry("a",name))),{code:"INVALID_SCENARIO_LABEL"});
});
test("duplicate IDs and more than twelve cases are refused",()=>{
  assert.throws(()=>validateRehearsalScenarioSet(pack(entry(),entry())),{code:"DUPLICATE_SCENARIO_ID"});
  assert.equal(validateRehearsalScenarioSet(pack(...Array.from({length:12},(_,i)=>entry("case-"+i)))).cases.length,12);
  assert.throws(()=>validateRehearsalScenarioSet(pack(...Array.from({length:13},(_,i)=>entry("case-"+i)))));
});
test("case IDs are exact ASCII identifiers and report claims are not accepted as inputs",()=>{
  for(const id of ["","../x","=formula","a b","x".repeat(65)])assert.throws(()=>validateRehearsalScenarioSet(pack(entry(id))));
  assert.throws(()=>decodeRehearsalScenarioSet(JSON.stringify(reportRehearsalScenarioSet(pack(entry())))));
});
test("foreign account or changed event cannot enter a case",()=>{
  const item=entry();item.after={...item.after,account:"0x"+"9".repeat(40)};
  assert.throws(()=>validateRehearsalScenarioSet(pack(item)),{code:"SCENARIO_CONTEXT_OR_EVENTS_CHANGED"});
});
test("summary recomputes each case with independent agent and asset context",()=>{
  const report=reportRehearsalScenarioSet(pack(entry("dat"),entry("ema","別の口座","EMA")));
  assert.equal(report.rows[0].summary.newlyRejected,2);assert.equal(report.rows[1].agent,"EMA");
  assert.notEqual(report.rows[0].account,report.rows[1].account);assert.equal(report.total,undefined);assert.equal(report.authorizesExecution,false);
});
test("malformed, unsafe, duplicate-key, overlarge and getter inputs fail without invoking getters",()=>{
  for(const text of ["{",'{"x":1,"x":2}','{"__proto__":{}}'," ".repeat(REHEARSAL_SCENARIO_SET_LIMIT+1)])assert.throws(()=>decodeRehearsalScenarioSet(text));
  let read=false;const input=pack(entry());Object.defineProperty(input,"cases",{get(){read=true;return[];}});
  assert.throws(()=>validateRehearsalScenarioSet(input));assert.equal(read,false);
});
test("a new case requires an explicit one-time commit",()=>{
  const set=createRehearsalScenarioSet(), review=set.previewPut(entry());
  assert.equal(set.state().current.cases.length,0);set.commit(review);assert.equal(set.state().current.cases.length,1);
  assert.throws(()=>set.commit(review),{code:"STALE_REVIEW"});
});
test("replacing an existing ID requires explicit replace and can be undone",()=>{
  const set=createRehearsalScenarioSet();add(set);
  assert.throws(()=>set.previewPut(entry()),{code:"DUPLICATE_SCENARIO_ID"});
  const review=set.previewPut(entry("case-one","別の名前"),true);assert.equal(review.action,"replace");
  set.commit(review);assert.equal(set.state().current.cases[0].label,"別の名前");set.undo();assert.equal(set.state().current.cases[0].label,"上限比較");
});
test("rename and remove are previewed, reversible and do not change the stored input records",()=>{
  const set=createRehearsalScenarioSet();add(set);const original=set.state().current.cases[0].before;
  set.commit(set.previewRename("case-one","名前変更"));assert.deepEqual(set.state().current.cases[0].before,original);
  const remove=set.previewRemove("case-one");assert.equal(set.state().current.cases.length,1);
  set.commit(remove);assert.equal(set.state().current.cases.length,0);set.undo();assert.equal(set.state().current.cases[0].label,"名前変更");
});
test("reviewed import replaces the set only on commit and supports undo",()=>{
  const set=createRehearsalScenarioSet();add(set);const review=set.previewImport(pack(entry("ema","EMA例","EMA")));
  assert.equal(set.state().current.cases[0].id,"case-one");set.commit(review);assert.equal(set.state().current.cases[0].id,"ema");
  set.undo();assert.equal(set.state().current.cases[0].id,"case-one");
});
test("identical imports do not consume undo capacity",()=>{
  const set=createRehearsalScenarioSet();add(set);const count=set.state().undoCount;
  const review=set.previewImport(set.state().current);assert.equal(review.changed,false);set.commit(review);assert.equal(set.state().undoCount,count);
});
test("cancel, a newer review and invalid edits revoke pending commits",()=>{
  const set=createRehearsalScenarioSet();add(set);
  for(const action of [()=>set.cancel(),()=>set.previewRename("case-one","new"),()=>assert.throws(()=>set.previewRename("absent","x")),()=>assert.throws(()=>set.previewRemove("absent"))]){
    const pending=set.previewRemove("case-one");action();assert.throws(()=>set.commit(pending),{code:"STALE_REVIEW"});
  }
});
test("undo history is bounded to ten snapshots",()=>{
  const set=createRehearsalScenarioSet();add(set);for(let i=0;i<12;i++)set.commit(set.previewRename("case-one","Name "+i));
  assert.equal(set.state().undoCount,10);for(let i=0;i<10;i++)set.undo();assert.throws(()=>set.undo(),{code:"NO_UNDO"});
});
test("reentrant capture cannot commit against a changed state",()=>{
  const set=createRehearsalScenarioSet();const proxy=new Proxy(entry(),{getPrototypeOf(target){set.cancel();return Object.getPrototypeOf(target);}});
  assert.throws(()=>set.previewPut(proxy),{code:"STALE_REVIEW"});assert.equal(set.state().current.cases.length,0);
});
test("disposing drops all cases, reviews and undo state",()=>{
  const set=createRehearsalScenarioSet();const pending=set.previewPut(entry());set.dispose();
  assert.throws(()=>set.state(),{code:"SCENARIO_SET_DISPOSED"});assert.throws(()=>set.commit(pending),{code:"SCENARIO_SET_DISPOSED"});
});
