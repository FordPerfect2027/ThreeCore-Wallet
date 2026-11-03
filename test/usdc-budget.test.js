import test from 'node:test';
import assert from 'node:assert/strict';
import { usdcFixture,usdcBudget } from './helpers/usdc-fixture.js';
import { operationBudgetExample,encodeOperationBudget,evaluateOperationBudget,operationBudgetAssetSymbol } from '../src/operation-budget.js';
import { SHARED_BUDGET_SCHEMA,evaluateSharedOperationBudget,encodeSharedOperationBudget } from '../src/shared-operation-budget.js';
import { BUDGET_EVIDENCE_SCHEMA,inspectBudgetEvidence,encodeBudgetEvidence } from '../src/operation-budget-evidence.js';
import { preparePublicUsdcFile,decodePublicUsdcFile,validatePublicUsdc } from '../src/public-usdc-model.js';
import { prepareTokenIdentityFile } from '../src/token-identity-report.js';
import { observation } from './helpers/identity-fixtures.js';
import { proposalFixture,proposalHash } from './helpers/proposal-fixtures.js';
import { encodeOperationProposal,encodeProposalReviewPolicy } from '../src/operation-proposal.js';
import { prepareOperationProposalReview } from '../src/operation-proposal-file.js';
import { quoteFixture } from './helpers/aerodrome-quote-fixture.js';
import { inspectProposalQuote,prepareAerodromeQuoteFile } from '../src/aerodrome-quote-model.js';
import { BASE_NATIVE_USDC } from '../src/aerodrome-pools.js';
import { AERODROME_BASE } from '../src/aerodrome-readonly.js';
const shared=budgets=>({schema:SHARED_BUDGET_SCHEMA,simulationOnly:true,sameAccount:true,budgets});
const evidence=async budget=>({schema:BUDGET_EVIDENCE_SCHEMA,budgetFile:encodeOperationBudget(budget),observationFiles:[(await preparePublicUsdcFile(usdcFixture())).text]});
test('USDC budgets have a separate schema, fixed network and precision; legacy budgets keep their currency',()=>{
 const b=usdcBudget();assert.equal(evaluateOperationBudget(b).constraintsSatisfied,true);assert.equal(operationBudgetAssetSymbol(b),'USDC');assert.equal(operationBudgetAssetSymbol(operationBudgetExample()),'DAT');
 for(const change of [{chainId:84532},{token:{...b.token,decimals:18}}])assert.throws(()=>evaluateOperationBudget({...b,...change}),{code:'USDC_BUDGET_CONTEXT'});
 assert.equal(evaluateOperationBudget({...b,native:{...b.native,balanceWei:'0'}}).constraintsSatisfied,false);
 const missing={...b,fees:{...b.fees,operatorFeeBudgetWei:null}};assert(evaluateOperationBudget(missing).reasons.includes('FEE_COMPONENT_UNKNOWN'));
});
test('separate agents cannot each spend the same USDC; shared reserves are counted once',()=>{
 const a=usdcBudget('DAT'),b=usdcBudget('EMA');a.token.spendUnits='5000000';b.token.spendUnits='5000000';
 assert(evaluateOperationBudget(a).constraintsSatisfied);assert(evaluateOperationBudget(b).constraintsSatisfied);
 const r=evaluateSharedOperationBudget(shared([a,b]));assert.equal(r.individuallySatisfied,true);assert.equal(r.constraintsSatisfied,false);assert.equal(r.sharedUsdc.required,'12000000');assert.equal(r.sharedUsdc.shortfall,'2000000');assert(r.reasons.includes('SHARED_USDC_SHORTFALL'));
 b.token.spendUnits='3000000';assert.equal(evaluateSharedOperationBudget(shared([a,b])).sharedUsdc.required,'10000000');
 for(const key of ['balanceUnits','reservedUnits','reserveFloorUnits']){const changed=structuredClone(b);changed.token[key]='2';assert.throws(()=>evaluateSharedOperationBudget(shared([a,changed])),{code:'SHARED_USDC_BALANCE_MISMATCH'});}
});
test('USDC source is checksum-bound and rejects bridged token, wrong decimals, supply overflow and tampering',async()=>{
 const o=usdcFixture(),file=await preparePublicUsdcFile(o);assert.deepEqual((await decodePublicUsdcFile(file.text)).observation,o);
 for(const change of [{tokenAddress:'0x'+'11'.repeat(20)},{metadata:{...o.metadata,decimals:18}},{balanceBaseUnits:'1000000001'},{walletConnected:true}])assert.throws(()=>validatePublicUsdc({...o,...change}));
 const raw=JSON.parse(file.text);raw.observation.balanceBaseUnits='1';await assert.rejects(decodePublicUsdcFile(JSON.stringify(raw)),{code:'USDC_CHECKSUM'});
});
test('one USDC source expands only to matching budgets and retains aggregate insufficiency',async()=>{
 const a=usdcBudget('DAT'),b=usdcBudget('EMA');a.token.spendUnits='5000000';b.token.spendUnits='5000000';const e=await evidence(a);e.budgetFile=encodeSharedOperationBudget(shared([a,b]));
 const r=await inspectBudgetEvidence(e);assert.equal(r.consistent,true);assert.equal(r.comparisons.length,2);assert(r.comparisons.every(row=>row.observation.spendingAsset==='USDC'));assert.equal(r.budgetResult.constraintsSatisfied,false);
 e.observationFiles.push(e.observationFiles[0]);await assert.rejects(inspectBudgetEvidence(e),{code:'DUPLICATE_SOURCE_AGENT'});
 const wrong=await evidence(a);wrong.observationFiles=[(await prepareTokenIdentityFile(observation({balanceBaseUnits:a.token.balanceUnits,nativeBalanceBaseUnits:a.native.balanceWei}))).text];
 assert((await inspectBudgetEvidence(wrong)).comparisons[0].reasons.includes('BUDGET_ASSET_MISMATCH'));
 const legacy=await evidence(operationBudgetExample());await assert.rejects(inspectBudgetEvidence(legacy),{code:'USDC_SOURCE_WITHOUT_BUDGET'});
});
test('USDC-funded buy quote binds proposal, original source account/block, price, limits and budget',async()=>{
 const nowSeconds=1793700002,b=usdcBudget(),e=await evidence(b),evidenceText=encodeBudgetEvidence(e),f=await proposalFixture({nowSeconds}),quote=quoteFixture({direction:'buy',nowSeconds});
 for(const row of [f.proposal,f.policy]){row.chainId=8453;row.tokenAddress=BASE_NATIVE_USDC;}
 Object.assign(f.proposal,{spendUnits:'1000000',budgetEvidenceSha256:proposalHash(evidenceText),dapp:{origin:'https://aerodrome.finance',contract:AERODROME_BASE.router}});f.policy.maxTokenSpendUnits='1000000';f.policy.allowedDapps=[f.proposal.dapp];
 const files={proposalFile:encodeOperationProposal(f.proposal),policyFile:encodeProposalReviewPolicy(f.policy),budgetEvidenceFile:evidenceText};
 const review=await prepareOperationProposalReview(files,{nowSeconds});assert.equal(review.result.checksSatisfied,true);
 const options={nowSeconds,maxQuoteAgeSeconds:60,maxBlockAgeSeconds:60,maxOutputShortfallBps:200,maxSlippageBps:50};const result=await inspectProposalQuote(review.text,(await prepareAerodromeQuoteFile(quote)).text,options);assert.equal(result.checksSatisfied,true);assert.equal(result.authorizesExecution,false);
 const altered=await prepareAerodromeQuoteFile({...quote,blockHash:'0x'+'cd'.repeat(32)});assert((await inspectProposalQuote(review.text,altered.text,options)).reasons.includes('QUOTE_BUDGET_BLOCK_MISMATCH'));
});
