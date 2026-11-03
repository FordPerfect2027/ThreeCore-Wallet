import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {savedWorkspaceGuideFixtures,savedRehearsalGuideFixtures} from './helpers/workspace-fixtures.js';
import {rehearsalExample} from '../src/operation-rehearsal-examples.js';
import {encodeRehearsal} from '../src/operation-rehearsal.js';
import {compareBoundedSavedJSONTexts} from '../src/operation-rehearsal-report-review.js';
import {inspectWalletSavedTextDifferences,encodeWalletSavedTextDifferences,walletSavedTextDifferencesText,inspectWalletSavedText,walletSavedInspectionErrorText} from '../src/file-read-status.js';
const fixtures=await savedWorkspaceGuideFixtures(),setup=fixtures[3].text,hash=text=>createHash('sha256').update(text).digest('hex');

test('all supported plain source families distinguish formatting from JSON-value changes',async()=>{
 for(const fixture of [...fixtures.slice(1),...savedRehearsalGuideFixtures()]){
  const parsed=JSON.parse(fixture.text),formatted=JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()));
  const result=await inspectWalletSavedTextDifferences(fixture.text,formatted);
  assert.equal(result.parsedJSONValuesMatch,true,fixture.name);assert.equal(result.sourceTextMatches,false);assert.equal(result.differenceCount,0);
  assert.equal(result.before.textDigest,hash(fixture.text));assert.equal(result.after.textDigest,hash(formatted));assert.equal(result.authenticated,false);assert.equal(result.restorable,false);
 }
});
test('same-count settings changes expose only field locations and exact source bindings',async()=>{
 const changed=JSON.parse(setup);changed.entries[0].account='0x'+'a'.repeat(40);const text=JSON.stringify(changed),result=await inspectWalletSavedTextDifferences(setup,text,{expectedBeforeSha256:hash(setup),expectedAfterSha256:hash(text)});
 assert.deepEqual(result.differences,[{path:'/entries/0/account',kind:'value'}]);assert.equal(result.parsedJSONValuesMatch,false);assert.equal(result.before.scope.configurationReferences,result.after.scope.configurationReferences);
 const saved=encodeWalletSavedTextDifferences(result);assert.doesNotMatch(saved,/0x[a-f0-9]{40}/);assert.match(walletSavedTextDifferencesText(result),/\/entries\/0\/account/);assert(Object.isFrozen(result.differences[0]));
 assert.throws(()=>encodeWalletSavedTextDifferences(JSON.parse(saved)),{code:'FILE_DIFFERENCE_RESULT'});
 const guide=await inspectWalletSavedText(saved);assert.equal(guide.validation,'declared-only');assert.equal(guide.target,null);
 await assert.rejects(inspectWalletSavedTextDifferences(setup,text,{expectedAfterSha256:hash(setup)}),{code:'FILE_DIFFERENCE_SOURCE_CHANGED'});
});
test('rehearsal event differences count all changed positions but list at most 40',async()=>{
 const example=rehearsalExample('DAT','deposit'),base={...example,events:Array.from({length:45},(_,i)=>({...example.events[0],id:'deposit-'+i,amount:'1'}))},changed={...base,events:base.events.map(event=>({...event,amount:'2'}))};
 const result=await inspectWalletSavedTextDifferences(encodeRehearsal(base),encodeRehearsal(changed));assert.equal(result.differenceCount,45);assert.equal(result.listedDifferences,40);assert.equal(result.differencesTruncated,true);assert.equal(result.differences[39].path,'/events/39/amount');assert.match(walletSavedTextDifferencesText(result),/すべての相違箇所を表示した結果ではありません/);
 const shorter={...base,events:base.events.slice(0,3)},length=await inspectWalletSavedTextDifferences(encodeRehearsal(base),encodeRehearsal(shorter));assert.deepEqual(length.differences,[{path:'/events',kind:'array-length'}]);assert.equal(length.arrayMatching,'position');
});
test('sources must validate independently, use the same format and fit the bounded comparison',async()=>{
 await assert.rejects(inspectWalletSavedTextDifferences(setup,fixtures[1].text),{code:'FILE_DIFFERENCE_FORMAT'});
 await assert.rejects(inspectWalletSavedTextDifferences(fixtures[0].text,fixtures[0].text),{code:'FILE_DIFFERENCE_SOURCES_REQUIRED'});
 await assert.rejects(inspectWalletSavedTextDifferences('{"schema":"threecore.saved-file-differences.v1"}',setup),{code:'FILE_DIFFERENCE_SOURCES_REQUIRED'});
 await assert.rejects(inspectWalletSavedTextDifferences(setup,' '.repeat(2097153)),{code:'FILE_DIFFERENCE_SIZE'});
 const extra=JSON.parse(setup);extra.privateMarker='not allowed';await assert.rejects(inspectWalletSavedTextDifferences(setup,JSON.stringify(extra)));
 await assert.rejects(inspectWalletSavedTextDifferences(setup,setup,{expectedBeforeSha256:'invalid'}),{code:'FILE_DIFFERENCE_OPTIONS'});
});
test('cancellation and a stalled hash deadline return without publishing a result',async()=>{
 const controller=new AbortController();controller.abort();await assert.rejects(inspectWalletSavedTextDifferences(setup,setup,{signal:controller.signal}),{code:'FILE_CANCELLED'});
 let entered;const active=new Promise(resolve=>entered=resolve),pending=new AbortController(),subtle={digest(){entered();return new Promise(()=>{});}},work=inspectWalletSavedTextDifferences(setup,setup,{signal:pending.signal,subtle});await active;pending.abort();await assert.rejects(work,{code:'FILE_CANCELLED'});
 await assert.rejects(inspectWalletSavedTextDifferences(setup,setup,{timeoutMs:20,subtle}),{code:'FILE_DIFFERENCE_TIMEOUT'});
});
test('difference helper escapes pointers, preserves type changes and bounds input before traversal',()=>{
 const result=compareBoundedSavedJSONTexts('{"a/b":{"~key":1},"gone":true}','{"a/b":{"~key":null},"new":false}');assert.deepEqual(result.differences,[{path:'/a~1b/~0key',kind:'type'},{path:'/gone',kind:'missing'},{path:'/new',kind:'unexpected'}]);
 assert.throws(()=>compareBoundedSavedJSONTexts('{"a":1,"a":2}','{}'));assert.throws(()=>compareBoundedSavedJSONTexts('['.repeat(34)+'0'+']'.repeat(34),'[]'));
 let gets=0;walletSavedInspectionErrorText(Object.defineProperty({},'code',{get(){gets++;throw Error('private');}}));assert.equal(gets,0);
});
