import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPeriodReportController } from "../src/period-report-controller.js";
import { reportInput, reportLibrary, memoryStorage, selection, LATER, clone } from "./helpers/period-report-fixtures.js";

const document=reportLibrary();
const saved=reportInput();
function setup(options={}){
  const store=memoryStorage(document);
  const controller=createPeriodReportController({storage:store.storage,now:()=>LATER,...options});
  return {store,controller};
}
async function choose(f){await f.controller.refresh();for(const [agent,id] of Object.entries(selection()))f.controller.select(agent,id);}

for(const action of ["cancel","invalidateReview","select"]){
  test(`period report ${action} during clock cannot restore old selection review`,async()=>{
    let f,armed=false;
    f=setup({now(){if(armed){if(action==="select")f.controller.select("DAT",null);else f.controller[action]();}return LATER;}});
    await choose(f);armed=true;
    assert.equal(f.controller.prepare("Old"),false);
    assert.equal(f.controller.state.review,null);
  });
}

test("period report cancelled history capture cannot stage evidence",()=>{
  const f=setup();let once=false;
  const value=new Proxy(clone(saved),{getOwnPropertyDescriptor(target,key){
    if(!once){once=true;f.controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  assert.equal(f.controller.stageHistory(value),false);
  assert.equal(f.controller.state.review,null);
});

test("period report invalid new history handoff retires previous review",async()=>{
  const f=setup();assert.equal(f.controller.stageHistory(saved),true);
  assert.equal(f.controller.stageHistory({invalid:true}),false);
  assert.equal(f.controller.state.review,null);
  assert.equal(await f.controller.applyReview(),false);
  assert.equal(f.controller.state.input,null);
});

test("period report cancelled storage capture cannot adopt records",async()=>{
  let f,once=false;
  const value=clone(document);
  f=setup({storage:{async read(){return new Proxy(value,{getOwnPropertyDescriptor(target,key){
    if(!once){once=true;f.controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
  }});},close(){}}});
  assert.equal(await f.controller.refresh(),false);
  assert.equal(f.controller.state.loaded,false);
  assert.equal(f.controller.state.document.entries.length,0);
});

for(const point of ["input","checksum"]){
  test(`period report cancelled import ${point} cannot recreate review`,async()=>{
    let f,once=false;
    const value=clone(saved);
    const input=point==="checksum"?value:new Proxy(value,{getOwnPropertyDescriptor(target,key){
      if(!once){once=true;f.controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
    }});
    f=setup({readFile:async()=>point==="input"?{input,checksumVerified:true}:{input,get checksumVerified(){f.controller.cancel();return true;}}});
    assert.equal(await f.controller.importFile({}),false);
    assert.equal(f.controller.state.review,null);
  });
}

test("period report recursive observer cancellation is bounded",async()=>{
  let f,calls=0;
  f=setup({onChange(){if(++calls<16)f.controller.cancel();}});
  assert.equal(await f.controller.refresh(),false);
  assert.ok(calls<=2,`received ${calls} notifications`);
  assert.equal(f.store.calls.length,0);
});

test("period report cancellation during ready notification retires return status",async()=>{
  let f;
  f=setup({onChange(state){if(state.phase==="ready")f.controller.cancel();}});
  assert.equal(await f.controller.refresh(),false);
  assert.equal(f.controller.state.phase,"idle");
  assert.equal(f.controller.state.loaded,true);
});

test("period report malformed asynchronous observer rejection is contained",()=>{
  const sourceUrl=new URL("../src/period-report-controller.js",import.meta.url).href;
  const fixtureUrl=new URL("./helpers/period-report-fixtures.js",import.meta.url).href;
  const child=spawnSync(process.execPath,["--unhandled-rejections=strict","--input-type=module","-e",`
    import { createPeriodReportController } from ${JSON.stringify(sourceUrl)};
    import { memoryStorage,library } from ${JSON.stringify(fixtureUrl)};
    const store=memoryStorage(library());
    const controller=createPeriodReportController({storage:store.storage,onChange:()=>({async then(){throw Error('synthetic callback');}})});
    if(!await controller.refresh())throw Error('load failed');
    setTimeout(()=>console.log('contained'),20);
  `],{timeout:10000,encoding:"utf8",windowsHide:true});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
  assert.equal(child.stderr,"");assert.equal(child.stdout.trim(),"contained");
});
