import test from 'node:test';import assert from 'node:assert/strict';
import {savedDifferencePageFixtures} from './helpers/workspace-fixtures.js';
import {inspectWalletSavedTextDifferences,encodeWalletSavedTextDifferences,queryWalletSavedTextDifferences,encodeWalletSavedTextDifferencePage,walletSavedTextDifferencePageText,inspectWalletSavedText} from '../src/file-read-status.js';
const pair=savedDifferencePageFixtures(),result=await inspectWalletSavedTextDifferences(pair.before,pair.after);
test('all pages cover the full difference sequence once while the original bounded receipt stays unchanged',()=>{
 const original=encodeWalletSavedTextDifferences(result),pages=[0,40,80].map(offset=>queryWalletSavedTextDifferences(result,{offset}));assert.deepEqual(pages.map(page=>page.shownDifferences),[40,40,6]);assert.deepEqual(pages.flatMap(page=>page.differences.map(row=>row.ordinal)),Array.from({length:86},(_,i)=>i+1));assert.equal(pages[0].hasPrevious,false);assert.equal(pages[1].hasPrevious,true);assert.equal(pages[2].hasNext,false);assert.equal(pages[2].totalDifferences,86);assert.equal(pages[1].beforeTextDigest,result.before.textDigest);assert.equal(encodeWalletSavedTextDifferences(result),original);assert.doesNotMatch(encodeWalletSavedTextDifferencePage(pages[1]),/0x[0-9a-f]{40}/);
});
test('path filters keep global ordinals and distinguish an empty subset from globally equal inputs',()=>{
 const events=queryWalletSavedTextDifferences(result,{pathIncludes:'/events',offset:80});assert.equal(events.totalDifferences,86);assert.equal(events.matchedDifferences,85);assert.equal(events.shownDifferences,5);assert.equal(events.differences[0].ordinal,82);assert.equal(events.differences.at(-1).path,'/events/84/amount');
 const policy=queryWalletSavedTextDifferences(result,{pathIncludes:'/policy'});assert.equal(policy.matchedDifferences,1);assert.equal(policy.differences[0].path,'/policy/paused');
 const empty=queryWalletSavedTextDifferences(result,{pathIncludes:'/Policy'});assert.equal(empty.matchedDifferences,0);assert.equal(empty.totalDifferences,86);assert.match(walletSavedTextDifferencePageText(empty),/全体の一致を意味しません/);assert.equal(empty.hasNext,false);
});
test('page query bounds, owned-source requirements and descriptor capture reject forged or hostile input',()=>{
 for(const query of [{offset:1},{offset:120},{offset:-40},{offset:Infinity},{pathIncludes:'x'.repeat(129)},{pathIncludes:'x\ny'}])assert.throws(()=>queryWalletSavedTextDifferences(result,query),{code:'FILE_DIFFERENCE_QUERY'});
 let gets=0;assert.throws(()=>queryWalletSavedTextDifferences(result,Object.defineProperty({},'pathIncludes',{get(){gets++;return'';}})),{code:'FILE_DIFFERENCE_QUERY'});assert.equal(gets,0);
 assert.throws(()=>queryWalletSavedTextDifferences(JSON.parse(encodeWalletSavedTextDifferences(result))),{code:'FILE_DIFFERENCE_RESULT'});const page=queryWalletSavedTextDifferences(result);assert.throws(()=>encodeWalletSavedTextDifferencePage({...page}),{code:'FILE_DIFFERENCE_RESULT'});
});
test('JSON pages remain auxiliary and CSV retains empty scope, source bindings and spreadsheet-safe fields',async()=>{
 const empty=queryWalletSavedTextDifferences(result,{pathIncludes:'=SUM(1)'}),csv=encodeWalletSavedTextDifferencePage(empty,'csv');assert(csv.startsWith('\ufeff'));assert.equal(csv.split('\r\n').length,3);assert(csv.includes("'=SUM(1)"));assert(csv.includes('"scope"'));assert(csv.includes(result.before.textDigest));assert(csv.includes('"86","0","0"'));assert.equal((await inspectWalletSavedText(encodeWalletSavedTextDifferencePage(empty))).validation,'declared-only');
 const page=queryWalletSavedTextDifferences(result,{offset:80}),populated=encodeWalletSavedTextDifferencePage(page,'csv');assert.equal(populated.split('\r\n').length,9);assert.match(populated,/"difference","86","\/events\/84\/amount","value"/);
});
