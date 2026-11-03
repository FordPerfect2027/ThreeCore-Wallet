import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKPOINT_SCHEMA, validateCheckpointDocument, mutateCheckpoints, emptyCheckpointDocument } from '../src/checkpoint-model.js';
import { reviewCheckpointImport } from '../src/checkpoint-transfer.js';
import { stored, id, TIME, LATER, saveOperation } from './helpers/checkpoint-fixtures.js';

function noGet(value) {return new Proxy(value,{get(){assert.fail('external property get was executed');}});}
for(const part of ['document','entry','array']) test(`checkpoint ${part} is consumed only from captured own data`,()=>{
  let input=stored();
  if(part==='document')input=noGet(input);
  else if(part==='entry')input.entries[0]=noGet(input.entries[0]);
  else input.entries=noGet(input.entries);
  assert.deepEqual(validateCheckpointDocument(input),stored());
});
test('checkpoint revision cannot change between validation and returned metadata',()=>{
  const input=stored();let reads=0;
  const proxy=new Proxy(input,{get(target,key){if(key==='revision')return ++reads>2?99:1;return Reflect.get(target,key);}});
  assert.equal(validateCheckpointDocument(proxy).revision,1);assert.equal(reads,0);
});
test('checkpoint array length cannot hide existing entries',()=>{
  const input=stored();input.entries=new Proxy(input.entries,{get(target,key){return key==='length'?0:Reflect.get(target,key);}});
  assert.equal(validateCheckpointDocument(input).entries.length,1);
});
for(const reflection of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor']) test(`checkpoint ${reflection} failures have a bounded diagnostic`,()=>{
  const proxy=new Proxy(stored(),{[reflection](){throw Error('synthetic implementation details');}});
  assert.throws(()=>validateCheckpointDocument(proxy),{code:'CHECKPOINT_SHAPE'});
});
for(const field of ['archived','fileText']) test(`checkpoint stored ${field} cannot be replaced after validation`,()=>{
  const input=stored();let reads=0;
  input.entries[0]=new Proxy(input.entries[0],{get(target,key){if(key===field&&++reads>1)return field==='archived'?'invalid':null;return Reflect.get(target,key);}});
  const output=validateCheckpointDocument(input);assert.equal(output.entries[0][field],stored().entries[0][field]);assert.equal(reads,0);
});
for(const kind of ['save','rename','archive','unarchive','purge','import']) test(`checkpoint ${kind} operation uses its captured data`,()=>{
  let input=stored(2),operation;
  if(kind==='save')operation=saveOperation(3);
  else if(kind==='import')operation={kind,entries:stored(3).entries};
  else if(kind==='purge'){input.entries[0].archived=true;operation={kind,id:id(1),confirmed:true};}
  else operation={kind,id:id(1),time:LATER,...(kind==='rename'?{label:'renamed'}:{})};
  const expected=mutateCheckpoints(input,2,operation);
  assert.deepEqual(mutateCheckpoints(input,2,noGet(operation)),expected);
});
test('checkpoint operation kind is captured once',()=>{
  let reads=0;
  const proxy=new Proxy(saveOperation(1),{getOwnPropertyDescriptor(target,key){if(key==='kind')reads++;return Reflect.getOwnPropertyDescriptor(target,key);}});
  mutateCheckpoints(emptyCheckpointDocument(),0,proxy);assert.equal(reads,1);
});
test('checkpoint operation reflection cannot leak an adapter exception',()=>{
  const proxy=new Proxy(saveOperation(1),{getOwnPropertyDescriptor(){throw Error('synthetic detail');}});
  assert.throws(()=>mutateCheckpoints(emptyCheckpointDocument(),0,proxy),{code:'CHECKPOINT_OPERATION'});
});
test('checkpoint import summary does not call an incoming array filter',()=>{
  const incoming=new Proxy(stored(2).entries,{get(target,key){if(key==='filter')assert.fail('external filter');return Reflect.get(target,key);}});
  const review=reviewCheckpointImport(stored(),incoming);
  assert.deepEqual(review.skipped,[id(1)]);assert.equal(review.added[0].id,id(2));
});
test('checkpoint import summary cannot use different row values from the proposed import',()=>{
  const incoming=stored().entries;let reads=0;
  incoming[0]=new Proxy(incoming[0],{get(target,key){if(key==='id'){reads++;return id(2);}return Reflect.get(target,key);}});
  const review=reviewCheckpointImport(stored(),incoming);
  assert.deepEqual(review.skipped,[id(1)]);assert.equal(review.added.length,0);assert.equal(reads,0);
});
test('checkpoint unsupported operation still cannot remove data',()=>{
  const before=stored();assert.throws(()=>mutateCheckpoints(before,1,{kind:'erase',id:id(1),time:TIME}),{code:'CHECKPOINT_OPERATION'});
  assert.equal(before.entries.length,1);
});
