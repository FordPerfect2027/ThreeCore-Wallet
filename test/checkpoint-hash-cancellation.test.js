import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createCheckpointController } from "../src/checkpoint-controller.js";
import { prepareCheckpointCollection } from "../src/checkpoint-transfer.js";
import { draft } from "./helpers/workspace-fixtures.js";
import { memoryStorage, preparedDraft, stored, TIME, id } from "./helpers/checkpoint-fixtures.js";
import { deferred, tick } from "./helpers/file-boundary-fixtures.js";

async function fixture() {
  const prepared=await preparedDraft(), saved=stored(1,prepared.text), storage=memoryStorage(saved);
  const collection=await prepareCheckpointCollection(saved), gate=deferred(), started=deferred();
  let blocked=false; const downloads=[], stages=[];
  const controller=createCheckpointController({storage,readDraft:draft,download:file=>downloads.push(file),onStage:value=>stages.push(value),now:()=>TIME,createId:()=>id(2),
    subtle:{digest(...args){if(!blocked)return webcrypto.subtle.digest(...args);started.resolve();return gate.promise;}}});
  await controller.refresh();controller.select(id(1));
  return {controller,storage,collection,gate,started,downloads,stages,block(){blocked=true;}};
}
for(const action of ["save","exportCollection","reviewImport","inspect","stage","exportFile"]){
  test(`checkpoint: disposal ends ${action} checksum wait`,async()=>{
    const f=await fixture();if(action==="stage")assert.equal(await f.controller.inspect(),true);f.block();let settled=false;
    const arg=action==="save"?"Synthetic checkpoint":action==="reviewImport"?f.collection.text:undefined;
    const pending=f.controller[action](arg).then(value=>{settled=true;return value;});
    try{await f.started.promise;f.controller.dispose();await tick();assert.equal(settled,true);assert.equal(await pending,false);assert.equal(f.downloads.length,0);assert.equal(f.stages.length,0);}
    finally{f.gate.resolve(new ArrayBuffer(32));await pending;f.controller.dispose();await tick();}
  });
}

test("cancelImport ends the checksum wait and releases the panel's busy state",async()=>{
  const f=await fixture();f.block();let settled=false;
  const pending=f.controller.reviewImport(f.collection.text).then(value=>{settled=true;return value;});
  try{await f.started.promise;f.controller.cancelImport();await tick();assert.equal(settled,true);assert.equal(await pending,false);assert.equal(f.controller.state().busy,false);assert.equal(f.controller.state().canImport,false);}
  finally{f.gate.resolve(new ArrayBuffer(32));await pending;f.controller.dispose();await tick();}
});

test("cancelled import apply invalidates cached metadata and cannot retire a newer refresh",async()=>{
  const prepared=await preparedDraft(), initial=stored(1,prepared.text), collection=await prepareCheckpointCollection(initial);
  const write=deferred(),read=deferred(),started=deferred();let reads=0,config;
  const storage={read:async()=>++reads===1?initial:read.promise,change:async(_revision,_operation,options)=>{config=options;started.resolve();return write.promise;},close(){}};
  const c=createCheckpointController({storage,readDraft:draft,download(){},onStage(){}});
  try{
    await c.refresh();assert.equal(await c.reviewImport(collection.text),true);
    const applying=c.applyImport(collection.text);await started.promise;c.cancelImport();
    assert.equal(config.signal.aborted,true);assert.equal(config.canCommit(),false);assert.equal(c.state().metadata,null);
    const refreshing=c.refresh();await tick();write.resolve(initial);assert.equal(await applying,false);
    assert.equal(c.state().activeAction,'refresh');assert.equal(c.state().busy,true);
    read.resolve(initial);assert.equal(await refreshing,true);assert.equal(c.state().metadata.count,1);assert.equal(c.state().lastAction,'refresh');
  }finally{write.resolve(initial);read.resolve(initial);c.dispose();await tick();}
});
