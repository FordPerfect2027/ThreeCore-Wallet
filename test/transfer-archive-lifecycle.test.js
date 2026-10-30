import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createTransferArchiveController } from "../src/transfer-archive-controller.js";
import { addTransferArchiveRecord } from "../src/transfer-archive.js";
import { prepareTransferArchive } from "../src/transfer-archive-file.js";
import { context, snapshot, fileFromText } from "./helpers/transfer-fixtures.js";

const archive = () => addTransferArchiveRecord(null,snapshot());
test("archive observer cancellation is bounded",()=>{
  let controller,calls=0;
  controller=createTransferArchiveController({getContext:context,onChange(){if(++calls<16)controller.cancel();}});
  controller.add(snapshot());
  assert.ok(calls<=2,`received ${calls} notifications`);
});
test("archive disposal closes observers before clearing data",()=>{
  let calls=0;
  const controller=createTransferArchiveController({getContext:context,onChange(){calls++;}});
  controller.add(snapshot());const before=calls;controller.dispose();
  assert.equal(calls,before);assert.equal(controller.state.phase,"disposed");assert.equal(controller.state.archive,null);
});
test("archive malformed asynchronous observer rejection is contained",()=>{
  const url=new URL("../src/transfer-archive-controller.js",import.meta.url).href;
  const fixtures=new URL("./helpers/transfer-fixtures.js",import.meta.url).href;
  const child=spawnSync(process.execPath,["--unhandled-rejections=strict","--input-type=module","-e",`
    import {createTransferArchiveController} from ${JSON.stringify(url)};
    import {context,snapshot} from ${JSON.stringify(fixtures)};
    const controller=createTransferArchiveController({getContext:context,onChange:()=>({async then(){throw Error('synthetic');}})});
    if(!controller.add(snapshot()))throw Error('add failed');
    setTimeout(()=>console.log('contained'),15);
  `],{timeout:10000,encoding:"utf8",windowsHide:true});
  assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),"contained");
});
for(const action of ["cancel","dispose"]){
  test(`archive ${action} during initial context prevents addition`,()=>{
    let controller;
    controller=createTransferArchiveController({getContext(){controller[action]();return context();}});
    assert.equal(controller.add(snapshot()),false);assert.equal(controller.state.archive,null);
  });
}
for(const method of ["add","reviewArchive"]){
  test(`archive cancellation during ${method} capture prevents publication`,()=>{
    let controller,once=false;
    controller=createTransferArchiveController({getContext:context});
    const input=new Proxy(method==="add"?snapshot():archive(),{getOwnPropertyDescriptor(target,key){
      if(!once){once=true;controller.cancel();}return Reflect.getOwnPropertyDescriptor(target,key);
    }});
    assert.equal(controller[method](input),false);
    assert.equal(controller.state.archive,null);assert.equal(controller.state.preview,null);assert.equal(controller.state.error,null);
  });
}
test("archive loading cancellation prevents file reads",async()=>{
  let controller,reads=0;
  const file=fileFromText((await prepareTransferArchive(archive())).text);
  const read=file.arrayBuffer;file.arrayBuffer=()=>{reads++;return read();};
  controller=createTransferArchiveController({getContext:context,onChange(state){if(state.phase==="loading")controller.cancel();}});
  assert.equal(await controller.stage(file),false);assert.equal(reads,0);
});
test("archive preparing cancellation prevents hashing",async()=>{
  let controller,digests=0;
  controller=createTransferArchiveController({getContext:context,subtle:{digest(){digests++;return Promise.resolve(new ArrayBuffer(32));}},
    onChange(state){if(state.phase==="preparing")controller.cancel();}});
  controller.add(snapshot());assert.equal(await controller.prepare(),null);assert.equal(digests,0);
});
test("archive apply cancellation does not publish a stale error",()=>{
  let controller,armed=false;
  controller=createTransferArchiveController({getContext(){if(armed){armed=false;controller.cancel();}return context();}});
  controller.reviewArchive(archive());const id=controller.state.preview.id;armed=true;
  assert.equal(controller.apply(id),false);assert.equal(controller.state.error,null);assert.equal(controller.state.archive,null);
});
for(const method of ["capture","select"]){
  test(`archive ${method} cancelled by its context callback returns no record`,()=>{
    let controller,armed=false;
    controller=createTransferArchiveController({getContext(){if(armed){armed=false;controller.cancel();}return context();}});
    controller.add(snapshot());armed=true;
    assert.equal(controller[method](0),null);assert.equal(controller.state.archive.records.length,1);
  });
}
test("archive an older apply preserves a newer review",()=>{
  let controller,armed=false;
  const next=addTransferArchiveRecord(null,snapshot({events:[]}));
  controller=createTransferArchiveController({getContext(){if(armed){armed=false;controller.reviewArchive(next);}return context();}});
  controller.reviewArchive(archive());const id=controller.state.preview.id;armed=true;
  assert.equal(controller.apply(id),false);assert.equal(controller.state.phase,"preview");
  assert.equal(controller.state.preview.archive.records[0].events.length,0);assert.equal(controller.state.error,null);
});
test("archive diagnostic accessor is never executed",()=>{
  let gets=0;
  const controller=createTransferArchiveController({getContext(){throw {get code(){gets++;return "TRANSFER_ARCHIVE_CONTEXT";}};}});
  assert.equal(controller.add(snapshot()),false);assert.equal(gets,0);assert.equal(controller.state.error,"TRANSFER_OPERATION_FAILED");
});
test("archive diagnostic reflection cancellation does not publish failure",()=>{
  let controller;
  const error=new Proxy({code:"TRANSFER_ARCHIVE_CONTEXT"},{getOwnPropertyDescriptor(target,key){controller.cancel();return Reflect.getOwnPropertyDescriptor(target,key);}});
  controller=createTransferArchiveController({getContext(){throw error;}});
  assert.equal(controller.add(snapshot()),false);assert.equal(controller.state.error,null);
});
test("archive cancelled preview notification returns false",async()=>{
  let controller;
  const file=fileFromText((await prepareTransferArchive(archive())).text);
  controller=createTransferArchiveController({getContext:context,onChange(state){if(state.phase==="preview")controller.cancel();}});
  assert.equal(await controller.stage(file),false);assert.equal(controller.state.preview,null);
});
