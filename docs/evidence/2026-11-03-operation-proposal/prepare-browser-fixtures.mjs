import { mkdir,writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { proposalFixture } from '../../../test/helpers/proposal-fixtures.js';
import { encodeOperationProposal,encodeProposalReviewPolicy } from '../../../src/operation-proposal.js';
import { prepareOperationProposalReview } from '../../../src/operation-proposal-file.js';
const dir=new URL('./browser-fixtures/',import.meta.url);await mkdir(dir); // Never replace an existing fixture set.
const nowSeconds=Math.floor(Date.now()/1000),f=await proposalFixture({nowSeconds});
f.proposal.expiresAtSeconds=nowSeconds+1800;f.policy.expiresAtSeconds=nowSeconds+3600;f.policy.maxProposalLifetimeSeconds=3600;
const files={proposalFile:encodeOperationProposal(f.proposal),policyFile:encodeProposalReviewPolicy(f.policy),budgetEvidenceFile:f.evidenceText};
for(const [key,name] of [['proposalFile','proposal.json'],['policyFile','policy.json'],['budgetEvidenceFile','budget-evidence.json']])await writeFile(new URL(name,dir),files[key],{flag:'wx'});
await writeFile(new URL('policy-over-limit.json',dir),encodeProposalReviewPolicy({...f.policy,maxTokenSpendUnits:'1'}),{flag:'wx'});
const old=await proposalFixture({nowSeconds:nowSeconds-1000});
const oldReview=await prepareOperationProposalReview({proposalFile:encodeOperationProposal(old.proposal),policyFile:encodeProposalReviewPolicy(old.policy),budgetEvidenceFile:old.evidenceText},{nowSeconds:old.nowSeconds});
await writeFile(new URL('previously-passed-now-expired.json',dir),oldReview.text,{flag:'wx'});
await writeFile(new URL('fixture-context.json',dir),JSON.stringify({synthetic:true,modelCalled:false,source:'test/helpers/proposal-fixtures.js',createdAtSeconds:nowSeconds,matchingExpiresAt:f.proposal.expiresAtSeconds,actualChainQuery:false,actualWalletCall:false},null,2)+'\n',{flag:'wx'});
console.log(fileURLToPath(dir));
