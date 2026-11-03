import { captureDataRecord,captureOptionalDataFields,sha256Hex } from './security-data.js';
import { boundedUtf8Length,parseSecurityJson } from './security-json.js';
import { PROPOSAL_ALLOWANCE_FILE_LIMIT,inspectProposalAllowanceReviewFile,prepareProposalAllowanceReview } from './proposal-allowance.js';
import { quoteTime } from './aerodrome-quote-model.js';
export const SIMULATION_PLAN_FILE_SCHEMA='threecore.proposal-simulation-plan-file.v1';
export const SIMULATION_PLAN_FILE_LIMIT=12582912;
export const CLASSIC_SWAP_SELECTOR='0xcac88ea9';
export class SimulationPlanError extends Error { constructor(code){super(code);this.name='SimulationPlanError';this.code=code;} }
const fail=code=>{throw new SimulationPlanError(code);};
function bound(text,limit){try{boundedUtf8Length(text,limit);}catch{fail('SIMULATION_FILE_SIZE');}return text;}
function settings(options){try{return captureOptionalDataFields(options,['nowSeconds','subtle','signal','timeoutMs']);}catch{fail('SIMULATION_OPTIONS');}}
const word=value=>BigInt(value).toString(16).padStart(64,'0');
const addressWord=value=>value.slice(2).padStart(64,'0');
/** Encode only the validated fixed single-route call. No external recipient or data overrides. */
function encodeSwap(q,minimum,recipient,deadline){
 // Five head words, then one static four-word Route in the dynamic array.
 return CLASSIC_SWAP_SELECTOR+word(q.inputBaseUnits)+word(minimum)+word(160)+addressWord(recipient)+word(deadline)+word(1)+addressWord(q.inputToken)+addressWord(q.outputToken)+word(0)+addressWord(q.factoryAddress);
}
/** Derive immutable input for later read-only simulation; never obtain a nonce, sign or dispatch. */
export async function prepareProposalSimulationPlan(allowanceReviewFile,options={}){
 bound(allowanceReviewFile,PROPOSAL_ALLOWANCE_FILE_LIMIT);const s=settings(options),now=quoteTime(s.nowSeconds??Math.floor(Date.now()/1000));
 const stored=await inspectProposalAllowanceReviewFile(allowanceReviewFile,s);
 const current=await prepareProposalAllowanceReview(stored.files,{...s,nowSeconds:now,maxAllowanceAgeSeconds:stored.recordedResult.maxAllowanceAgeSeconds});
 const r=current.result,review=r.quoteReview,p=review.proposalReview.proposal,policy=review.proposalReview.policy,q=review.quote.quote;
 const reasons=[];if(!r.checksSatisfied)reasons.push('PRECONDITIONS_UNSATISFIED');
 const deadline=Math.min(p.expiresAtSeconds,policy.expiresAtSeconds,q.observedAtSeconds+review.limits.maxQuoteAgeSeconds,q.blockTimestampSeconds+review.limits.maxBlockAgeSeconds,r.observation.observedAtSeconds+r.maxAllowanceAgeSeconds);
 if(now>=deadline)reasons.push('SIMULATION_WINDOW_CLOSED');
 const sourceSha256=await sha256Hex(new TextEncoder().encode(allowanceReviewFile),s.subtle,s);
 const budgetResult=review.proposalReview.evidence.budgetResult;
 const budget=budgetResult.input.budgets?budgetResult.input.budgets.find(b=>b.agent===p.agent):budgetResult.input;
 if(!budget)reasons.push('SIMULATION_BUDGET_MISSING');
 const limits=budget?Object.freeze({gasLimit:budget.fees.gasLimit,maxFeePerGasWei:budget.fees.maxFeePerGasWei,l1FeeBudgetWei:budget.fees.l1FeeBudgetWei,operatorFeeBudgetWei:budget.fees.operatorFeeBudgetWei,bufferWei:budget.fees.bufferWei,policyMaxTotalFeeWei:policy.maxTotalFeeWei}):null;
 const eligible=reasons.length===0;
 const call=eligible?Object.freeze({chainId:p.chainId,from:p.account,to:p.dapp.contract,value:'0',data:encodeSwap(q,review.quote.minimumOutputBaseUnits,p.account,deadline),blockNumber:q.blockNumber,blockHash:q.blockHash}):null;
 const plan=Object.freeze({schema:'threecore.proposal-simulation-plan.v1',simulationOnly:true,sourceSha256,evaluatedAtSeconds:now,deadlineSeconds:deadline,agent:p.agent,proposalId:p.proposalId,amountInBaseUnits:q.inputBaseUnits,minimumOutputBaseUnits:review.quote.minimumOutputBaseUnits,recipient:p.account,route:Object.freeze({from:q.inputToken,to:q.outputToken,stable:false,factory:q.factoryAddress}),limits,call,eligibleForSimulation:eligible,reasons:Object.freeze(reasons),gasEstimated:false,simulationExecuted:false,signed:false,transactionBroadcast:false,authorizesExecution:false});
 const text=bound(JSON.stringify({schema:SIMULATION_PLAN_FILE_SCHEMA,reviewOnly:true,allowanceReviewFile,evaluatedAtSeconds:now,plan},null,2)+'\n',SIMULATION_PLAN_FILE_LIMIT);
 return Object.freeze({text,plan,allowanceReview:r});
}
export async function inspectProposalSimulationPlanFile(text,options={}){
 bound(text,SIMULATION_PLAN_FILE_LIMIT);let raw,data;
 try{raw=parseSecurityJson(text);data=captureDataRecord(raw,['schema','reviewOnly','allowanceReviewFile','evaluatedAtSeconds','plan']);}catch{fail('SIMULATION_FILE_FORMAT');}
 if(data.schema!==SIMULATION_PLAN_FILE_SCHEMA||data.reviewOnly!==true)fail('SIMULATION_FILE_FORMAT');quoteTime(data.evaluatedAtSeconds);
 const checked=await prepareProposalSimulationPlan(data.allowanceReviewFile,{...settings(options),nowSeconds:data.evaluatedAtSeconds});
 // Compare semantic JSON records with a stable field order, accepting harmless key reordering.
 const equal=(a,b)=>{if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return a===b;if(Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));};
 if(!equal(data.plan,checked.plan))fail('SIMULATION_RECORDED_PLAN');
 return Object.freeze({allowanceReviewFile:data.allowanceReviewFile,recordedPlan:checked.plan,historicalOnly:true,timestampAuthenticated:false,authorizesExecution:false});
}
