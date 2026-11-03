import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteFixture,QUOTE_HASH } from './helpers/aerodrome-quote-fixture.js';
import { proposalFixture,proposalHash } from './helpers/proposal-fixtures.js';
import { prepareTokenIdentityFile } from '../src/token-identity-report.js';
import { encodeOperationBudget } from '../src/operation-budget.js';
import { encodeBudgetEvidence } from '../src/operation-budget-evidence.js';
import { encodeOperationProposal,encodeProposalReviewPolicy } from '../src/operation-proposal.js';
import { prepareOperationProposalReview } from '../src/operation-proposal-file.js';
import { calculateAerodromeQuote,validateAerodromeQuote,prepareAerodromeQuoteFile,inspectAerodromeQuoteFile,inspectProposalQuote } from '../src/aerodrome-quote-model.js';
import { THREECORE_BASE_TOKENS,AERODROME_BASE } from '../src/aerodrome-readonly.js';

async function linked(){
  const f=await proposalFixture(),q=quoteFixture({nowSeconds:f.nowSeconds});
  f.budgets[0].chainId=8453;f.observations[0].chainId=8453;f.observations[0].tokenAddress=THREECORE_BASE_TOKENS.DAT;
  f.evidence.budgetFile=encodeOperationBudget(f.budgets[0]);f.evidence.observationFiles[0]=(await prepareTokenIdentityFile(f.observations[0])).text;
  f.evidenceText=encodeBudgetEvidence(f.evidence);f.proposal.budgetEvidenceSha256=proposalHash(f.evidenceText);
  for(const row of [f.proposal,f.policy]){row.chainId=8453;row.tokenAddress=THREECORE_BASE_TOKENS.DAT;}
  f.proposal.dapp={origin:'https://aerodrome.finance',contract:AERODROME_BASE.router};f.policy.allowedDapps=[{...f.proposal.dapp}];
  const review=await prepareOperationProposalReview({proposalFile:encodeOperationProposal(f.proposal),policyFile:encodeProposalReviewPolicy(f.policy),budgetEvidenceFile:f.evidenceText},{nowSeconds:f.nowSeconds});
  return {f,q,review,options:{nowSeconds:f.nowSeconds,maxQuoteAgeSeconds:60,maxBlockAgeSeconds:60,maxOutputShortfallBps:100,maxSlippageBps:50}};
}
test('quote arithmetic preserves fee flooring and conservatively rounds minimum output and shortfall',()=>{
  const q=quoteFixture(),r=calculateAerodromeQuote(q);
  assert.equal(r.inputFeeBaseUnits,'150000000000000000');assert.equal(r.minimumOutputBaseUnits,(BigInt(q.poolOutputBaseUnits)*9950n/10000n).toString());
  assert.equal(r.outputShortfallBpsCeil,32);assert.equal(r.authorizesExecution,false);assert(Object.isFrozen(r.quote));
  const zeroFee={...q,feeBps:0,poolOutputBaseUnits:'2499',routerOutputBaseUnits:'2499'};assert.equal(calculateAerodromeQuote(zeroFee).inputFeeBaseUnits,'0');
  assert.throws(()=>validateAerodromeQuote({...q,inputBaseUnits:String((1n<<256n)-1n)}),{code:'QUOTE_ARITHMETIC_OVERFLOW'});
});
test('quote files revalidate arithmetic and checksum rather than trusting saved output',async()=>{
  const q=quoteFixture(),file=await prepareAerodromeQuoteFile(q);assert.deepEqual((await inspectAerodromeQuoteFile(file.text)).quote,q);
  const data=JSON.parse(file.text);data.quote.slippageBps++;await assert.rejects(inspectAerodromeQuoteFile(JSON.stringify(data)),{code:'QUOTE_CHECKSUM'});
  data.quote.routerOutputBaseUnits='1';await assert.rejects(inspectAerodromeQuoteFile(JSON.stringify(data)),{code:'QUOTE_OUTPUT_MISMATCH'});
  for(const change of [{readOnly:false},{dappOrigin:'https://evil.invalid'},{inputDecimals:6},{feeBps:301},{agent:{toString(){throw Error('must not run');}}}])assert.throws(()=>validateAerodromeQuote({...q,...change}));
});
test('proposal, exact input amount, router, original budget block and current limits bind the quote',async()=>{
  const {f,q,review,options}=await linked();assert.equal(review.result.checksSatisfied,true);
  const result=await inspectProposalQuote(review.text,(await prepareAerodromeQuoteFile(q)).text,options);
  assert.equal(result.checksSatisfied,true);assert.equal(result.authorizesExecution,false);assert.equal(result.currentStateVerified,false);assert.equal(result.simulationExecuted,false);
  for(const [change,reason] of [[{observedAtSeconds:f.nowSeconds-61},'QUOTE_STALE'],[{blockTimestampSeconds:f.nowSeconds-61},'QUOTE_BLOCK_STALE'],[{observedAtSeconds:f.nowSeconds+1},'QUOTE_FUTURE_TIME'],[{blockHash:'0x'+'cd'.repeat(32)},'QUOTE_BUDGET_BLOCK_MISMATCH']]){
    const r=await inspectProposalQuote(review.text,(await prepareAerodromeQuoteFile({...q,...change})).text,options);assert.equal(r.checksSatisfied,false);assert(r.reasons.includes(reason));
  }
  const changed=quoteFixture({inputBaseUnits:'100000000000000000000',nowSeconds:f.nowSeconds});
  assert((await inspectProposalQuote(review.text,(await prepareAerodromeQuoteFile(changed)).text,options)).reasons.includes('QUOTE_PROPOSAL_MISMATCH'));
  assert((await inspectProposalQuote(review.text,(await prepareAerodromeQuoteFile(q)).text,{...options,maxOutputShortfallBps:0})).reasons.includes('QUOTE_OUTPUT_SHORTFALL_LIMIT'));
  assert((await inspectProposalQuote(review.text,(await prepareAerodromeQuoteFile(q)).text,{...options,maxSlippageBps:49})).reasons.includes('QUOTE_SLIPPAGE_LIMIT'));
  assert((await inspectProposalQuote(review.text,(await prepareAerodromeQuoteFile(q)).text,{...options,nowSeconds:f.nowSeconds+1000})).reasons.includes('PROPOSAL_CONDITIONS_UNSATISFIED'));
});
test('comparison limits must be explicit and valid; cancellation interrupts archived source validation',async()=>{
  const {q,review,options}=await linked(),file=(await prepareAerodromeQuoteFile(q)).text;
  for(const changes of [{maxQuoteAgeSeconds:undefined},{maxQuoteAgeSeconds:0},{maxBlockAgeSeconds:3601},{maxOutputShortfallBps:undefined},{maxOutputShortfallBps:-1},{maxSlippageBps:undefined},{maxSlippageBps:10000}])await assert.rejects(inspectProposalQuote(review.text,file,{...options,...changes}));
  const abort=new AbortController();abort.abort();await assert.rejects(inspectProposalQuote(review.text,file,{...options,signal:abort.signal}));
});
