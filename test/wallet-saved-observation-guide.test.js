import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {savedObservationFixtures} from './helpers/saved-observation-fixtures.js';
import {inspectWalletSavedText,walletSavedInspectionText,compareWalletSavedInspections,walletSavedComparisonText,inspectWalletSavedTextBatch,encodeWalletSavedTextBatchCsv,prepareWalletSavedBundle,reviewWalletSavedBundle,reviewWalletSavedComparison,walletSavedFileTargetCode,walletSavedFileTargetMessage,WALLET_SAVED_OBSERVATION_SCOPE_FIELDS} from '../src/file-read-status.js';
import {decodeTransferArchiveFile,TRANSFER_ARCHIVE_FILE_LIMIT} from '../src/transfer-archive-file.js';
import {encodeTransferFile} from '../src/transfer-file.js';import {snapshot,event} from './helpers/transfer-fixtures.js';import {prepareReconciliationFile} from '../src/reconciliation-file.js';import {emptyReconciliationWorkspace} from '../src/reconciliation-model.js';
const fixtures=await savedObservationFixtures(),hash=text=>createHash('sha256').update(text).digest('hex');
for(const fixture of fixtures){
 test('saved observation guide validates and summarizes '+fixture.name,async()=>{
  const result=await inspectWalletSavedText(fixture.text),raw=JSON.parse(fixture.text);assert.equal(result.schema,'threecore.saved-file-inspection.v2');assert.equal(result.target,fixture.target);assert.equal(result.validation,'validated-original');assert.equal(result.checksumVerified,true);assert.equal(result.sourceDigest,raw.digest);assert.equal(result.textDigest,hash(fixture.text));assert.equal(result.scope.draftReferences,null);assert.equal(result.liveChainRechecked,false);assert.equal(result.authorizesExecution,false);assert.equal(result.authenticated,false);assert.equal(result.restorable,false);assert(Object.isFrozen(result.scope));
  for(const field of WALLET_SAVED_OBSERVATION_SCOPE_FIELDS.slice(0,6))assert.equal(result.scope[field],fixture.counts[field]??null);for(const field of WALLET_SAVED_OBSERVATION_SCOPE_FIELDS.slice(6))assert.equal(Object.hasOwn(result.scope,field),false);
  const display=walletSavedInspectionText(result);assert(!display.includes('null件'));assert(!display.includes('undefined'));assert(!display.includes('0x111111'));assert(!JSON.stringify(result).includes('1234567890123456789'));assert(walletSavedFileTargetMessage(walletSavedFileTargetCode(raw.schema,'period')));
 });
 test('saved observation guide refuses checksum and shape substitution '+fixture.name,async()=>{
  const raw=JSON.parse(fixture.text);raw.digest='0'.repeat(64);await assert.rejects(inspectWalletSavedText(JSON.stringify(raw)));const extra=JSON.parse(fixture.text);extra.authorizesExecution=true;await assert.rejects(inspectWalletSavedText(JSON.stringify(extra)));const missing=JSON.parse(fixture.text);delete missing.algorithm;await assert.rejects(inspectWalletSavedText(JSON.stringify(missing)));const abort=new AbortController();abort.abort();await assert.rejects(inspectWalletSavedText(fixture.text,{signal:abort.signal}),{code:'FILE_CANCELLED'});
 });
 test('saved observation original comparison and bundle preserve exact bytes '+fixture.name,async()=>{
  const compact=JSON.stringify(JSON.parse(fixture.text)),before=await inspectWalletSavedText(fixture.text),after=await inspectWalletSavedText(compact),comparison=compareWalletSavedInspections(before,after);assert.equal(comparison.kind,'format-only');assert.equal(comparison.sameOriginal,true);assert.equal(comparison.scopeChanges.length,0);assert(!walletSavedComparisonText(comparison).includes('undefined'));
  const receipt=await reviewWalletSavedComparison(before,after,JSON.stringify(comparison));assert.equal(receipt.matchesRecomputation,true);const prepared=await prepareWalletSavedBundle(fixture.text,compact),review=await reviewWalletSavedBundle(prepared.text);assert.equal(review.comparisonMatchesRecomputation,true);assert.equal(review.comparison.kind,'format-only');
 });
}
test('new original scopes keep absent values null and CSV blank while exports retain observed counts',async()=>{
 const batch=await inspectWalletSavedTextBatch(fixtures.map(({name,text})=>({name,text})));assert.equal(batch.allOriginalsValidated,true);assert.equal(batch.summary.validatedOriginals,7);const csv=encodeWalletSavedTextBatchCsv(batch);for(const field of WALLET_SAVED_OBSERVATION_SCOPE_FIELDS.slice(0,6))assert(csv.includes('"'+field+'"'));assert(!csv.includes('"configurationReferences"'));assert(!csv.includes('"null"'));assert(!csv.includes('"undefined"'));
 const targets=batch.files.find(row=>row.name==='allowance-targets.json').inspection;assert.equal(targets.scope.identityObservationReferences,null);assert.equal(targets.scope.allowanceObservationReferences,null);
});
test('new inspection receipt is a declaration, not reusable original evidence',async()=>{
 const inspection=await inspectWalletSavedText(fixtures[0].text),aux=await inspectWalletSavedText(JSON.stringify(inspection));assert.equal(aux.validation,'declared-only');assert.equal(aux.checksumVerified,false);assert.equal(aux.originalEvidenceValidated,false);
});
test('archive text decoder is bounded and performs no file reads',async()=>{
 let coerces=0;await assert.rejects(decodeTransferArchiveFile({toString(){coerces++;return fixtures[1].text;}}),{code:'TRANSFER_ARCHIVE_FILE_SIZE'});for(const text of ['', ' '.repeat(TRANSFER_ARCHIVE_FILE_LIMIT+1),'あ'.repeat(TRANSFER_ARCHIVE_FILE_LIMIT/3+1)])await assert.rejects(decodeTransferArchiveFile(text),{code:'TRANSFER_ARCHIVE_FILE_SIZE'});assert.equal(coerces,0);assert.equal((await decodeTransferArchiveFile(fixtures[1].text)).archive.records.length,1);
});
test('changed historical values with unchanged counts remain content changes, not matching observations',async()=>{
 const before=await inspectWalletSavedText(fixtures[0].text),changed=await inspectWalletSavedText(await encodeTransferFile(snapshot({events:[event({amountBaseUnits:'999'})]}))),comparison=compareWalletSavedInspections(before,changed);assert.equal(comparison.kind,'changed-original');assert.equal(comparison.unchangedScopeWithChangedOriginal,true);assert.equal(comparison.authenticated,false);assert.equal(comparison.authorizesExecution,false);
 const empty=await inspectWalletSavedText(await encodeTransferFile(snapshot({events:[]}))),different=compareWalletSavedInspections(before,empty);assert.deepEqual(different.scopeChanges,[{field:'eventReferences',before:1,after:0,difference:-1}]);assert.match(walletSavedComparisonText(different),/履歴イベントの参照: 1 → 0/);
});
test('an empty reconciliation source reports zero present references without inventing period progress',async()=>{
 const result=await inspectWalletSavedText((await prepareReconciliationFile(emptyReconciliationWorkspace())).text);assert.equal(result.scope.archiveReferences,0);assert.equal(result.scope.identityObservationReferences,0);assert.equal(result.scope.eventReferences,0);assert.equal(result.scope.draftReferences,null);assert.deepEqual(result.scope.agents,[]);
});
test('new guides cannot retain a result after cancellation while their checksum is waiting',async()=>{
 for(const fixture of fixtures){const abort=new AbortController();let entered,release;const gate=new Promise(r=>{entered=r;}),subtle={digest(...args){entered();return new Promise(resolve=>{release=()=>resolve(crypto.subtle.digest(...args));});}},pending=inspectWalletSavedText(fixture.text,{signal:abort.signal,subtle});await gate;abort.abort();await assert.rejects(pending);release();}
});
