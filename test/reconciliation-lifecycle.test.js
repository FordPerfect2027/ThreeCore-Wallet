import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createReconciliationController } from "../src/reconciliation-controller.js";
import { reconciliationErrorMessage, reconciliationReason } from "../src/reconciliation-view.js";
import { workspace, observation } from "./helpers/reconciliation-fixtures.js";

test("reconciliation observer cancellation is bounded",()=>{
  let controller,calls=0;
  controller=createReconciliationController({onStateChange(){if(++calls<16)controller.cancel();}});
  controller.propose(workspace());assert.ok(calls<=2,`received ${calls} notifications`);
});
test("reconciliation malformed asynchronous observer rejection is contained",()=>{
  const url=new URL("../src/reconciliation-controller.js",import.meta.url).href;
  const child=spawnSync(process.execPath,["--unhandled-rejections=strict","--input-type=module","-e",`
    import {createReconciliationController} from ${JSON.stringify(url)};
    const controller=createReconciliationController({onStateChange:()=>({async then(){throw Error('synthetic');}})});
    controller.cancel();setTimeout(()=>console.log('contained'),15);
  `],{timeout:10000,encoding:"utf8",windowsHide:true});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),"contained");
});
for(const action of ["cancel","dispose","invalidateSources"]){
  test(`reconciliation ${action} during card capture prevents a stale review`,()=>{
    let controller;
    controller=createReconciliationController({readObservation(){controller[action]();return observation();}});
    assert.equal(controller.capture("earlier"),false);assert.equal(controller.state.review,null);assert.equal(controller.state.error,null);
  });
}
test("reconciliation cancellation during proposed data capture prevents review",()=>{
  let controller,once=false;
  controller=createReconciliationController();
  const next=new Proxy(workspace(),{getOwnPropertyDescriptor(target,key){if(!once){once=true;controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);}});
  assert.equal(controller.propose(next),false);assert.equal(controller.state.review,null);
});
test("reconciliation older proposal cannot overwrite a newer proposal",()=>{
  let controller,once=false;controller=createReconciliationController();
  const next=new Proxy(workspace(),{getOwnPropertyDescriptor(target,key){if(!once){once=true;controller.propose(workspace([]));}return Reflect.getOwnPropertyDescriptor(target,key);}});
  assert.equal(controller.propose(next),false);assert.equal(controller.state.review.changes.length,0);
});
test("reconciliation loading observer cancellation prevents file reading",async()=>{
  let controller,reads=0;
  controller=createReconciliationController({readFile:async()=>{reads++;return workspace();},onStateChange(state){if(state.busy)controller.cancel();}});
  assert.equal(await controller.importFile({},"workspace"),false);assert.equal(reads,0);
});
test("reconciliation preparing observer cancellation prevents file preparation",async()=>{
  let controller,preparations=0,deliveries=0;
  controller=createReconciliationController({initial:workspace(),prepareFile:async()=>{preparations++;return {};},onStateChange(state){if(state.busy)controller.cancel();}});
  assert.equal(await controller.exportFile("json",()=>{deliveries++;}),false);assert.equal(preparations,0);assert.equal(deliveries,0);
});
test("reconciliation imported result cancelled during capture cannot publish review",async()=>{
  let controller,once=false;
  const next=new Proxy(workspace(),{getOwnPropertyDescriptor(target,key){if(!once){once=true;controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);}});
  controller=createReconciliationController({readFile:async()=>next});
  assert.equal(await controller.importFile({},"workspace"),false);assert.equal(controller.state.review,null);assert.equal(controller.state.busy,false);
});
test("reconciliation cancelled final review notification returns false",async()=>{
  let controller;
  controller=createReconciliationController({readFile:async()=>workspace(),onStateChange(state){if(state.review)controller.cancel();}});
  assert.equal(await controller.importFile({},"workspace"),false);assert.equal(controller.state.review,null);
});
test("reconciliation cancelled export notification cannot report success",async()=>{
  let controller,deliveries=0;
  controller=createReconciliationController({initial:workspace(),prepareFile:async()=>({text:"synthetic"}),
    onStateChange(state){if(!state.busy&&state.exportedCurrent)controller.cancel();}});
  assert.equal(await controller.exportFile("json",()=>{deliveries++;}),false);assert.equal(deliveries,1);
});
test("reconciliation diagnostic accessor is never executed",()=>{
  let gets=0;const fallback=reconciliationErrorMessage(null);
  assert.equal(reconciliationErrorMessage({get code(){gets++;return "RECONCILIATION_NO_SOURCE";}}),fallback);assert.equal(gets,0);
});
test("reconciliation inaccessible diagnostic falls back to text",()=>{
  const revoked=Proxy.revocable({},{});revoked.revoke();assert.equal(reconciliationErrorMessage(revoked.proxy),reconciliationErrorMessage(null));
});
test("reconciliation diagnostic reflection cancellation preserves stopped state",()=>{
  let controller;
  const error=new Proxy({code:"RECONCILIATION_NO_SOURCE"},{getOwnPropertyDescriptor(target,key){controller.cancel();return Reflect.getOwnPropertyDescriptor(target,key);}});
  controller=createReconciliationController({readObservation(){throw error;}});
  assert.equal(controller.capture("earlier"),false);assert.equal(controller.state.error,null);
});
test("reconciliation diagnostic object codes are not coerced",()=>{
  let coerced=0;assert.equal(reconciliationErrorMessage({code:{toString(){coerced++;return "RECONCILIATION_NO_SOURCE";}}}),reconciliationErrorMessage(null));assert.equal(coerced,0);
});
test("reconciliation lookup inherited names remain ordinary fallback text",()=>{
  for(const code of ["constructor","toString","__proto__"]){
    assert.equal(reconciliationErrorMessage({code}),reconciliationErrorMessage(null));
    assert.equal(reconciliationReason(code),"記録を確認してください。");
  }
});
