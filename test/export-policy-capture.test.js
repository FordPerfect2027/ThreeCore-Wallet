import test from 'node:test';
import assert from 'node:assert/strict';
import { ExportSecurityError, exportErrorCode, consumeExportCallback } from '../src/export-policy.js';

test('export error code accessors are not executed',()=>{
  let reads=0;const error=new ExportSecurityError('EXPORT_BUSY');
  Object.defineProperty(error,'code',{get(){reads++;return 'EXPORT_BUSY';}});
  assert.equal(exportErrorCode(error),'EXPORT_FAILED');assert.equal(reads,0);
});
test('export code cannot change between allowlist check and returned text',()=>{
  let reads=0;const error=new Proxy(new ExportSecurityError('EXPORT_BUSY'),{
    get(target,key){if(key==='code')return ++reads===1?'EXPORT_BUSY':'SYNTHETIC_UNLISTED_DETAIL';return Reflect.get(target,key);}
  });
  assert.equal(exportErrorCode(error),'EXPORT_BUSY');assert.equal(reads,0);
});
test('export errors require their own data code',()=>{
  assert.equal(exportErrorCode(Object.create(new ExportSecurityError('EXPORT_BUSY'))),'EXPORT_FAILED');
});
test('export diagnostic reflection failure becomes the fixed fallback',()=>{
  const error=new Proxy(new ExportSecurityError('EXPORT_BUSY'),{getOwnPropertyDescriptor(){throw Error('synthetic reflection');}});
  assert.equal(exportErrorCode(error),'EXPORT_FAILED');
});
test('export observer consumes an async then method rejection',async()=>{
  let called=0;
  consumeExportCallback(()=>({async then(){called++;throw Error('synthetic async method failure');}}));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(called,1);
});
test('export observer consumes a native rejection returned separately by then',async()=>{
  let called=0;
  consumeExportCallback(()=>({then(resolve){called++;resolve();return Promise.reject(Error('synthetic returned failure'));}}));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(called,1);
});
test('export observer does not recursively invoke a non-native returned thenable',async()=>{
  let nested=0;
  consumeExportCallback(()=>({then(resolve){resolve();return {then(){nested++;}};}}));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(nested,0);
});
test('export ordinary own diagnostics and native rejected callbacks remain contained',async()=>{
  assert.equal(exportErrorCode(new ExportSecurityError('EXPORT_SIZE')),'EXPORT_SIZE');
  consumeExportCallback(()=>Promise.reject(Error('synthetic failure')));
  await new Promise(resolve=>setImmediate(resolve));
});
