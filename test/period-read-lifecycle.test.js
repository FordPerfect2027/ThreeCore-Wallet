import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPeriodController } from "../src/period-controller.js";
import { validatePeriodProgress } from "../src/period-progress.js";
import { checkpoint, deferred } from "./helpers/period-fixtures.js";

const empty=checkpoint(0), complete=checkpoint(5);
function setup(options={}){
  const controller=createPeriodController({getContext:()=>empty.plan.context,read:async()=>complete,...options});
  return controller;
}
function accept(controller,value=empty){assert.equal(controller.stageSaved(value,{requiresNewPlan:false}),true);assert.equal(controller.apply(),true);}

for(const outcome of ["return","throw"]){
  test(`period start cancelled inside context ${outcome} never starts reader`,async()=>{
    let controller,armed=false,reads=0;
    controller=setup({getContext(){if(armed){controller.cancel();if(outcome==="throw")throw Error("old context");}return empty.plan.context;},
      read:async()=>{reads++;return complete;}});
    accept(controller);armed=true;
    assert.equal(await controller.start(),false);
    assert.equal(reads,0);
    assert.equal(controller.state.phase,"ready");
    assert.equal(controller.state.error,null);
  });
}

test("period cancelled checkpoint reflection cannot advance saved draft",async()=>{
  let config,once=false;
  const gate=deferred();
  const controller=setup({read(agent,plan,options){config=options;return gate.promise;}});
  accept(controller);const pending=controller.start();
  const value=new Proxy(checkpoint(1),{getOwnPropertyDescriptor(target,key){
    if(!once){once=true;controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  config.onCheckpoint(value);
  assert.equal(controller.state.draft.earlier,null);
  assert.equal(controller.state.phase,"ready");
  gate.resolve(complete);assert.equal(await pending,false);
});

test("period cancellation during final draft capture prevents complete status",async()=>{
  let controller,once=false;
  controller=setup({read:async(agent,plan,config)=>{
    config.onCheckpoint(complete);
    return new Proxy(complete,{getOwnPropertyDescriptor(target,key){
      if(!once){once=true;controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
    }});
  }});
  accept(controller);
  assert.equal(await controller.start(),false);
  assert.equal(controller.state.checkedThisSession,false);
  assert.equal(controller.state.phase,"ready");
});

test("period cancellation inside final context check prevents complete status",async()=>{
  let controller,armed=false;
  controller=setup({getContext(){if(armed)controller.cancel();return empty.plan.context;},
    read:async(agent,plan,config)=>{config.onCheckpoint(complete);armed=true;return complete;}});
  accept(controller);
  assert.equal(await controller.start(),false);
  assert.equal(controller.state.phase,"ready");
  assert.equal(controller.state.checkedThisSession,false);
});

test("period progress accessors are rejected without executing",()=>{
  let getters=0;
  assert.throws(()=>validatePeriodProgress({get stage(){getters++;return "complete";},checked:0,checks:0}),error=>error.code==="PERIOD_PROGRESS");
  assert.equal(getters,0);
});

test("period progress reflection cannot publish after cancellation",async()=>{
  let config,once=false;
  const gate=deferred();
  const controller=setup({read(agent,plan,options){config=options;return gate.promise;}});
  accept(controller);const pending=controller.start();
  config.onProgress(new Proxy({stage:"earlier",checked:0,checks:0},{getOwnPropertyDescriptor(target,key){
    if(!once){once=true;controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
  }}));
  assert.equal(controller.state.phase,"ready");assert.equal(controller.state.progress,null);
  gate.resolve(complete);assert.equal(await pending,false);
});

test("period outer abort retains a newer start and its signal",async()=>{
  let controller,second,secondSignal,index=0;
  const gates=[deferred(),deferred()];
  controller=setup({read(agent,plan,options){const i=index++;
    if(i===0)options.signal.addEventListener("abort",()=>{controller.cancel();second=controller.start();});
    else secondSignal=options.signal;
    return gates[i].promise;
  }});
  accept(controller);const first=controller.start();controller.cancel();
  assert.equal(controller.state.phase,"reading");
  controller.cancel();assert.equal(secondSignal.aborted,true);
  gates[0].resolve(complete);gates[1].resolve(complete);
  assert.equal(await first,false);assert.equal(await second,false);
});

test("period recursive observer cancellation is bounded",()=>{
  let controller,calls=0;
  controller=setup({onChange(){if(++calls<16)controller.cancel();}});
  controller.cancel();assert.ok(calls<=2,`received ${calls} notifications`);
});

test("period reconciliation callback cancellation cannot report delivery success",()=>{
  let controller;
  controller=setup({stageWorkspace(){controller.cancel();return true;}});
  accept(controller,complete);
  assert.equal(controller.sendToReconciliation(),false);
  assert.ok(!controller.state.message.includes("候補を送りました"));
});

for(const kind of ["observer","reconciliation"]){
  test(`period ${kind} rejected asynchronous callback is contained`,()=>{
    const sourceUrl=new URL("../src/period-controller.js",import.meta.url).href;
    const fixtureUrl=new URL("./helpers/period-fixtures.js",import.meta.url).href;
    const child=spawnSync(process.execPath,["--unhandled-rejections=strict","--input-type=module","-e",`
      import { createPeriodController } from ${JSON.stringify(sourceUrl)};
      import { checkpoint } from ${JSON.stringify(fixtureUrl)};
      const draft=checkpoint(5);
      const controller=createPeriodController({getContext:()=>draft.plan.context,read:async()=>draft,
        onChange:${kind==="observer"?"()=>({async then(){throw Error('synthetic observer');}})":"()=>{}"},
        stageWorkspace:${kind==="reconciliation"?"()=>Promise.reject(Error('synthetic delivery'))":"()=>true"}});
      controller.stageSaved(draft,{requiresNewPlan:false});controller.apply();
      ${kind==="reconciliation"?"if(controller.sendToReconciliation())throw Error('async delivery accepted');":"controller.cancel();"}
      setTimeout(()=>console.log('contained'),20);
    `],{timeout:10000,encoding:"utf8",windowsHide:true});
    assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);
    assert.equal(child.stderr,"");assert.equal(child.stdout.trim(),"contained");
  });
}
