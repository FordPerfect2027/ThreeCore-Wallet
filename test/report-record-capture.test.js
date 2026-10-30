import test from "node:test";
import assert from "node:assert/strict";
import { validateHistoryEntry, validateReportHistory, mutateReportHistory } from "../src/report-history-model.js";
import { historyQuery } from "../src/report-history-query.js";
import { createReportSet, validateReportSet, validateSetExportOptions } from "../src/report-set-model.js";
import { diagnosticQuery } from "../src/report-set-diagnostics.js";
import { historyRecord, historyDocument, clone, TIME, LATER } from "./helpers/report-history-fixtures.js";

const capturedOnly = value => new Proxy(value,{get(){throw Error("unexpected live property read");}});

test("history entry validation uses captured fields",()=>{
  const value=clone(historyRecord());
  assert.deepEqual(validateHistoryEntry(capturedOnly(value)),value);
});
test("history document validation uses captured revision and entries",()=>{
  const value=clone(historyDocument([historyRecord()],2));
  assert.deepEqual(validateReportHistory(capturedOnly(value)),value);
});
test("history tag ordering check does not serialize the original array",()=>{
  const value=clone(historyRecord());
  value.tags=capturedOnly(["daily"]);
  assert.deepEqual(validateHistoryEntry(value).tags,["daily"]);
});
test("history save uses the captured mutation entry",()=>{
  const value=clone(historyRecord());
  const result=mutateReportHistory(historyDocument(),0,capturedOnly({kind:"save",entry:value}));
  assert.equal(result.entries.length,1);
  assert.equal(result.entries[0].id,value.id);
});
test("history merge captures skip-conflicts and source document",()=>{
  const document=historyDocument([historyRecord()]);
  const result=mutateReportHistory(historyDocument(),0,capturedOnly({kind:"merge",document,skipConflicts:false}));
  assert.equal(result.entries.length,1);
});
for(const kind of ["annotate","archive"]) {
  test(`history ${kind} captures mutation operands`,()=>{
    const entry=historyRecord(),document=historyDocument([entry]);
    const fields=kind==="annotate"?{label:"Revised",note:"",tags:[]}:{archived:true};
    const result=mutateReportHistory(document,0,capturedOnly({kind,id:entry.id,time:LATER,...fields}));
    assert.equal(result.revision,1);
    assert.equal(result.entries[0][kind==="annotate"?"label":"archived"],kind==="annotate"?"Revised":true);
  });
}
test("history changing operation kind cannot commit an earlier interpretation",()=>{
  let calls=0;
  const operation=new Proxy({kind:"save",entry:historyRecord()},{getOwnPropertyDescriptor(target,key){
    const descriptor=Reflect.getOwnPropertyDescriptor(target,key);
    return key==="kind"?{...descriptor,value:++calls===1?"save":"merge"}:descriptor;
  }});
  assert.throws(()=>mutateReportHistory(historyDocument(),0,operation),error=>error.code==="PERIOD_HISTORY_OPERATION");
});
test("history inaccessible mutation produces a public operation error",()=>{
  const revocable=Proxy.revocable({kind:"save",entry:historyRecord()},{});revocable.revoke();
  assert.throws(()=>mutateReportHistory(historyDocument(),0,revocable.proxy),error=>error.code==="PERIOD_HISTORY_OPERATION");
});
test("report-set validation uses captured source and historical flags",()=>{
  const history=historyDocument([historyRecord()]);
  const value=clone(createReportSet(history,[history.entries[0].id],"Captured",TIME));
  assert.deepEqual(validateReportSet(capturedOnly(value)),value);
});
test("report export cannot enable private notes through a live property trap",()=>{
  let gets=0;
  const value=new Proxy({includeNotes:false,shortAddresses:true},{get(target,key){gets++;return key==="includeNotes"?true:Reflect.get(target,key);}});
  assert.deepEqual(validateSetExportOptions(value),{includeNotes:false,shortAddresses:true});
  assert.equal(gets,0);
});
test("history query cannot broaden archive selection through live property reads",()=>{
  const value=new Proxy({archive:"active"},{get(target,key){return key==="archive"?"all":Reflect.get(target,key);}});
  assert.equal(historyQuery(value).archive,"active");
});
test("diagnostic query retains the supplied severity descriptor",()=>{
  const value=new Proxy({severity:"all"},{get(){throw Error("live filter read");}});
  assert.equal(diagnosticQuery(value).severity,"all");
});
