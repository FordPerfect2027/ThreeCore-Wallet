import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { createTransferController } from "../src/transfer-controller.js";
import { encodeTransferFile } from "../src/transfer-file.js";
import { context, snapshot, REQUEST, deferred, fileFromText } from "./helpers/transfer-fixtures.js";

test("transfer observer cancellation delivery is bounded", async () => {
  let controller, calls = 0, reads = 0;
  controller = createTransferController({ getContext: context, read: async () => { reads++; return snapshot(); },
    onChange() { if (++calls < 16) controller.cancel(); },
  });
  assert.equal(await controller.inspect(REQUEST), false);
  assert.equal(reads,0);
  assert.ok(calls<=2, `received ${calls} notifications`);
});

test("transfer disposal closes observers before clearing data", async () => {
  let calls = 0;
  const controller = createTransferController({ getContext: context, read: async () => snapshot(), onChange() { calls++; } });
  await controller.inspect(REQUEST);
  const before = calls;
  controller.dispose();
  assert.equal(calls,before);
  assert.equal(controller.state.phase,"disposed");
  assert.equal(controller.state.snapshot,null);
});

test("transfer observer malformed async then rejection is contained", () => {
  const controllerUrl = new URL("../src/transfer-controller.js",import.meta.url).href;
  const fixtureUrl = new URL("./helpers/transfer-fixtures.js",import.meta.url).href;
  const child = spawnSync(process.execPath,["--unhandled-rejections=strict","--input-type=module","-e",`
    import { createTransferController } from ${JSON.stringify(controllerUrl)};
    import { context,snapshot,REQUEST } from ${JSON.stringify(fixtureUrl)};
    const controller=createTransferController({getContext:context,read:async()=>snapshot(),
      onChange:()=>({async then(){throw Error('synthetic callback');}})});
    if(!await controller.inspect(REQUEST))throw Error('read failed');
    setTimeout(()=>console.log('contained'),15);
  `],{timeout:10000,encoding:"utf8",windowsHide:true});
  assert.equal(child.error,undefined);
  assert.equal(child.status,0,child.stderr);
  assert.equal(child.stderr,"");
  assert.equal(child.stdout.trim(),"contained");
});

for (const at of [1,2]) for (const action of ["cancel","dispose"]) {
  test(`transfer ${action} during context call ${at} prevents read`,async()=>{
    let controller, calls=0, reads=0;
    controller=createTransferController({getContext(){if(++calls===at)controller[action]();return context();},
      read:async()=>{reads++;return snapshot();}});
    assert.equal(await controller.inspect(REQUEST),false);
    assert.equal(reads,0);
    assert.equal(controller.state.phase,action==="cancel"?"cancelled":"disposed");
  });
}

test("transfer cancellation during result capture cannot publish snapshot",async()=>{
  let controller,once=false;
  controller=createTransferController({getContext:context,read:async()=>new Proxy(snapshot(),{
    getOwnPropertyDescriptor(target,key){if(!once){once=true;controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);}
  })});
  assert.equal(await controller.inspect(REQUEST),false);
  assert.equal(controller.state.phase,"cancelled");
  assert.equal(controller.state.snapshot,null);
});

test("transfer abort callback starting another read keeps the newer abort handle",async()=>{
  let controller,second,secondSignal,index=0;
  const gates=[deferred(),deferred()];
  controller=createTransferController({getContext:context,read(request,options){
    const i=index++;
    if(i===0)options.signal.addEventListener("abort",()=>{second=controller.inspect(REQUEST);});
    else secondSignal=options.signal;
    return gates[i].promise;
  }});
  const first=controller.inspect(REQUEST);
  controller.cancel();
  assert.equal(controller.state.phase,"reading");
  controller.cancel();
  assert.equal(secondSignal.aborted,true);
  gates[0].resolve(snapshot());gates[1].resolve(snapshot());
  assert.equal(await first,false);assert.equal(await second,false);
});

test("transfer load cancelled by display never starts file read",async()=>{
  const saved=fileFromText(await encodeTransferFile(snapshot()));
  let controller,reads=0;
  const file={...saved,arrayBuffer:async()=>{reads++;return saved.arrayBuffer();}};
  controller=createTransferController({getContext:context,read:async()=>snapshot(),
    onChange(state){if(state.phase==="loading")controller.cancel();}});
  assert.equal(await controller.stageFile(file),false);
  assert.equal(reads,0);
  assert.equal(controller.state.preview,null);
});

test("transfer preparation cancelled by display never starts hashing",async()=>{
  let controller,digests=0;
  controller=createTransferController({getContext:context,read:async()=>snapshot(),
    subtle:{digest(...args){digests++;return webcrypto.subtle.digest(...args);}},
    onChange(state){if(state.phase==="preparing")controller.cancel();}});
  await controller.inspect(REQUEST);
  assert.equal(await controller.prepare(),null);
  assert.equal(digests,0);
});

test("transfer cancelled import apply does not replace cancellation with error",async()=>{
  let controller,armed=false;
  controller=createTransferController({getContext(){if(armed){armed=false;controller.cancel();}return context();},read:async()=>snapshot()});
  await controller.stageFile(fileFromText(await encodeTransferFile(snapshot())));
  const id=controller.state.preview.id;
  armed=true;
  assert.equal(controller.applyImport(id),false);
  assert.equal(controller.state.phase,"cancelled");
  assert.equal(controller.state.error,null);
});

test("transfer old import apply preserves a newer file review",async()=>{
  const firstFile=fileFromText(await encodeTransferFile(snapshot()));
  const nextFile=fileFromText(await encodeTransferFile(snapshot({events:[]})));
  let controller,armed=false,nested;
  controller=createTransferController({getContext(){if(armed){armed=false;nested=controller.stageFile(nextFile);}return context();},read:async()=>snapshot()});
  await controller.stageFile(firstFile);
  const id=controller.state.preview.id;
  armed=true;
  assert.equal(controller.applyImport(id),false);
  assert.equal(await nested,true);
  assert.equal(controller.state.phase,"preview");
  assert.equal(controller.state.preview.snapshot.events.length,0);
});

test("transfer progress accessor cannot cancel the active read",async()=>{
  let controller,update,getters=0;
  const gate=deferred();
  controller=createTransferController({getContext:context,read(request,options){update=options.onProgress;return gate.promise;}});
  const pending=controller.inspect(REQUEST);
  update({get stage(){getters++;controller.cancel();return "complete";},completed:1,total:1});
  assert.equal(getters,0);
  assert.equal(controller.state.progress,null);
  assert.equal(controller.state.phase,"reading");
  gate.resolve(snapshot());assert.equal(await pending,true);
});

test("transfer error accessor is not executed",async()=>{
  let getters=0;
  const controller=createTransferController({getContext:context,read:async()=>{throw {get code(){getters++;return "TRANSFER_CANCELLED";}};}});
  assert.equal(await controller.inspect(REQUEST),false);
  assert.equal(getters,0);
  assert.equal(controller.state.error,"TRANSFER_OPERATION_FAILED");
});

test("transfer cancelled diagnostic reflection cannot publish old error",async()=>{
  let controller;
  const error=new Proxy({code:"TRANSFER_OPERATION_FAILED"},{getOwnPropertyDescriptor(target,key){controller.cancel();return Reflect.getOwnPropertyDescriptor(target,key);}});
  controller=createTransferController({getContext:context,read:async()=>{throw error;}});
  assert.equal(await controller.inspect(REQUEST),false);
  assert.equal(controller.state.phase,"cancelled");
  assert.equal(controller.state.error,null);
});
