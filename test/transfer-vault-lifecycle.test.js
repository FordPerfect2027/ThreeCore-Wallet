import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createVaultController } from "../src/transfer-vault-controller.js";
import { emptyVaultDocument,mutateVaultDocument } from "../src/transfer-vault-model.js";
import { controllerFixture,bundleFor,memoryVault,saveOperation,id,TIME } from "./helpers/vault-fixtures.js";
import { deferred } from "./helpers/transfer-fixtures.js";

test("vault observer cancellation delivery is bounded",async()=>{
  let controller,calls=0;
  const f=controllerFixture({onChange(){if(++calls<16)controller.cancel();}});controller=f.controller;
  assert.equal(await controller.refresh(),false);assert.ok(calls<=2,`received ${calls} notifications`);assert.equal(f.storage.calls.length,0);
});
test("vault disposal closes observers before clearing local state",()=>{
  const f=controllerFixture();f.controller.capture();const count=f.states.length;f.controller.dispose();
  assert.equal(f.states.length,count);assert.equal(f.controller.state.disposed,true);assert.equal(f.controller.state.review,null);
});
test("vault malformed asynchronous observer rejection is contained",()=>{
  const fixtures=new URL("./helpers/vault-fixtures.js",import.meta.url).href;
  const child=spawnSync(process.execPath,["--unhandled-rejections=strict","--input-type=module","-e",`
    import {controllerFixture} from ${JSON.stringify(fixtures)};
    const f=controllerFixture({onChange:()=>({async then(){throw Error('synthetic');}})});
    if(!await f.controller.refresh())throw Error('read failed');
    setTimeout(()=>console.log('contained'),15);
  `],{timeout:10000,encoding:"utf8",windowsHide:true});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),"contained");
});
for(const action of ["cancel","dispose","invalidateCards"]){
  test(`vault ${action} inside card capture prevents a stale review`,()=>{
    let controller;
    const f=controllerFixture({readCards(){controller[action]();return bundleFor();}});controller=f.controller;
    assert.equal(controller.capture(),false);assert.equal(controller.state.review,null);assert.equal(controller.state.hasRecords,false);
  });
}
test("vault card invalidation during apply revokes the captured review",async()=>{
  let controller,armed=false;
  const f=controllerFixture({readCards(){if(armed){armed=false;controller.invalidateCards();}return bundleFor();}});controller=f.controller;
  controller.capture();const reviewId=controller.state.review.id;armed=true;
  assert.equal(await controller.apply(reviewId),false);assert.equal(controller.state.hasRecords,false);assert.equal(controller.state.review,null);
});
test("vault apply does not execute an acknowledgement accessor",async()=>{
  let gets=0;const f=controllerFixture();f.controller.capture();const reviewId=f.controller.state.review.id;
  assert.equal(await f.controller.apply(reviewId,{get acknowledgeRemoval(){gets++;return true;}}),false);
  assert.equal(gets,0);assert.equal(f.controller.state.hasRecords,false);
});
test("vault refresh capture cancelled during reflection cannot adopt a document",async()=>{
  let controller,once=false;
  const document=mutateVaultDocument(emptyVaultDocument(),0,saveOperation());
  const storage={read:async()=>new Proxy(document,{getOwnPropertyDescriptor(target,key){if(!once){once=true;controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);}}),change(){throw Error('unexpected');},close(){}};
  const f=controllerFixture({storage});controller=f.controller;
  assert.equal(await controller.refresh(),false);assert.equal(controller.state.metadata,null);assert.equal(controller.state.lastAction,"cancel");
});
test("vault cancelled ID generation does not call a later clock",async()=>{
  let controller,clocks=0;
  const f=controllerFixture({createId(){controller.cancel();return id(1);},now(){clocks++;return TIME;}});controller=f.controller;
  await f.capture();await controller.refresh();
  assert.equal(await controller.save("Synthetic"),false);assert.equal(clocks,0);assert.equal(f.storage.calls.filter(v=>v.method==="change").length,0);
});
test("vault cancelled clock cannot start an old write using a newer read",async()=>{
  let controller,armed=false,nested;
  const gate=deferred(),storage=memoryVault();
  const read=storage.read;storage.read=options=>armed?gate.promise:read(options);
  const f=controllerFixture({storage,now(){armed=true;controller.cancel();nested=controller.refresh();return TIME;}});controller=f.controller;
  await f.capture();await controller.refresh();
  assert.equal(await controller.save("Synthetic"),false);assert.equal(storage.calls.filter(v=>v.method==="change").length,0);
  gate.resolve(emptyVaultDocument());assert.equal(await nested,true);
});
test("vault error diagnostic accessor is never executed",async()=>{
  let gets=0;
  const f=controllerFixture({storage:{read:async()=>{throw {get code(){gets++;return "CHECKPOINT_STALE";}};},change(){},close(){}}});
  assert.equal(await f.controller.refresh(),false);assert.equal(gets,0);assert.equal(f.controller.state.error,"TRANSFER_VAULT_ACTION");
});
test("vault cancelled diagnostic reflection cannot publish an old failure",async()=>{
  let controller;
  const error=new Proxy({code:"CHECKPOINT_STALE"},{getOwnPropertyDescriptor(target,key){controller.cancel();return Reflect.getOwnPropertyDescriptor(target,key);}});
  const f=controllerFixture({storage:{read:async()=>{throw error;},change(){},close(){}}});controller=f.controller;
  assert.equal(await controller.refresh(),false);assert.equal(controller.state.error,null);assert.equal(controller.state.lastAction,"cancel");
});
test("vault cancellation from final notification cannot report success",async()=>{
  let controller;
  const f=controllerFixture({onChange(state){if(!state.busy&&state.lastAction==="refresh")controller.cancel();}});controller=f.controller;
  assert.equal(await controller.refresh(),false);assert.equal(controller.state.lastAction,"cancel");
});
test("vault abort callback starting a newer read retains its cancellation handle",async()=>{
  let controller,nested;const signals=[],gates=[deferred(),deferred()];
  const storage={read(options){const index=signals.length;signals.push(options.signal);if(index===0)options.signal.addEventListener("abort",()=>{nested=controller.refresh();});return gates[index].promise;},change(){},close(){}};
  const f=controllerFixture({storage});controller=f.controller;
  const first=controller.refresh();controller.cancel();assert.equal(signals.length,2);
  controller.cancel();assert.equal(signals[1].aborted,true);
  gates.forEach(g=>g.resolve(emptyVaultDocument()));assert.equal(await first,false);assert.equal(await nested,false);
});
