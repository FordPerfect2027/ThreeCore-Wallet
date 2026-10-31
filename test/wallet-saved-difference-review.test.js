import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {savedRehearsalGuideFixtures,gate} from './helpers/workspace-fixtures.js';
import {inspectWalletSavedTextDifferences,encodeWalletSavedTextDifferences,reviewWalletSavedTextDifferences,encodeWalletSavedTextDifferenceReview,walletSavedTextDifferenceReviewText,inspectWalletSavedText} from '../src/file-read-status.js';
const before=savedRehearsalGuideFixtures()[0].text,changed=JSON.parse(before);changed.policy.maxPerOperation='1';const expected=await inspectWalletSavedTextDifferences(before,JSON.stringify(changed)),text=encodeWalletSavedTextDifferences(expected);
test('a faithful saved difference passes even when the two originals have different JSON values',async()=>{
 const result=await reviewWalletSavedTextDifferences(expected,text);assert.equal(result.matchesRecomputation,true);assert.equal(result.expectedParsedJSONValuesMatch,false);assert.equal(result.beforeTextBindingMatches,true);assert.equal(result.afterTextBindingMatches,true);assert.equal(result.expectedDifferenceCount,1);assert.equal(result.reviewedDifferenceSha256,createHash('sha256').update(text).digest('hex'));assert.equal(result.authenticated,false);assert.match(walletSavedTextDifferenceReviewText(result),/元ファイル同士の値が同じという意味ではありません/);
 const saved=encodeWalletSavedTextDifferenceReview(result);assert.doesNotMatch(saved,/0x[0-9a-f]{40}/);assert.equal((await inspectWalletSavedText(saved)).validation,'declared-only');assert.throws(()=>encodeWalletSavedTextDifferenceReview(JSON.parse(saved)),{code:'FILE_DIFFERENCE_REVIEW_RESULT'});
});
test('changed locations, totals, bindings, scope and authority claims all fail independent review',async()=>{
 const mutations=[value=>{value.differences[0].path='/private-marker';},value=>{value.differences[0].kind='missing';},value=>{value.differenceCount=0;},value=>{value.parsedJSONValuesMatch=true;},value=>{value.before.textDigest='0'.repeat(64);},value=>{value.after.scope.rehearsalRejectedRecordReferences=99;},value=>{value.authenticated=true;},value=>{value.restorable=true;},value=>{value.valuesIncluded=true;},value=>{value.differencesTruncated=true;},value=>{delete value.arrayMatching;},value=>{value['private-marker']='private-value';}];
 for(const mutate of mutations){const value=JSON.parse(text);mutate(value);const result=await reviewWalletSavedTextDifferences(expected,JSON.stringify(value));assert.equal(result.matchesRecomputation,false);assert.doesNotMatch(encodeWalletSavedTextDifferenceReview(result)+walletSavedTextDifferenceReviewText(result),/private-marker|private-value|undefined/);}
 const wrong=JSON.parse(text);wrong.after.textDigest='0'.repeat(64);assert.equal((await reviewWalletSavedTextDifferences(expected,JSON.stringify(wrong))).afterTextBindingMatches,false);
});
test('review rejects uploaded authority, wrong schemas, duplicate keys and oversized input',async()=>{
 await assert.rejects(reviewWalletSavedTextDifferences(JSON.parse(text),text),{code:'FILE_DIFFERENCE_REVIEW_SOURCE'});
 await assert.rejects(reviewWalletSavedTextDifferences(expected,'{"schema":"unknown"}'),{code:'FILE_DIFFERENCE_REVIEW_SCHEMA'});
 await assert.rejects(reviewWalletSavedTextDifferences(expected,'{"schema":"a","schema":"b"}'),{code:'FILE_DIFFERENCE_REVIEW_JSON'});
 await assert.rejects(reviewWalletSavedTextDifferences(expected,' '.repeat(262145)),{code:'FILE_DIFFERENCE_REVIEW_JSON'});
 await assert.rejects(reviewWalletSavedTextDifferences(expected,text,{timeoutMs:0}),{code:'FILE_DIFFERENCE_REVIEW_OPTIONS'});
});
test('review cancellation and deadline discard an unfinished digest without accepting a claim',async()=>{
 const cancelled=new AbortController();cancelled.abort();await assert.rejects(reviewWalletSavedTextDifferences(expected,text,{signal:cancelled.signal}),{code:'FILE_CANCELLED'});
 const blocked=gate(),entered=gate(),active=new AbortController(),work=reviewWalletSavedTextDifferences(expected,text,{signal:active.signal,subtle:{digest(){entered.resolve();return blocked.promise;}}});await entered.promise;active.abort();await assert.rejects(work,{code:'CHECKSUM_CANCELLED'});blocked.resolve(new ArrayBuffer(32));
 const timed=gate();await assert.rejects(reviewWalletSavedTextDifferences(expected,text,{timeoutMs:20,subtle:{digest(){return timed.promise;}}}),{code:'CHECKSUM_TIMEOUT'});timed.resolve(new ArrayBuffer(32));
});
