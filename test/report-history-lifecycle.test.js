import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { historyMemory, historyDocument, historyRecord, reportInput, id, LATER, clone, deferred } from "./helpers/report-history-fixtures.js";

const source=reportInput();
function setup(options={},initial=historyDocument()){
  const store=historyMemory(initial);
  const controller=createReportHistoryController({storage:store.storage,getReport:()=>source,stageReport:()=>true,
    now:()=>LATER,createId:()=>id(250),...options});
  return {store,controller};
}
const prepare=c=>c.prepareSave({label:"Local report",note:"",tags:[]});

for(const point of ["source","clock","id"]){
  test(`report history ${point} cancellation retires save review`,async()=>{
    let f,armed=false,clocks=0,ids=0;
    f=setup({getReport(){if(armed&&point==="source")f.controller.cancel();return source;},
      now(){clocks++;if(armed&&point==="clock")f.controller.cancel();return LATER;},
      createId(){ids++;if(armed&&point==="id")f.controller.cancel();return id(250);}});
    await f.controller.refresh();armed=true;
    assert.equal(prepare(f.controller),false);
    assert.equal(f.controller.state.phase,"idle");
    assert.equal(f.controller.state.review,null);
    if(point==="source")assert.equal(clocks,0);
    if(point!=="id")assert.equal(ids,0);
  });
}

test("report history metadata accessors are not executed",async()=>{
  const f=setup();await f.controller.refresh();
  let getters=0;
  assert.equal(f.controller.prepareSave({get label(){getters++;return "Injected";}}),false);
  assert.equal(getters,0);
  assert.equal(f.controller.state.review,null);
});

test("report history review invalidation during source callback stays invalidated",async()=>{
  let f,armed=false;
  f=setup({getReport(){if(armed)f.controller.invalidateReview();return source;}});
  await f.controller.refresh();armed=true;
  assert.equal(prepare(f.controller),false);
  assert.equal(f.controller.state.review,null);
});

test("report history cancelled source recheck never calls storage change",async()=>{
  let f,armed=false;
  f=setup({getReport(){if(armed){armed=false;f.controller.cancel();}return source;}});
  await f.controller.refresh();prepare(f.controller);armed=true;
  assert.equal(await f.controller.applyReview(),false);
  assert.equal(f.store.calls.filter(call=>call[0]==="change").length,0);
  assert.equal(f.store.document.entries.length,0);
});

test("report history cancellation inside commit authorization prevents persistence",async()=>{
  let f;
  f=setup({getReport(){if(f.controller.state.phase==="saving")f.controller.cancel();return source;}});
  await f.controller.refresh();prepare(f.controller);
  assert.equal(await f.controller.applyReview(),false);
  assert.equal(f.store.document.entries.length,0);
  assert.equal(f.controller.state.loaded,false);
});

test("report history old apply cannot consume a new save review",async()=>{
  let f,armed=false;
  f=setup({getReport(){if(armed){armed=false;f.controller.cancel();f.controller.prepareSave({label:"New review"});}return source;}});
  await f.controller.refresh();prepare(f.controller);armed=true;
  assert.equal(await f.controller.applyReview(),false);
  assert.equal(f.store.document.entries.length,0);
  assert.equal(f.controller.state.review.entry.label,"New review");
});

test("report history cancelled open preparation cannot recreate review",async()=>{
  let f,armed=false;
  f=setup({getReport(){if(armed)f.controller.cancel();return source;}},historyDocument([historyRecord()]));
  await f.controller.refresh();f.controller.select(id(101));armed=true;
  assert.equal(f.controller.prepareOpen(),false);
  assert.equal(f.controller.state.review,null);
});

test("report history cancellation inside final open source check prevents delivery",async()=>{
  let f,deliveries=0;
  f=setup({getReport(){if(f.controller.state.phase==="opening")f.controller.cancel();return source;},
    stageReport(){deliveries++;return true;}},historyDocument([historyRecord()]));
  await f.controller.refresh();f.controller.select(id(101));f.controller.prepareOpen();
  assert.equal(await f.controller.applyReview(),false);
  assert.equal(deliveries,0);
});

for(const action of ["annotate","archive"]){
  test(`report history ${action} cancelled by clock never writes`,async()=>{
    let f,armed=false;
    f=setup({now(){if(armed)f.controller.cancel();return LATER;}},historyDocument([historyRecord()]));
    await f.controller.refresh();f.controller.select(id(101));armed=true;
    const result=action==="archive"?await f.controller.archive(true):await f.controller.annotate({label:"Changed",note:"",tags:[]});
    assert.equal(result,false);
    assert.equal(f.store.calls.filter(call=>call[0]==="change").length,0);
  });
}

test("report history cancelled validation cannot adopt a storage response",async()=>{
  let f,once=false;
  const document=clone(historyDocument([historyRecord()]));
  const storage={async read(){return new Proxy(document,{getOwnPropertyDescriptor(target,key){
    if(!once){once=true;f.controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
  }});},async change(){throw Error("unused");},close(){}};
  f=setup({storage});
  assert.equal(await f.controller.refresh(),false);
  assert.equal(f.controller.state.loaded,false);
  assert.equal(f.controller.state.document.entries.length,0);
});

test("report history recursive observer cancellation is bounded",async()=>{
  let f,calls=0;
  f=setup({onChange(){if(++calls<16)f.controller.cancel();}});
  assert.equal(await f.controller.refresh(),false);
  assert.ok(calls<=2,`received ${calls} notifications`);
  assert.equal(f.store.calls.length,0);
});

test("report history outer abort preserves a newly started refresh",async()=>{
  let f,second,signal,index=0;
  const gates=[deferred(),deferred()];
  const storage={read(options){const i=index++;
    if(i===0)options.signal.addEventListener("abort",()=>{f.controller.cancel();second=f.controller.refresh();});
    else signal=options.signal;
    return gates[i].promise;
  },async change(){throw Error("unused");},close(){}};
  f=setup({storage});
  const first=f.controller.refresh();f.controller.cancel();
  assert.equal(f.controller.state.phase,"loading");
  f.controller.cancel();assert.equal(signal.aborted,true);
  gates[0].resolve(historyDocument());gates[1].resolve(historyDocument());
  assert.equal(await first,false);assert.equal(await second,false);
});

for(const kind of ["observer","receiver"]){
  test(`report history ${kind} asynchronous then rejection is contained`,()=>{
    const controllerUrl=new URL("../src/report-history-controller.js",import.meta.url).href;
    const fixtureUrl=new URL("./helpers/report-history-fixtures.js",import.meta.url).href;
    const child=spawnSync(process.execPath,["--unhandled-rejections=strict","--input-type=module","-e",`
      import { createReportHistoryController } from ${JSON.stringify(controllerUrl)};
      import { historyMemory,historyDocument,historyRecord,id } from ${JSON.stringify(fixtureUrl)};
      const store=historyMemory(historyDocument([historyRecord()]));
      const bad=()=>({async then(){throw Error('synthetic callback');}});
      const controller=createReportHistoryController({storage:store.storage,getReport:()=>null,
        stageReport:${kind==="receiver"?"bad":"()=>true"},onChange:${kind==="observer"?"bad":"()=>{}"}});
      if(!await controller.refresh())throw Error('load failed');
      ${kind==="receiver"?"controller.select(id(101));controller.prepareOpen();if(await controller.applyReview())throw Error('async delivery accepted');":""}
      setTimeout(()=>console.log('contained'),20);
    `],{timeout:10000,encoding:"utf8",windowsHide:true});
    assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
    assert.equal(child.stderr,"");assert.equal(child.stdout.trim(),"contained");
  });
}
