import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {webcrypto,createHash} from 'node:crypto';
import {savedObservationFixtures} from './helpers/saved-observation-fixtures.js';
import {inspectWalletSavedText,inspectWalletSavedTextBatch,inspectWalletSavedFileBatch,encodeWalletSavedTextBatch} from '../src/file-read-status.js';
const hash=text=>createHash('sha256').update(text).digest('hex'),fixtures=await savedObservationFixtures();
for(const name of ['period','library','report','history','set'])fixtures.push({name:name+'.json',text:readFileSync(new URL('../docs/evidence/2026-11-01-wallet-saved-batch/'+name+'-source.json',import.meta.url),'utf8')});
for(const fixture of fixtures)test('each captured original is raw-hashed once while retaining its full independent content check: '+fixture.name,async()=>{
 const expected=await inspectWalletSavedText(fixture.text),exact=Buffer.from(fixture.text);
 for(const mode of ['text','file']){let rawCalls=0,totalCalls=0;const subtle={digest(algorithm,value){totalCalls++;if(Buffer.from(value.buffer??value,value.byteOffset??0,value.byteLength).equals(exact))rawCalls++;return webcrypto.subtle.digest(algorithm,value);}};
  const result=mode==='text'?await inspectWalletSavedTextBatch([{name:fixture.name,text:fixture.text}],{subtle}):await inspectWalletSavedFileBatch([{name:fixture.name,byteLength:exact.length}],()=>fixture.text,{subtle});assert.equal(result.allOriginalsValidated,true);assert.deepEqual(result.files[0].inspection,expected);assert.equal(result.files[0].sha256,hash(fixture.text));assert.equal(rawCalls,1);assert(totalCalls>=2,'The internal payload checksum still runs');}
});
test('public options and extra arguments cannot inject a precomputed text digest',async()=>{
 const text=fixtures[0].text,fake='0'.repeat(64);let rawCalls=0;const subtle={digest(algorithm,value){if(Buffer.from(value).toString('utf8')===text)rawCalls++;return webcrypto.subtle.digest(algorithm,value);}};const actual=await inspectWalletSavedText(text,{subtle,knownTextDigest:fake,textDigest:fake},fake);assert.equal(actual.textDigest,hash(text));assert.equal(rawCalls,1);
});
test('reuse is bound to captured text and does not trust progress callback mutations or a prior checksum mismatch',async()=>{
 const text=fixtures[0].text,input=[{name:'original.json',text}],result=await inspectWalletSavedTextBatch(input,{onProgress(){input[0].text='{}';}});assert.equal(result.files[0].inspection.textDigest,hash(text));assert.equal(result.allOriginalsValidated,true);
 let calls=0;const mismatch=await inspectWalletSavedTextBatch([{name:'original.json',text}],{manifestText:'0'.repeat(64)+'  original.json\n',subtle:{digest(...args){calls++;return webcrypto.subtle.digest(...args);}}});assert.equal(mismatch.files[0].status,'checksum-mismatch');assert.equal(mismatch.files[0].inspection,null);assert.equal(calls,2,'Only reference and raw-source hashes are needed before refusing a mismatch');
});
test('raw-hash reuse cannot bypass an altered internal checksum',async()=>{
 for(const fixture of fixtures){const raw=JSON.parse(fixture.text);raw.digest='0'.repeat(64);const result=await inspectWalletSavedTextBatch([{name:fixture.name,text:JSON.stringify(raw)}]);assert.equal(result.files[0].status,'invalid');assert.equal(result.files[0].inspection,null);assert.equal(result.allOriginalsValidated,false);assert(!encodeWalletSavedTextBatch(result).includes('validated-original'));}
});
