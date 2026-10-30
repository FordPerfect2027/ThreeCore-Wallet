import test from 'node:test';
import assert from 'node:assert/strict';
const base=new URL('../',import.meta.url);
const {createRehearsalSaveCheckpoint,createRehearsalSession}=await import(new URL('src/operation-rehearsal-session.js',base));
const {rehearsalExampleV2}=await import(new URL('src/operation-rehearsal-examples.js',base));
function document(agent){const session=createRehearsalSession(agent);session.workspace.reset(rehearsalExampleV2(agent));const data=session.snapshot();session.dispose();return data;}
const old=document('EMA'),newer=document('CAWELON'),original=document('DAT');
for(const action of ['clear','replace','invalid-replacement'])for(const broken of [false,true])test('save checkpoint cannot outlive '+action+(broken?' when old capture also fails':''),()=>{
 const checkpoint=createRehearsalSaveCheckpoint();checkpoint.record(original,'file');let once=false;
 const incoming=new Proxy(old,{ownKeys(target){
  if(!once){once=true;if(action==='clear')checkpoint.clear();else if(action==='replace')checkpoint.record(newer,'file');else assert.throws(()=>checkpoint.record({},'file'));}
  if(broken)throw Error('private discarded capture');return Reflect.ownKeys(target);
 }});
 assert.doesNotThrow(()=>checkpoint.record(incoming,'download'));assert.equal(once,true);
 if(action==='clear'){assert.equal(checkpoint.inspect(old).state,'unrecorded');assert.equal(checkpoint.inspect(old).source,null);}
 else {const current=checkpoint.inspect(action==='replace'?newer:original);assert.equal(current.state,'matched');assert.equal(current.source,'file');assert.equal(checkpoint.inspect(old).state,'changed');}
});
test('ordinary checkpoint replacement still records the offered content and source',()=>{
 const checkpoint=createRehearsalSaveCheckpoint();checkpoint.record(original,'download');checkpoint.record(newer,'file');
 assert.equal(checkpoint.inspect(newer).state,'matched');assert.equal(checkpoint.inspect(newer).source,'file');assert.equal(checkpoint.inspect(original).state,'changed');
});
