import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointController } from "../src/checkpoint-controller.js";
import { emptyCheckpointDocument } from "../src/checkpoint-model.js";
import { draft } from "./helpers/workspace-fixtures.js";
import { memoryStorage, preparedDraft, stored, TIME, id } from "./helpers/checkpoint-fixtures.js";

function create(options={}) {
  return createCheckpointController({storage:memoryStorage(),readDraft:draft,onStage(){},download(){},now:()=>TIME,createId:()=>id(2),...options});
}
test("checkpoint: disposal during document capture cannot retain late metadata",async()=>{
  let c,once=false;
  const value=new Proxy(emptyCheckpointDocument(),{getOwnPropertyDescriptor(target,key){if(!once){once=true;c.dispose();}return Reflect.getOwnPropertyDescriptor(target,key);}});
  c=create({storage:{read:async()=>value,change(){throw Error('unexpected write');},close(){}}});
  assert.equal(await c.refresh(),false);assert.equal(c.state().disposed,true);assert.equal(c.state().metadata,null);
});
test("checkpoint: diagnostic getters are not executed or exposed",async()=>{
  let reads=0;
  const error=Object.defineProperty({},'code',{get(){reads++;return 'SYNTHETIC_ADAPTER_DETAIL';}});
  const c=create({storage:{read:async()=>{throw error;},change(){},close(){}}});
  try{assert.equal(await c.refresh(),false);assert.equal(reads,0);assert.equal(c.state().errorCode,'CHECKPOINT_ACTION');}finally{c.dispose();}
});
test("checkpoint: diagnostic capture cannot revive disposed status",async()=>{
  let c;
  const error=new Proxy({code:'CHECKPOINT_STALE'},{getOwnPropertyDescriptor(target,key){c.dispose();return Reflect.getOwnPropertyDescriptor(target,key);},get(target,key){if(key==='code')c.dispose();return Reflect.get(target,key);}});
  c=create({storage:{read:async()=>{throw error;},change(){},close(){}}});
  assert.equal(await c.refresh(),false);assert.equal(c.state().phase,'disposed');assert.equal(c.state().errorCode,null);
});
test("checkpoint: terminal observer disposal revokes successful refresh",async()=>{
  let c;
  c=create({onChange:state=>{if(state.phase==='ready'&&!state.busy)c.dispose();}});
  assert.equal(await c.refresh(),false);assert.equal(c.state().disposed,true);
});
test("checkpoint: notification callbacks cannot recurse indefinitely",async()=>{
  let c,calls=0;
  c=create({onChange:state=>{if(state.phase==='ready'&&!state.busy&&++calls<20)c.select(null);}});
  try{await c.refresh();assert.ok(calls<=2,`received ${calls} nested callbacks`);}finally{c.dispose();}
});
test("checkpoint: ID callback disposal prevents the later clock callback",async()=>{
  let c,timeCalls=0;
  c=create({createId(){c.dispose();return id(2);},now(){timeCalls++;return TIME;}});
  await c.refresh();assert.equal(await c.save('synthetic'),false);assert.equal(timeCalls,0);
});
test("checkpoint: metadata clock disposal prevents a storage call",async()=>{
  const storage=memoryStorage(stored(1,(await preparedDraft()).text));let c;
  c=create({storage,now(){c.dispose();return TIME;}});await c.refresh();c.select(id(1));
  assert.equal(await c.rename('renamed'),false);assert.equal(storage.calls.includes('rename'),false);
});

test("checkpoint: post-save draft callback cannot change disposed state",async()=>{
  const storage=memoryStorage();let c,committed=false;
  storage.onAfterChange(()=>{committed=true;});
  c=create({storage,readDraft(){
    if(committed){c.dispose();return draft({block:'43'});}
    return draft();
  }});
  await c.refresh();assert.equal(await c.save('synthetic'),false);
  assert.equal(c.state().phase,'disposed');assert.equal(c.state().currentDraftChanged,false);
});
