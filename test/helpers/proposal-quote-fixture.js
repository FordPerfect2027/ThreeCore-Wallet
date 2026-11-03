import { quoteFixture } from './aerodrome-quote-fixture.js';
import { proposalFixture,proposalHash } from './proposal-fixtures.js';
import { prepareTokenIdentityFile } from '../../src/token-identity-report.js';
import { encodeOperationBudget } from '../../src/operation-budget.js';
import { encodeBudgetEvidence } from '../../src/operation-budget-evidence.js';
import { encodeOperationProposal,encodeProposalReviewPolicy } from '../../src/operation-proposal.js';
import { prepareOperationProposalReview } from '../../src/operation-proposal-file.js';
import { prepareAerodromeQuoteFile } from '../../src/aerodrome-quote-model.js';
import { THREECORE_BASE_TOKENS,AERODROME_BASE } from '../../src/aerodrome-readonly.js';
export async function proposalQuoteFixture({nowSeconds=1793700000}={}){
  const f=await proposalFixture({nowSeconds}),q=quoteFixture({nowSeconds});
  f.budgets[0].chainId=8453;f.observations[0].chainId=8453;f.observations[0].tokenAddress=THREECORE_BASE_TOKENS.DAT;
  f.evidence.budgetFile=encodeOperationBudget(f.budgets[0]);f.evidence.observationFiles[0]=(await prepareTokenIdentityFile(f.observations[0])).text;
  f.evidenceText=encodeBudgetEvidence(f.evidence);f.proposal.budgetEvidenceSha256=proposalHash(f.evidenceText);
  for(const row of [f.proposal,f.policy]){row.chainId=8453;row.tokenAddress=THREECORE_BASE_TOKENS.DAT;}
  f.proposal.dapp={origin:'https://aerodrome.finance',contract:AERODROME_BASE.router};f.policy.allowedDapps=[{...f.proposal.dapp}];
  const review=await prepareOperationProposalReview({proposalFile:encodeOperationProposal(f.proposal),policyFile:encodeProposalReviewPolicy(f.policy),budgetEvidenceFile:f.evidenceText},{nowSeconds});
  return {f,q,files:{proposalReviewFile:review.text,quoteFile:(await prepareAerodromeQuoteFile(q)).text},options:{nowSeconds,maxQuoteAgeSeconds:60,maxBlockAgeSeconds:60,maxOutputShortfallBps:100,maxSlippageBps:50}};
}
