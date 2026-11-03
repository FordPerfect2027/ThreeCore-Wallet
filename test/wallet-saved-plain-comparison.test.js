import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {savedWorkspaceGuideFixtures,savedRehearsalGuideFixtures} from './helpers/workspace-fixtures.js';
import {inspectWalletSavedText,compareWalletSavedInspections,compareWalletSavedTextInspections,walletSavedComparisonText,reviewWalletSavedComparison,walletSavedComparisonReviewText} from '../src/file-read-status.js';
const workspace=await savedWorkspaceGuideFixtures(),fixtures=[...workspace.slice(1),...savedRehearsalGuideFixtures()],hash=value=>createHash('sha256').update(value).digest('hex');
for(const fixture of fixtures)test('exact selected text is comparable without an original-checksum claim: '+fixture.name,async()=>{
 const before=await inspectWalletSavedText(fixture.text),same=compareWalletSavedTextInspections(before,await inspectWalletSavedText(fixture.text));assert.equal(same.schema,'threecore.saved-file-comparison.v2');assert.equal(same.kind,'unverified');assert.equal(same.sameOriginal,null);assert.equal(same.sameText,null);assert.deepEqual(same.sourceTextComparison,{basis:'sha256-utf8',beforeSha256:hash(fixture.text),afterSha256:hash(fixture.text),sameText:true});assert.equal(same.authenticated,false);assert.equal(same.authorizesExecution,false);assert.match(walletSavedComparisonText(same),/SHA-256が一致/);
 const formatted=JSON.stringify(JSON.parse(fixture.text))+'\n',different=compareWalletSavedTextInspections(before,await inspectWalletSavedText(formatted));assert.equal(different.sourceTextComparison.sameText,false);assert.match(walletSavedComparisonText(different),/空白や書式だけ/);assert.equal(different.sameOriginal,null);assert.doesNotMatch(walletSavedComparisonText(different),/0x[0-9a-f]{40}/);
 const legacy=compareWalletSavedInspections(before,before);assert.equal(legacy.schema,'threecore.saved-file-comparison.v1');assert.equal(Object.hasOwn(legacy,'sourceTextComparison'),false);
 const oldReview=await reviewWalletSavedComparison(before,before,JSON.stringify(legacy));assert.equal(oldReview.matchesRecomputation,true);assert.equal(oldReview.schema,'threecore.saved-file-comparison-review.v1');
});
test('new saved comparison review independently binds both source texts and rejects modified conclusions',async()=>{
 const before=await inspectWalletSavedText(fixtures[0].text),after=await inspectWalletSavedText(fixtures[0].text),comparison=compareWalletSavedTextInspections(before,after),review=await reviewWalletSavedComparison(before,after,JSON.stringify(comparison));
 assert.equal(review.matchesRecomputation,true);assert.equal(review.schema,'threecore.saved-file-comparison-review.v2');assert.equal(review.originalPairValidated,false);assert.equal(review.beforeBindingMatches,null);assert.equal(review.beforeTextBindingMatches,true);assert.equal(review.afterTextBindingMatches,true);assert.equal(review.expectedSourceTextMatches,true);assert.match(walletSavedComparisonReviewText(review),/出所の認証ではありません/);
 const altered=structuredClone(comparison);altered.sourceTextComparison.sameText=false;const rejected=await reviewWalletSavedComparison(before,after,JSON.stringify(altered));assert.equal(rejected.matchesRecomputation,false);assert(rejected.differences.includes('sourceTextComparison'));assert.doesNotMatch(walletSavedComparisonReviewText(rejected),/undefined/);
 const changedBinding=structuredClone(comparison);changedBinding.after.textDigest='0'.repeat(64);assert.equal((await reviewWalletSavedComparison(before,after,JSON.stringify(changedBinding))).afterTextBindingMatches,false);
});
test('changed public settings with unchanged row counts still produce an exact-text difference',async()=>{
 const original=workspace[3].text,changed=JSON.parse(original);changed.entries[0].account='0x'+'a'.repeat(40);
 const result=compareWalletSavedTextInspections(await inspectWalletSavedText(original),await inspectWalletSavedText(JSON.stringify(changed)));assert.equal(result.before.scope.configurationReferences,result.after.scope.configurationReferences);assert.equal(result.sourceTextComparison.sameText,false);assert.equal(result.sameOriginal,null);
});
test('checksummed pairs retain their old receipt and auxiliary or forged captures gain no text verification',async()=>{
 const original=await inspectWalletSavedText(workspace[0].text),plain=await inspectWalletSavedText(fixtures[0].text),auxiliary=await inspectWalletSavedText('{"schema":"threecore.saved-file-comparison.v2"}');
 assert.deepEqual(compareWalletSavedTextInspections(original,original),compareWalletSavedInspections(original,original));assert.equal(compareWalletSavedTextInspections(original,plain).sourceTextComparison.sameText,false);
 assert.equal(compareWalletSavedTextInspections(plain,auxiliary).schema,'threecore.saved-file-comparison.v1');assert.equal(compareWalletSavedTextInspections(plain,auxiliary).sameText,null);
 assert.throws(()=>compareWalletSavedTextInspections(plain,JSON.parse(JSON.stringify(plain))),{code:'FILE_INSPECTION_COMPARISON'});
 await assert.rejects(reviewWalletSavedComparison(plain,auxiliary,JSON.stringify({...compareWalletSavedInspections(plain,auxiliary),schema:'threecore.saved-file-comparison.v2'})),{code:'FILE_COMPARISON_REVIEW_SCHEMA'});
});
