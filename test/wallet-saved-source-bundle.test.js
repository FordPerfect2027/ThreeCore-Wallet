import test from 'node:test';import assert from 'node:assert/strict';import {savedWorkspaceGuideFixtures,savedRehearsalGuideFixtures} from './helpers/workspace-fixtures.js';
import {prepareWalletSavedBundle,prepareWalletSavedSourceBundle,reviewWalletSavedBundle,walletSavedBundleSourceFile,walletSavedBundleReviewText,inspectWalletSavedText,compareWalletSavedInspections} from '../src/file-read-status.js';
const fixtures=await savedWorkspaceGuideFixtures(),plain=[...fixtures.slice(1),...savedRehearsalGuideFixtures()];
test('all eight plain source families round-trip exact bytes with explicit non-checksummed scope',async()=>{
 for(const fixture of plain){const after=JSON.stringify(JSON.parse(fixture.text),null,2)+'\r\n',prepared=await prepareWalletSavedSourceBundle(fixture.text,after),review=await reviewWalletSavedBundle(prepared.text);assert.equal(JSON.parse(prepared.text).schema,'threecore.saved-file-comparison-bundle.v2');assert.equal(review.sourceFilesAvailable,true,fixture.name);assert.equal(review.originalsAvailable,false);assert.equal(review.originalsValidated,false);assert.equal(review.comparisonVersionMatches,true);assert.equal(review.comparison.sameOriginal,null);assert.equal(review.comparison.sourceTextComparison.sameText,false);assert.equal(review.authenticated,false);assert.match(walletSavedBundleReviewText(review),/内部チェックサムのない/);assert.doesNotMatch(walletSavedBundleReviewText(review),/両方の元記録の形式とチェックサムを確認しました/);
  for(const[role,text]of[['before',fixture.text],['after',after]]){const extracted=walletSavedBundleSourceFile(review,role);assert.equal(extracted.text,text);assert.equal(extracted.internalChecksumVerified,false);assert.equal(extracted.validation,'validated-structure');assert.equal(extracted.automaticallyImported,false);}
  assert.equal((await inspectWalletSavedText(prepared.text)).validation,'declared-only');assert.equal((await inspectWalletSavedText(JSON.stringify(review))).validation,'declared-only');
 }
});
test('checksummed V1 output stays byte-identical and mixed source pairs retain per-side scope',async()=>{
 const original=fixtures[0].text;assert.deepEqual(await prepareWalletSavedSourceBundle(original,original),await prepareWalletSavedBundle(original,original));const mixed=await reviewWalletSavedBundle((await prepareWalletSavedSourceBundle(original,fixtures[3].text)).text);assert.equal(mixed.sourceFilesAvailable,true);assert.equal(mixed.originalsValidated,false);assert.equal(walletSavedBundleSourceFile(mixed,'before').internalChecksumVerified,true);assert.equal(walletSavedBundleSourceFile(mixed,'after').internalChecksumVerified,false);
 await assert.rejects(prepareWalletSavedBundle(fixtures[3].text,fixtures[3].text),{code:'FILE_BUNDLE_ORIGINALS_REQUIRED'});
});
test('valid source substitution, changed claims and old comparison versions cannot release plain sources',async()=>{
 const before=fixtures[3].text,good=JSON.parse((await prepareWalletSavedSourceBundle(before,before)).text),changed=JSON.parse(before);changed.entries[0].account='0x'+'a'.repeat(40);
 const replaced=await reviewWalletSavedBundle(JSON.stringify({...good,afterFileText:JSON.stringify(changed)}));assert.equal(replaced.sourceFilesAvailable,false);assert.equal(replaced.comparisonReview.afterTextBindingMatches,false);assert.throws(()=>walletSavedBundleSourceFile(replaced,'after'),{code:'FILE_BUNDLE_SOURCE'});
 const altered=JSON.parse(good.comparisonText);altered.sourceTextComparison.sameText=false;const rejected=await reviewWalletSavedBundle(JSON.stringify({...good,comparisonText:JSON.stringify(altered)}));assert.equal(rejected.sourceFilesAvailable,false);
 const captured=await inspectWalletSavedText(before),legacy=compareWalletSavedInspections(captured,captured),downgraded=await reviewWalletSavedBundle(JSON.stringify({...good,comparisonText:JSON.stringify(legacy)}));assert.equal(downgraded.comparisonVersionMatches,false);assert.equal(downgraded.sourceFilesAvailable,false);assert.match(walletSavedBundleReviewText(downgraded),/版が/);
 await assert.rejects(reviewWalletSavedBundle(JSON.stringify({...good,schema:'threecore.saved-file-comparison-bundle.v1'})),{code:'FILE_BUNDLE_ORIGINALS_REQUIRED'});
});
test('auxiliary claims, invalid sources, extra fields and forged review copies cannot authorize extraction',async()=>{
 const text=fixtures[3].text,good=await prepareWalletSavedSourceBundle(text,text),review=await reviewWalletSavedBundle(good.text);await assert.rejects(prepareWalletSavedSourceBundle(text,'{"schema":"threecore.saved-file-inspection.v3"}'),{code:'FILE_BUNDLE_ORIGINALS_REQUIRED'});
 const extra=JSON.parse(text);extra.privateKey='not accepted';await assert.rejects(prepareWalletSavedSourceBundle(text,JSON.stringify(extra)));
 await assert.rejects(reviewWalletSavedBundle(JSON.stringify({...JSON.parse(good.text),authenticated:true})),{code:'FILE_BUNDLE_SCHEMA'});
 assert.throws(()=>walletSavedBundleSourceFile(JSON.parse(JSON.stringify(review)),'before'),{code:'FILE_BUNDLE_SOURCE'});
 await assert.rejects(prepareWalletSavedSourceBundle(text,text,{signal:AbortSignal.abort()}),{code:'FILE_CANCELLED'});
});
