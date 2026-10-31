import test from "node:test";
import assert from "node:assert/strict";
import { reportSetTokenLibrary } from "../src/report-set-model.js";
import { prepareReportSetTokenLibraryFile } from "../src/report-set-export.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { decodePeriodLibraryFile } from "../src/period-library-file.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { setTokenLibraryText } from "../src/report-set-view.js";
import { sequenceSet, sequenceHistory, clone, id, historyMemory, fileFrom, deferred } from "./helpers/report-set-fixtures.js";
const unique = () => sequenceSet(sequenceHistory([0n,12n,24n], (report,index) => {
  report.slots.forEach((slot,n) => { slot.entry.id=id(1000+index*3+n); });
}));

test("token collection preserves all original fields and restrictions across reports", async () => {
  const input=clone(unique());input.entries[0].archived=true;input.entries[1].report.slots[0].entry.archived=true;
  input.entries[1].report.slots[0].entry.requiresNewPlan=true;
  input.entries[2].report.slots[0].entry.draft.records=input.entries[2].report.slots[0].entry.draft.records.slice(0,1);
  const original=JSON.stringify(input);
  for(const agent of ["DAT","EMA","CAWELON"]){
    const result=reportSetTokenLibrary(input,agent),file=await prepareReportSetTokenLibraryFile(input,agent),decoded=await decodePeriodLibraryFile(file.text);
    assert.equal(result.error,null);assert.equal(result.entryCount,3);assert.equal(result.missingReports,0);assert.equal(result.duplicateReferences,0);
    assert.deepEqual(decoded.document.entries,input.entries.map(row=>row.report.slots.find(slot=>slot.agent===agent).entry));
    assert.equal(decoded.document.revision,0);assert.equal(file.automaticallyImported,false);assert.equal(file.authorizesExecution,false);
    assert.equal(result.sourceRows[0].reportArchived,true);assert.equal(result.document.entries[0].archived,false);
  }
  assert.equal(JSON.stringify(input),original);
});

test("only byte-equivalent validated entries sharing an ID are deduplicated", async () => {
  const input=clone(unique());input.entries[1].report.slots[0].entry=clone(input.entries[0].report.slots[0].entry);
  const result=reportSetTokenLibrary(input,"DAT");assert.equal(result.entryCount,2);assert.equal(result.duplicateReferences,1);assert.equal(result.sourceRows.length,3);
  assert.deepEqual((await decodePeriodLibraryFile((await prepareReportSetTokenLibraryFile(input,"DAT")).text)).document.entries,[input.entries[0].report.slots[0].entry,input.entries[2].report.slots[0].entry]);
  // Equal evidence under distinct original IDs is retained as distinct entries.
  input.entries[1].report.slots[0].entry.id=id(9999);assert.equal(reportSetTokenLibrary(input,"DAT").entryCount,3);
});

test("conflicting IDs never silently choose a source or emit a partial library", async () => {
  for(const change of [entry=>{entry.label="renamed";},entry=>{entry.requiresNewPlan=true;},entry=>{entry.archived=true;},entry=>{entry.draft.records=entry.draft.records.slice(0,1);}]){
    const input=clone(unique());input.entries[1].report.slots[0].entry=clone(input.entries[0].report.slots[0].entry);change(input.entries[1].report.slots[0].entry);
    const result=reportSetTokenLibrary(input,"DAT");assert.equal(result.document,null);assert.equal(result.error,"PERIOD_SET_LIBRARY_CONFLICT");
    assert.equal(result.conflicts.length,1);assert.equal(result.conflicts[0].conflictingReportId,input.entries[1].id);
    assert.match(setTokenLibraryText(result),/どちらかを選んだり上書きしたりせず/);
    await assert.rejects(prepareReportSetTokenLibraryFile(input,"DAT"),error=>error.code==="PERIOD_SET_LIBRARY_CONFLICT");
  }
  assert.equal(reportSetTokenLibrary(sequenceSet(),"DAT").error,"PERIOD_SET_LIBRARY_CONFLICT");
});

test("missing token slots are disclosed and no originals means no export", async () => {
  const input=clone(unique());input.entries[0].report.slots[0].entry=null;
  let result=reportSetTokenLibrary(input,"DAT");assert.equal(result.entryCount,2);assert.equal(result.missingReports,1);
  assert.match(setTokenLibraryText(result),/控えがない報告 1件/);
  for(const report of input.entries)report.report.slots[0].entry=null;
  result=reportSetTokenLibrary(input,"DAT");assert.equal(result.document,null);assert.equal(result.missingReports,3);
  await assert.rejects(prepareReportSetTokenLibraryFile(input,"DAT"),error=>error.code==="PERIOD_SET_LIBRARY_EMPTY");
  for(const agent of ["all","dat",null,{},["DAT"]])assert.throws(()=>reportSetTokenLibrary(input,agent));
});

test("digest waits cannot substitute source data or options and abort cannot return a library",async()=>{
  const input=clone(unique()),expected=clone(input.entries[0].report.slots[0].entry),start=deferred(),gate=deferred();
  const pending=prepareReportSetTokenLibraryFile(input,"DAT",{subtle:{digest(...args){start.resolve();return gate.promise.then(()=>crypto.subtle.digest(...args));}}});
  await start.promise;input.entries[0].report.slots[0].entry.label="changed while waiting";gate.resolve();
  assert.deepEqual((await decodePeriodLibraryFile((await pending).text)).document.entries[0],expected);
  let calls=0;await assert.rejects(prepareReportSetTokenLibraryFile(input,"DAT",{get signal(){calls++;return null;}}));assert.equal(calls,0);
  const abort=new AbortController();abort.abort();await assert.rejects(prepareReportSetTokenLibraryFile(input,"DAT",{signal:abort.signal}));
});

async function ready(options={}){
  const input=unique(),store=historyMemory(),c=createReportSetController({storage:store.storage,...options});
  await c.importFile(fileFrom((await prepareReportSetFile(input)).text));await c.applyReview();
  await c.importFile(fileFrom((await prepareReportSetFile(sequenceSet())).text));return{input,store,c};
}
test("controller keeps the accepted set and replacement review and does no storage work",async()=>{
  const {c,store,input}=await ready(),original=c.state.input,pending=c.state.review,files=[];
  try{
    assert.equal(await c.exportTokenLibrary("DAT",false,file=>files.push(file)),false);
    assert.equal(await c.exportTokenLibrary("all",true,file=>files.push(file)),false);
    assert.equal(await c.exportTokenLibrary("DAT",true,file=>files.push(file)),true);
    assert.deepEqual((await decodePeriodLibraryFile(files[0].text)).document.entries,input.entries.map(row=>row.report.slots[0].entry));
    assert.equal(c.state.input,original);assert.equal(c.state.review,pending);assert.equal(c.state.phase,"review");assert.equal(store.calls.length,0);
    assert.equal(await c.exportTokenLibrary("DAT",true,()=>false),false);
    assert.equal(await c.exportTokenLibrary("DAT",true,()=>Promise.reject(Error("PRIVATE"))),false);assert.equal(c.state.error,"PERIOD_ASYNC_DELIVERY");
    assert.equal(c.state.review,pending);
  }finally{c.dispose();}
});

test("stopped exports and disposal suppress delivery and late success",async()=>{
  for(const action of ["cancel","dispose"]){
    let c;const f=await ready({onChange:state=>{if(state.phase==="exporting")c[action]();}});c=f.c;
    assert.equal(await c.exportTokenLibrary("DAT",true,()=>assert.fail("delivered")),false);c.dispose();
  }
});
