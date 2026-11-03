import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPeriodLibraryController } from "../src/period-library-controller.js";
import { memoryStorage, checkpoint, library, entry, id, TIME, deferred } from "./helpers/period-library-fixtures.js";

function setup(options={}) {
  const store=memoryStorage();
  const source={draft:checkpoint(3),requiresNewPlan:false};
  const controller=createPeriodLibraryController({storage:store.storage,getCheckpoint:()=>source,
    stageCheckpoint:()=>true,now:()=>TIME,createId:()=>id(20),...options});
  return {store,source,controller};
}

test("period library captures checkpoint flag from its data descriptor",async()=>{
  const source={draft:checkpoint(3),requiresNewPlan:false};
  let gets=0;
  const f=setup({getCheckpoint:()=>new Proxy(source,{get(target,key){gets++;return key==="requiresNewPlan"?true:Reflect.get(target,key);}})});
  await f.controller.refresh();
  assert.equal(f.controller.prepareSave("Captured"),true);
  assert.equal(gets,0);
  assert.equal(f.controller.state.review.entry.requiresNewPlan,false);
});

for(const point of ["source","clock","id","reflection"]) {
  test(`period library cancellation during ${point} prevents review and later callbacks`,async()=>{
    let f,armed=false,clockCalls=0,idCalls=0;
    const source={draft:checkpoint(3),requiresNewPlan:false};
    f=setup({getCheckpoint(){
      if(armed&&point==="source")f.controller.cancel();
      return point!=="reflection"?source:new Proxy(source,{getOwnPropertyDescriptor(target,key){
        if(armed){armed=false;f.controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
      }});
    },now(){clockCalls++;if(armed&&point==="clock")f.controller.cancel();return TIME;},
    createId(){idCalls++;if(armed&&point==="id")f.controller.cancel();return id(20);}});
    await f.controller.refresh();armed=true;
    assert.equal(f.controller.prepareSave("Cancelled"),false);
    assert.equal(f.controller.state.phase,"idle");
    assert.equal(f.controller.state.review,null);
    if(["source","reflection"].includes(point))assert.equal(clockCalls,0);
    if(point!=="id")assert.equal(idCalls,0);
  });
}

test("period library cancelled source recheck never begins a storage write",async()=>{
  let f,armed=false;
  f=setup({getCheckpoint(){if(armed){armed=false;f.controller.cancel();}return f.source;}});
  await f.controller.refresh();f.controller.prepareSave("Old");armed=true;
  assert.equal(await f.controller.applyReview(),false);
  assert.equal(f.store.calls.filter(call=>call[0]==="change").length,0);
  assert.equal(f.controller.state.phase,"idle");
});

test("period library old apply preserves a newer review created during source check",async()=>{
  let f,armed=false;
  f=setup({getCheckpoint(){if(armed){armed=false;f.controller.cancel();f.controller.prepareSave("New review");}return f.source;}});
  await f.controller.refresh();f.controller.prepareSave("Old review");armed=true;
  assert.equal(await f.controller.applyReview(),false);
  assert.equal(f.store.calls.filter(call=>call[0]==="change").length,0);
  assert.equal(f.controller.state.review.entry.label,"New review");
});

test("period library source failure after cancellation cannot replace idle status",async()=>{
  let f,armed=false;
  f=setup({getCheckpoint(){if(armed){f.controller.cancel();throw Error("old source failure");}return f.source;}});
  await f.controller.refresh();armed=true;
  assert.equal(f.controller.prepareSave("Old"),false);
  assert.equal(f.controller.state.phase,"idle");
  assert.equal(f.controller.state.error,null);
});

test("period library cancelled document capture cannot adopt late storage data",async()=>{
  let f,once=false;
  const stored=structuredClone(library([entry()]));
  const store={async read(){return new Proxy(stored,{getOwnPropertyDescriptor(target,key){
    if(!once){once=true;f.controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
  }});},async change(){throw Error("unused");},close(){}};
  f=setup({storage:store});
  assert.equal(await f.controller.refresh(),false);
  assert.equal(f.controller.state.loaded,false);
  assert.equal(f.controller.state.document.entries.length,0);
  assert.equal(f.controller.state.phase,"idle");
});

test("period library observer recursive cancellation is bounded",async()=>{
  let f,calls=0;
  f=setup({onChange(){if(++calls<16)f.controller.cancel();}});
  assert.equal(await f.controller.refresh(),false);
  assert.ok(calls<=2,`received ${calls} notifications`);
  assert.equal(f.store.calls.length,0);
});

test("period library outer abort preserves a newly started refresh and its signal",async()=>{
  let f,second,secondSignal,index=0;
  const gates=[deferred(),deferred()];
  const storage={read(options){const i=index++;
    if(i===0)options.signal.addEventListener("abort",()=>{f.controller.cancel();second=f.controller.refresh();});
    else secondSignal=options.signal;
    return gates[i].promise;
  },async change(){throw Error("unused");},close(){}};
  f=setup({storage});
  const first=f.controller.refresh();f.controller.cancel();
  assert.equal(f.controller.state.phase,"loading");
  f.controller.cancel();assert.equal(secondSignal.aborted,true);
  gates[0].resolve(library());gates[1].resolve(library());
  assert.equal(await first,false);assert.equal(await second,false);
});

test("period library rename cancelled by clock never writes storage",async()=>{
  const store=memoryStorage(library([entry()]));
  let f,armed=false;
  f=setup({storage:store.storage,now(){if(armed)f.controller.cancel();return TIME;}});
  await f.controller.refresh();f.controller.select(id(1));armed=true;
  assert.equal(await f.controller.edit("rename","New name"),false);
  assert.equal(store.calls.filter(call=>call[0]==="change").length,0);
  assert.equal(f.controller.state.phase,"idle");
});

test("period library comparison cancelled by source cannot publish text",async()=>{
  const store=memoryStorage(library([entry()]));
  let f,armed=false;
  f=setup({storage:store.storage,getCheckpoint(){if(armed)f.controller.cancel();return f.source;}});
  await f.controller.refresh();f.controller.select(id(1));armed=true;
  assert.equal(f.controller.compare(),false);
  assert.equal(f.controller.state.phase,"idle");
  assert.equal(f.controller.state.comparison,"");
});

test("period library cancelled import analysis cannot recreate review",async()=>{
  let f;
  f=setup({readFile:async()=>({get document(){f.controller.cancel();return library([entry()]);}})});
  await f.controller.refresh();
  assert.equal(await f.controller.importFile({}),false);
  assert.equal(f.controller.state.review,null);
  assert.equal(f.controller.state.phase,"idle");
});

for(const kind of ["observer","receiver"]) {
  test(`period library ${kind} asynchronous then rejection is contained`,()=>{
    const sourceUrl=new URL("../src/period-library-controller.js",import.meta.url).href;
    const fixtureUrl=new URL("./helpers/period-library-fixtures.js",import.meta.url).href;
    const child=spawnSync(process.execPath,["--unhandled-rejections=strict","--input-type=module","-e",`
      import { createPeriodLibraryController } from ${JSON.stringify(sourceUrl)};
      import { memoryStorage,library,entry,id } from ${JSON.stringify(fixtureUrl)};
      const bad=()=>({async then(){throw Error('synthetic rejection');}});
      const store=memoryStorage(library([entry()]));
      const controller=createPeriodLibraryController({storage:store.storage,getCheckpoint:()=>null,
        stageCheckpoint:${kind==="receiver"?"bad":"()=>true"},onChange:${kind==="observer"?"bad":"()=>{}"}});
      if(!await controller.refresh())throw Error('load failed');
      ${kind==="receiver"?"controller.select(id(1));controller.prepareRestore();if(await controller.applyReview())throw Error('async delivery accepted');":""}
      setTimeout(()=>console.log('contained'),20);
    `],{timeout:10000,encoding:"utf8",windowsHide:true});
    assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
    assert.equal(child.stderr,"");assert.equal(child.stdout.trim(),"contained");
  });
}
