import test from 'node:test';
import assert from 'node:assert/strict';
import { proposalFixture } from './helpers/proposal-fixtures.js';
import { usdcFixture,usdcBudget } from './helpers/usdc-fixture.js';
import { encodeOperationBudget } from '../src/operation-budget.js';
import { BUDGET_EVIDENCE_SCHEMA,encodeBudgetEvidence } from '../src/operation-budget-evidence.js';
import { preparePublicUsdcFile } from '../src/public-usdc-model.js';
import { inspectProposalDraftSource,prepareManualOperationProposal } from '../src/operation-proposal-draft.js';
import { inspectOperationProposalReviewFile,prepareOperationProposalReview } from '../src/operation-proposal-file.js';
import { formatRehearsalUnits } from '../src/operation-rehearsal.js';
export const draftInput=f=>({budgetEvidenceFile:f.evidenceText,agent:f.proposal.agent,proposalId:'manual-fixture',label:'Manual test input',rationale:'Synthetic planning example; no AI or transaction.',dappOrigin:f.proposal.dapp.origin,dappContract:f.proposal.dapp.contract,maxSpendAmount:'100',maxNativeAmount:'0',maxFeeAmount:'0.001',lifetimeMinutes:'60'});
test('manual draft binds all three shared-budget choices to original context and saves directly reviewable sources',async()=>{
 const f=await proposalFixture({shared:true}),source=await inspectProposalDraftSource(f.evidenceText);assert.equal(source.contexts.length,3);
 for(const agent of ['DAT','EMA','CAWELON']){
  const c=source.contexts.find(c=>c.agent===agent),d=draftInput(f);d.agent=agent;d.maxSpendAmount=formatRehearsalUnits(c.spendUnits,c.decimals);
  const file=await prepareManualOperationProposal(d,{nowSeconds:f.nowSeconds}),r=file.result;assert.equal(r.checksSatisfied,true);assert.equal(r.proposal.source.kind,'manual');assert.equal(r.proposal.account,c.account);assert.equal(r.proposal.tokenAddress,c.tokenAddress);assert.equal(r.proposal.spendUnits,c.spendUnits);assert.equal(r.policy.maxTokenSpendUnits,c.spendUnits);
  assert.equal(r.proposal.expiresAtSeconds-r.proposal.createdAtSeconds,3600);assert.equal(file.files.budgetEvidenceFile,f.evidenceText);assert.equal(r.authorizesExecution,false);
  assert.deepEqual((await inspectOperationProposalReviewFile(file.text)).files,file.files);
 }
});
test('USDC limits use six decimals; insufficient budgets and smaller limits cannot be promoted to pass',async()=>{
 const f=await proposalFixture(),o=usdcFixture(),b=usdcBudget('EMA');b.token.spendUnits='1234567';
 const source=(await preparePublicUsdcFile(o)).text;const d={...draftInput(f),agent:'EMA',maxSpendAmount:'1.234567',budgetEvidenceFile:encodeBudgetEvidence({schema:BUDGET_EVIDENCE_SCHEMA,budgetFile:encodeOperationBudget(b),observationFiles:[source]})};
 const good=await prepareManualOperationProposal(d,{nowSeconds:f.nowSeconds});assert.equal(good.result.checksSatisfied,true);assert.equal(good.result.proposal.spendUnits,'1234567');assert.equal(good.result.policy.maxTokenSpendUnits,'1234567');
 const limited=await prepareManualOperationProposal({...d,maxSpendAmount:'1.234566'},{nowSeconds:f.nowSeconds});assert(limited.result.reasons.includes('TOKEN_SPEND_LIMIT'));assert.equal(limited.result.policy.maxTokenSpendUnits,'1234566');
 await assert.rejects(prepareManualOperationProposal({...d,maxSpendAmount:'1.2345671'}));
 const poor=usdcFixture({balanceBaseUnits:'0'});b.token.balanceUnits='0';d.budgetEvidenceFile=encodeBudgetEvidence({schema:BUDGET_EVIDENCE_SCHEMA,budgetFile:encodeOperationBudget(b),observationFiles:[(await preparePublicUsdcFile(poor)).text]});
 const insufficient=await prepareManualOperationProposal(d);assert(insufficient.result.reasons.includes('BUDGET_CONSTRAINTS_UNSATISFIED'));assert.equal(insufficient.result.checksSatisfied,false);
});
test('unknown fees remain blocked despite an entered zero ceiling; inconsistent sources and invalid fields cannot create a draft',async()=>{
 const f=await proposalFixture(),d=draftInput(f),budget=JSON.parse(f.evidence.budgetFile);budget.fees.operatorFeeBudgetWei=null;
 d.budgetEvidenceFile=encodeBudgetEvidence({...f.evidence,budgetFile:encodeOperationBudget(budget)});d.maxFeeAmount='0';
 const file=await prepareManualOperationProposal(d);assert(file.result.reasons.includes('FEE_BUDGET_UNKNOWN'));assert(file.result.reasons.includes('FEE_BUDGET_LIMIT'));
 budget.token.balanceUnits='1';await assert.rejects(inspectProposalDraftSource(encodeBudgetEvidence({...f.evidence,budgetFile:encodeOperationBudget(budget)})),{code:'DRAFT_SOURCE_INCONSISTENT'});
 for(const changes of [{lifetimeMinutes:'0'},{lifetimeMinutes:'1441'},{lifetimeMinutes:'1.5'},{maxFeeAmount:''},{agent:'OTHER'},{dappOrigin:'javascript:alert(1)'},{dappOrigin:'https://example.invalid/path'},{dappContract:'0x0'},{proposalId:'bad id'},{source:{kind:'ai'}}])await assert.rejects(prepareManualOperationProposal({...draftInput(f),...changes}));
});
test('saved draft does not extend its validity when replayed and exact budget bytes remain bound',async()=>{
 const f=await proposalFixture(),file=await prepareManualOperationProposal({...draftInput(f),lifetimeMinutes:'1'},{nowSeconds:f.nowSeconds});
 const recorded=await inspectOperationProposalReviewFile(file.text);assert.equal(recorded.recordedResult.checksSatisfied,true);
 const current=await prepareOperationProposalReview(recorded.files,{nowSeconds:f.nowSeconds+61});assert(current.result.reasons.includes('PROPOSAL_EXPIRED'));assert(current.result.reasons.includes('POLICY_EXPIRED'));
 await assert.rejects(prepareOperationProposalReview({...recorded.files,budgetEvidenceFile:recorded.files.budgetEvidenceFile+'\n'},{nowSeconds:f.nowSeconds}),{code:'BUDGET_EVIDENCE_HASH_MISMATCH'});
});
