import { captureDataRecord,captureOptionalDataFields,sha256Hex } from './security-data.js';
import { decodeBudgetEvidence,inspectBudgetEvidence } from './operation-budget-evidence.js';
import { operationBudgetAssetSymbol } from './operation-budget.js';
import { parseRehearsalUnits } from './operation-rehearsal.js';
import { OPERATION_PROPOSAL_SCHEMA,PROPOSAL_POLICY_SCHEMA,OperationProposalError,encodeOperationProposal,encodeProposalReviewPolicy } from './operation-proposal.js';
import { prepareOperationProposalReview } from './operation-proposal-file.js';
const fail=code=>{throw new OperationProposalError(code);};

/** Context comes only from the original saved budget and corresponding observation. */
export async function inspectProposalDraftSource(text,options={}){
 const evidence=await inspectBudgetEvidence(decodeBudgetEvidence(text),options);
 if(!evidence.consistent)fail('DRAFT_SOURCE_INCONSISTENT');
 const rows=evidence.budgetResult.results??[evidence.budgetResult];
 const contexts=rows.map(row=>{
  const b=row.input,o=evidence.comparisons.find(c=>c.agent===b.agent)?.observation;
  if(!o)fail('DRAFT_SOURCE_MISSING');
  return Object.freeze({agent:b.agent,chainId:b.chainId,account:o.account,tokenAddress:o.tokenAddress,
   asset:operationBudgetAssetSymbol(b),decimals:b.token.decimals,spendUnits:b.token.spendUnits,nativeValueWei:b.native.valueWei,
   plannedFeeBudgetWei:row.plannedFeeBudgetWei,blockNumber:o.blockNumber,blockHash:o.blockHash});
 });
 return Object.freeze({contexts:Object.freeze(contexts),budgetConstraintsSatisfied:evidence.budgetResult.constraintsSatisfied});
}

/** Manual descriptive draft plus independently entered comparison limits. Never wallet authorization. */
export async function prepareManualOperationProposal(input,options={}){
 let data,settings;try{
  data=captureDataRecord(input,['budgetEvidenceFile','agent','proposalId','label','rationale','dappOrigin','dappContract','maxSpendAmount','maxNativeAmount','maxFeeAmount','lifetimeMinutes']);
  settings=captureOptionalDataFields(options,['nowSeconds','subtle','signal','timeoutMs']);
 }catch{fail('INVALID_DRAFT_INPUT');}
 if(typeof data.lifetimeMinutes!=='string'||!/^[1-9][0-9]{0,3}$/.test(data.lifetimeMinutes)||Number(data.lifetimeMinutes)>1440)fail('INVALID_DRAFT_LIFETIME');
 const createdAtSeconds=settings.nowSeconds??Math.floor(Date.now()/1000);
 if(!Number.isSafeInteger(createdAtSeconds)||createdAtSeconds<0||createdAtSeconds>253402214399)fail('INVALID_TIME');
 const lifetime=Number(data.lifetimeMinutes)*60,expiresAtSeconds=createdAtSeconds+lifetime;
 const source=await inspectProposalDraftSource(data.budgetEvidenceFile,settings),context=source.contexts.find(c=>c.agent===data.agent);
 if(!context)fail('DRAFT_SOURCE_MISSING');
 const {agent,chainId,account,tokenAddress}=context,common={agent,chainId,account,tokenAddress};
 const dapp={origin:data.dappOrigin,contract:data.dappContract};
 const maxTokenSpendUnits=parseRehearsalUnits(data.maxSpendAmount,context.decimals),maxNativeValueWei=parseRehearsalUnits(data.maxNativeAmount,18),maxTotalFeeWei=parseRehearsalUnits(data.maxFeeAmount,18);
 // The exact evidence bytes are hashed by the existing source-linked review path.
 const hash=await sha256Hex(new TextEncoder().encode(data.budgetEvidenceFile),settings.subtle,settings);
 const proposal={schema:OPERATION_PROPOSAL_SCHEMA,reviewOnly:true,proposalId:data.proposalId,source:{kind:'manual',label:data.label},...common,dapp,
  spendUnits:context.spendUnits,nativeValueWei:context.nativeValueWei,createdAtSeconds,expiresAtSeconds,budgetEvidenceSha256:hash,rationale:data.rationale};
 const policy={schema:PROPOSAL_POLICY_SCHEMA,reviewOnly:true,...common,allowedDapps:[dapp],maxTokenSpendUnits,maxNativeValueWei,maxTotalFeeWei,
  validFromSeconds:createdAtSeconds,expiresAtSeconds,maxProposalLifetimeSeconds:lifetime};
 return prepareOperationProposalReview({proposalFile:encodeOperationProposal(proposal),policyFile:encodeProposalReviewPolicy(policy),budgetEvidenceFile:data.budgetEvidenceFile},{...settings,nowSeconds:createdAtSeconds});
}
