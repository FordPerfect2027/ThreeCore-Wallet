import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createReportSetController } from "../src/report-set-controller.js";
import { createReportSet } from "../src/report-set-model.js";
import { historyMemory, historyDocument, historyRecord, id, AFTER, clone } from "./helpers/report-set-fixtures.js";

const document=historyDocument([historyRecord()]);
const saved=createReportSet(document,[id(101)],"Saved",AFTER);
function setup(options={}){
  const store=historyMemory(document);
  const controller=createReportSetController({storage:store.storage,now:()=>AFTER,...options});
  return {store,controller};
}
async function selected(f){await f.controller.refresh();f.controller.select([id(101)]);}
async function accepted(f){await selected(f);f.controller.prepare("Accepted");assert.equal(await f.controller.applyReview(),true);}

for(const action of ["cancel","invalidateReview","select"]){
  test(`report set ${action} inside clock retires prepared review`,async()=>{
    let f,armed=false;
    f=setup({now(){if(armed){if(action==="select")f.controller.select([]);else f.controller[action]();}return AFTER;}});
    await selected(f);armed=true;
    assert.equal(f.controller.prepare("Old"),false);
    assert.equal(f.controller.state.review,null);
    if(action==="select")assert.deepEqual(f.controller.state.selection,[]);
  });
}

test("report set cancelled selection capture does not replace current selection",async()=>{
  const f=setup();await f.controller.refresh();
  let once=false;
  const ids=new Proxy([id(101)],{getOwnPropertyDescriptor(target,key){
    if(!once){once=true;f.controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  assert.equal(f.controller.select(ids),false);
  assert.deepEqual(f.controller.state.selection,[]);
});

test("report set cancelled storage capture does not adopt late records",async()=>{
  let f,once=false;
  const value=clone(document);
  const storage={async read(){return new Proxy(value,{getOwnPropertyDescriptor(target,key){
    if(!once){once=true;f.controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
  }});},close(){}};
  f=setup({storage});
  assert.equal(await f.controller.refresh(),false);
  assert.equal(f.controller.state.loaded,false);
  assert.equal(f.controller.state.document.entries.length,0);
});

for(const point of ["input","checksum"]){
  test(`report set cancelled import ${point} cannot recreate review`,async()=>{
    let f,once=false;
    const value=clone(saved);
    const input=point!=="input"?value:new Proxy(value,{getOwnPropertyDescriptor(target,key){
      if(!once){once=true;f.controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
    }});
    f=setup({readFile:async()=>point==="input"?{input,checksumVerified:true}:{input,get checksumVerified(){f.controller.cancel();return true;}}});
    assert.equal(await f.controller.importFile({}),false);
    assert.equal(f.controller.state.review,null);
  });
}

test("report set cancelled export options do not prepare or deliver a file",async()=>{
  let f,once=false,prepared=0,delivered=0;
  f=setup({prepareFile:async()=>{prepared++;return {text:"synthetic"};}});await accepted(f);
  const options=new Proxy({includeNotes:false},{getOwnPropertyDescriptor(target,key){
    if(!once){once=true;f.controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  assert.equal(await f.controller.exportFile("json",true,()=>{delivered++;},options),false);
  assert.equal(prepared,0);assert.equal(delivered,0);
  assert.equal(f.controller.state.input.title,"Accepted");
});

test("report set recursive observer cancellation is bounded",async()=>{
  let f,calls=0;
  f=setup({onChange(){if(++calls<16)f.controller.cancel();}});
  assert.equal(await f.controller.refresh(),false);
  assert.ok(calls<=2,`received ${calls} notifications`);
  assert.equal(f.store.calls.length,0);
});

test("report set ready observer cancellation retires the return status",async()=>{
  let f;
  f=setup({onChange(state){if(state.phase==="ready")f.controller.cancel();}});
  assert.equal(await f.controller.refresh(),false);
  assert.equal(f.controller.state.phase,"idle");
  assert.equal(f.controller.state.loaded,true,"cancellation does not undo already adopted records");
});

test("report set malformed async observer rejection is contained",()=>{
  const controllerUrl=new URL("../src/report-set-controller.js",import.meta.url).href;
  const fixtureUrl=new URL("./helpers/report-set-fixtures.js",import.meta.url).href;
  const child=spawnSync(process.execPath,["--unhandled-rejections=strict","--input-type=module","-e",`
    import { createReportSetController } from ${JSON.stringify(controllerUrl)};
    import { historyMemory,historyDocument } from ${JSON.stringify(fixtureUrl)};
    const store=historyMemory(historyDocument());
    const controller=createReportSetController({storage:store.storage,onChange:()=>({async then(){throw Error('synthetic observer');}})});
    if(!await controller.refresh())throw Error('load failed');
    setTimeout(()=>console.log('contained'),20);
  `],{timeout:10000,encoding:"utf8",windowsHide:true});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
  assert.equal(child.stderr,"");assert.equal(child.stdout.trim(),"contained");
});
