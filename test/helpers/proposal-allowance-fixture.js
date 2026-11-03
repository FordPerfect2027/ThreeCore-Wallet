import { proposalQuoteFixture } from './proposal-quote-fixture.js';
import { quoteFixture, word } from './aerodrome-quote-fixture.js';
import { proposalFixture, proposalHash } from './proposal-fixtures.js';
import { usdcFixture, usdcBudget } from './usdc-fixture.js';
import { encodeOperationBudget } from '../../src/operation-budget.js';
import { SHARED_BUDGET_SCHEMA,encodeSharedOperationBudget } from '../../src/shared-operation-budget.js';
import { BUDGET_EVIDENCE_SCHEMA, encodeBudgetEvidence } from '../../src/operation-budget-evidence.js';
import { preparePublicUsdcFile } from '../../src/public-usdc-model.js';
import { encodeOperationProposal, encodeProposalReviewPolicy } from '../../src/operation-proposal.js';
import { prepareOperationProposalReview } from '../../src/operation-proposal-file.js';
import { prepareAerodromeQuoteFile } from '../../src/aerodrome-quote-model.js';
import { prepareProposalQuoteReview } from '../../src/proposal-quote-file.js';
import { PROPOSAL_ALLOWANCE_SCHEMA, allowanceRequestFromReview } from '../../src/proposal-allowance.js';
import { AERODROME_BASE } from '../../src/aerodrome-readonly.js';
import { BASE_NATIVE_USDC } from '../../src/aerodrome-pools.js';
export async function allowanceFixture({nowSeconds=1793700002,buy=false,agent='DAT',shared=false,omitAgent=false}={}) {
 let f=await proposalQuoteFixture({nowSeconds});
 if(buy) {
  const b=usdcBudget(agent),o=usdcFixture({blockTimestampSeconds:nowSeconds-2,observedAtSeconds:nowSeconds}),p=await proposalFixture({agent,nowSeconds});
  const budgets=['DAT','EMA','CAWELON'].filter(a=>!omitAgent||a!==agent).map((a,i)=>{const row=usdcBudget(a);row.fees.gasLimit=String(200000+i*10000);return row;});
  const budgetFile=shared?encodeSharedOperationBudget({schema:SHARED_BUDGET_SCHEMA,simulationOnly:true,sameAccount:true,budgets}):encodeOperationBudget(b);
  const evidenceText=encodeBudgetEvidence({schema:BUDGET_EVIDENCE_SCHEMA,budgetFile,observationFiles:[(await preparePublicUsdcFile(o)).text]});
  for(const row of [p.proposal,p.policy]){row.chainId=8453;row.tokenAddress=BASE_NATIVE_USDC;}
  Object.assign(p.proposal,{spendUnits:'1000000',budgetEvidenceSha256:proposalHash(evidenceText),dapp:{origin:'https://aerodrome.finance',contract:AERODROME_BASE.router}});p.policy.maxTokenSpendUnits='1000000';p.policy.allowedDapps=[p.proposal.dapp];
  const review=await prepareOperationProposalReview({proposalFile:encodeOperationProposal(p.proposal),policyFile:encodeProposalReviewPolicy(p.policy),budgetEvidenceFile:evidenceText},{nowSeconds});
  f.files={proposalReviewFile:review.text,quoteFile:(await prepareAerodromeQuoteFile(quoteFixture({agent,direction:'buy',nowSeconds}))).text};f.options.maxOutputShortfallBps=200;
 }
 const review=await prepareProposalQuoteReview(f.files,f.options),request=allowanceRequestFromReview(review.result),q=review.result.quote.quote;
 const source=review.result.proposalReview.evidence.comparisons[0].observation;
 const observation={...request,schema:PROPOSAL_ALLOWANCE_SCHEMA,chainId:8453,rpcUrl:AERODROME_BASE.rpcUrl,tokenAddress:q.inputToken,spenderAddress:AERODROME_BASE.router,blockTimestampSeconds:q.blockTimestampSeconds,observedAtSeconds:nowSeconds,tokenHasCode:true,spenderHasCode:true,tokenBalanceBaseUnits:source.balanceBaseUnits,allowanceBaseUnits:q.inputBaseUnits,nativeBalanceBaseUnits:source.nativeBalanceBaseUnits,canonicalBlockRechecked:true,readOnly:true,walletConnected:false};
 return {request,observation,files:{quoteReviewFile:review.text,observation},options:{nowSeconds,maxAllowanceAgeSeconds:60}};
}
export function allowanceRpc(observation,modify=()=>{}) {
 const calls=[];let headers=0,chains=0;
 return {calls,fetchImpl:async(url,options)=>{
  const request=JSON.parse(options.body);calls.push(request);const {method,params}=request;let result;
  if(method==='eth_chainId'){chains++;result='0x2105';}
  else if(method==='eth_getBlockByNumber'){headers++;result={number:params[0],hash:observation.blockHash,timestamp:'0x'+BigInt(observation.blockTimestampSeconds).toString(16)};}
  else if(method==='eth_getCode')result=(params[0]===observation.tokenAddress?observation.tokenHasCode:observation.spenderHasCode)?'0x6000':'0x';
  else if(method==='eth_getBalance')result='0x'+BigInt(observation.nativeBalanceBaseUnits).toString(16);
  else if(method==='eth_call'){const sel=params[0].data.slice(0,10);if(!['0x70a08231','0xdd62ed3e'].includes(sel))throw Error('SELECTOR');result='0x'+word(sel==='0x70a08231'?observation.tokenBalanceBaseUnits:observation.allowanceBaseUnits);}
  else throw Error('METHOD');
  const c={request,result,headers,chains,url,options};modify(c);return Response.json({jsonrpc:'2.0',id:request.id,result:c.result});
 }};
}
