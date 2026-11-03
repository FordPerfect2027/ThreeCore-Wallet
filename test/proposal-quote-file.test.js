import test from 'node:test';
import assert from 'node:assert/strict';
import { proposalQuoteFixture } from './helpers/proposal-quote-fixture.js';
import { prepareProposalQuoteReview,inspectProposalQuoteReviewFile,PROPOSAL_QUOTE_FILE_LIMIT } from '../src/proposal-quote-file.js';

test('saved quote comparison preserves exact originals and selected limits, replaying success and expiry',async()=>{
 const {files,options}=await proposalQuoteFixture();files.quoteFile='  '+files.quoteFile+'\n';
 for(const nowSeconds of [options.nowSeconds,options.nowSeconds+700]){
  const saved=await prepareProposalQuoteReview(files,{...options,nowSeconds}),read=await inspectProposalQuoteReviewFile(saved.text);
  assert.deepEqual(read.files,files);assert.deepEqual(read.limits,saved.result.limits);assert.equal(read.recordedResult.checksSatisfied,nowSeconds===options.nowSeconds);
  assert.equal(read.historicalOnly,true);assert.equal(read.timestampAuthenticated,false);assert.equal(read.authorizesExecution,false);
  assert.equal((await prepareProposalQuoteReview(read.files,{...read.limits,nowSeconds})).text,saved.text);
 }
});
test('changed verdict, time, limits, permissions and source must pass recomputation; invalid structure and cancellation fail closed',async()=>{
 const {files,options}=await proposalQuoteFixture(),saved=await prepareProposalQuoteReview(files,options);
 for(const edit of [v=>{v.result.checksSatisfied=false;},v=>{v.result.reasons=['QUOTE_STALE'];},v=>{v.evaluatedAtSeconds+=700;},v=>{v.limits.maxSlippageBps=0;},v=>{v.result.authorizesExecution=true;},v=>{v.reviewOnly=false;},v=>{v.limits.extra=1;},v=>{v.quoteFile+='x';},v=>{v.evaluatedAtSeconds=null;}]){
  const data=JSON.parse(saved.text);edit(data);await assert.rejects(inspectProposalQuoteReviewFile(JSON.stringify(data)));
 }
 await assert.rejects(inspectProposalQuoteReviewFile(' '.repeat(PROPOSAL_QUOTE_FILE_LIMIT+1)),{code:'QUOTE_REVIEW_FILE_SIZE'});
 const abort=new AbortController();abort.abort();await assert.rejects(inspectProposalQuoteReviewFile(saved.text,{signal:abort.signal}));
 const input={...files};Object.defineProperty(input,'quoteFile',{get(){throw Error('Getter must not run');}});await assert.rejects(prepareProposalQuoteReview(input,options),{code:'QUOTE_REVIEW_FORMAT'});
});
