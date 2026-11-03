import { captureDataRecord, captureOptionalDataFields, sha256Hex } from './security-data.js';
import { boundedUtf8Length, parseSecurityJson } from './security-json.js';
import { identityAddress } from './token-identity-codec.js';
import { AERODROME_BASE, THREECORE_BASE_TOKENS } from './aerodrome-readonly.js';
import { BASE_NATIVE_USDC } from './aerodrome-pools.js';
import { quoteUnits, quoteTime } from './aerodrome-quote-model.js';
import { PROPOSAL_QUOTE_FILE_LIMIT, inspectProposalQuoteReviewFile, prepareProposalQuoteReview } from './proposal-quote-file.js';

export const PROPOSAL_ALLOWANCE_SCHEMA = 'threecore.proposal-allowance-observation.v1';
export const PROPOSAL_ALLOWANCE_FILE_SCHEMA = 'threecore.proposal-allowance-review-file.v1';
export const PROPOSAL_ALLOWANCE_FILE_LIMIT = 8388608;
export class ProposalAllowanceError extends Error { constructor(code) { super(code); this.code=code; this.name='ProposalAllowanceError'; } }
export const failAllowance = code => { throw new ProposalAllowanceError(code); };
const fail=failAllowance;
function record(input,keys) { try { return captureDataRecord(input,keys); } catch { fail('ALLOWANCE_STRUCTURE'); } }
function bounded(text,limit) { try { boundedUtf8Length(text,limit); } catch { fail('ALLOWANCE_FILE_SIZE'); } return text; }
function hash(value) { if(typeof value!=='string'||!/^0x[0-9a-f]{64}$/.test(value))fail('ALLOWANCE_BLOCK'); return value; }
function age(value) { if(!Number.isInteger(value)||value<1||value>3600)fail('ALLOWANCE_AGE_LIMIT'); return value; }
const REQUEST_FIELDS=['agent','direction','account','blockNumber','blockHash'];
export function validateProposalAllowanceRequest(input) {
 const r=record(input,REQUEST_FIELDS);
 if(typeof r.agent!=='string'||!Object.hasOwn(THREECORE_BASE_TOKENS,r.agent)||!['buy','sell'].includes(r.direction))fail('ALLOWANCE_CONTEXT');
 return Object.freeze({...r,account:identityAddress(r.account),blockNumber:quoteUnits(r.blockNumber),blockHash:hash(r.blockHash)});
}
export function allowanceRequestFromReview(result) {
 const p=result.proposalReview.proposal,q=result.quote.quote;
 if(p.agent!==q.agent||p.chainId!==q.chainId||p.tokenAddress!==q.inputToken||p.dapp.contract!==q.routerAddress||p.dapp.origin!==q.dappOrigin)fail('ALLOWANCE_CONTEXT');
 return validateProposalAllowanceRequest({agent:q.agent,direction:q.direction,account:p.account,blockNumber:q.blockNumber,blockHash:q.blockHash});
}
export function validateProposalAllowance(input) {
 const o=record(input,[...REQUEST_FIELDS,'schema','chainId','rpcUrl','tokenAddress','spenderAddress','blockTimestampSeconds','observedAtSeconds','tokenHasCode','spenderHasCode','tokenBalanceBaseUnits','allowanceBaseUnits','nativeBalanceBaseUnits','canonicalBlockRechecked','readOnly','walletConnected']);
 const r=validateProposalAllowanceRequest(Object.fromEntries(REQUEST_FIELDS.map(key=>[key,o[key]])));
 if(o.account!==r.account||o.schema!==PROPOSAL_ALLOWANCE_SCHEMA||o.chainId!==8453||o.rpcUrl!==AERODROME_BASE.rpcUrl||o.spenderAddress!==AERODROME_BASE.router||o.tokenAddress!==(o.direction==='buy'?BASE_NATIVE_USDC:THREECORE_BASE_TOKENS[o.agent])||o.canonicalBlockRechecked!==true||o.readOnly!==true||o.walletConnected!==false)fail('ALLOWANCE_CONTEXT');
 quoteTime(o.blockTimestampSeconds);quoteTime(o.observedAtSeconds);
 if(typeof o.tokenHasCode!=='boolean'||typeof o.spenderHasCode!=='boolean')fail('ALLOWANCE_CODE');
 for(const key of ['tokenBalanceBaseUnits','allowanceBaseUnits']) {
  if(o.tokenHasCode)quoteUnits(o[key]);else if(o[key]!==null)fail('ALLOWANCE_UNKNOWN_AMOUNT');
 }
 quoteUnits(o.nativeBalanceBaseUnits);
 return Object.freeze({...o});
}
function settings(input,withTime=false) {
 try { return captureOptionalDataFields(input,[...(withTime?['nowSeconds','maxAllowanceAgeSeconds']:[]),'subtle','signal','timeoutMs']); } catch { fail('ALLOWANCE_OPTIONS'); }
}
/** Review existing allowance only; this never grants authority or constructs a transaction. */
export async function inspectProposalAllowance(quoteReviewFile,observation,options={}) {
 const s=settings(options,true),now=quoteTime(s.nowSeconds??Math.floor(Date.now()/1000)),maxAge=age(s.maxAllowanceAgeSeconds);
 const o=validateProposalAllowance(observation),stored=await inspectProposalQuoteReviewFile(quoteReviewFile,settings(optionsFiltered(s)));
 const checked=await prepareProposalQuoteReview(stored.files,{...settings(optionsFiltered(s)),...stored.limits,nowSeconds:now});
 const review=checked.result,p=review.proposalReview.proposal,q=review.quote.quote,reasons=[];
 if(!review.checksSatisfied)reasons.push('QUOTE_CONDITIONS_UNSATISFIED');
 if(o.agent!==p.agent||o.chainId!==p.chainId||o.account!==p.account||o.tokenAddress!==p.tokenAddress||o.spenderAddress!==p.dapp.contract||o.direction!==q.direction)reasons.push('ALLOWANCE_PROPOSAL_MISMATCH');
 if(o.blockNumber!==q.blockNumber||o.blockHash!==q.blockHash||o.blockTimestampSeconds!==q.blockTimestampSeconds)reasons.push('ALLOWANCE_BLOCK_MISMATCH');
 if(o.observedAtSeconds>now||o.blockTimestampSeconds>o.observedAtSeconds)reasons.push('ALLOWANCE_FUTURE_TIME');
 if(now-o.observedAtSeconds>maxAge)reasons.push('ALLOWANCE_STALE');
 if(!o.tokenHasCode)reasons.push('ALLOWANCE_TOKEN_CODE_MISSING');
 if(!o.spenderHasCode)reasons.push('ALLOWANCE_SPENDER_CODE_MISSING');
 const required=BigInt(p.spendUnits);
 const shortfall=o.allowanceBaseUnits===null?null:(required>BigInt(o.allowanceBaseUnits)?required-BigInt(o.allowanceBaseUnits):0n).toString();
 if(shortfall===null)reasons.push('ALLOWANCE_UNKNOWN');else if(shortfall!=='0')reasons.push('ALLOWANCE_SHORTFALL');
 if(o.tokenBalanceBaseUnits===null||BigInt(o.tokenBalanceBaseUnits)<required)reasons.push('ALLOWANCE_BALANCE_SHORTFALL');
 const source=review.proposalReview.evidence.comparisons.find(item=>item.agent===p.agent)?.observation;
 if(!source||source.balanceBaseUnits!==o.tokenBalanceBaseUnits||source.nativeBalanceBaseUnits!==o.nativeBalanceBaseUnits)reasons.push('ALLOWANCE_BUDGET_STATE_MISMATCH');
 return Object.freeze({evaluatedAtSeconds:now,maxAllowanceAgeSeconds:maxAge,quoteReview:review,observation:o,requiredBaseUnits:p.spendUnits,allowanceShortfallBaseUnits:shortfall,reasons:Object.freeze(reasons),checksSatisfied:reasons.length===0,historicalOnly:true,currentStateVerified:false,sourceAuthorAuthenticated:false,gasEstimated:false,simulationExecuted:false,authorizesExecution:false});
}
function optionsFiltered(s) { return Object.fromEntries(['subtle','signal','timeoutMs'].filter(key=>Object.hasOwn(s,key)).map(key=>[key,s[key]])); }
const summary=r=>({checksSatisfied:r.checksSatisfied,reasons:r.reasons,allowanceShortfallBaseUnits:r.allowanceShortfallBaseUnits,authorizesExecution:false});
export async function prepareProposalAllowanceReview(input,options={}) {
 const raw=record(input,['quoteReviewFile','observation']),quoteReviewFile=bounded(raw.quoteReviewFile,PROPOSAL_QUOTE_FILE_LIMIT),observation=validateProposalAllowance(raw.observation);
 const s=settings(options,true),digest=await sha256Hex(new TextEncoder().encode(JSON.stringify(observation)),s.subtle,s);
 const result=await inspectProposalAllowance(quoteReviewFile,observation,s);
 const text=bounded(JSON.stringify({schema:PROPOSAL_ALLOWANCE_FILE_SCHEMA,reviewOnly:true,quoteReviewFile,observation,observationSha256:digest,evaluatedAtSeconds:result.evaluatedAtSeconds,maxAllowanceAgeSeconds:result.maxAllowanceAgeSeconds,result:summary(result)},null,2)+'\n',PROPOSAL_ALLOWANCE_FILE_LIMIT);
 return Object.freeze({text,files:Object.freeze({quoteReviewFile,observation}),result});
}
export async function inspectProposalAllowanceReviewFile(text,options={}) {
 bounded(text,PROPOSAL_ALLOWANCE_FILE_LIMIT);let raw;try { raw=parseSecurityJson(text); } catch { fail('ALLOWANCE_JSON'); }
 const d=record(raw,['schema','reviewOnly','quoteReviewFile','observation','observationSha256','evaluatedAtSeconds','maxAllowanceAgeSeconds','result']);
 if(d.schema!==PROPOSAL_ALLOWANCE_FILE_SCHEMA||d.reviewOnly!==true||typeof d.observationSha256!=='string'||!/^[0-9a-f]{64}$/.test(d.observationSha256))fail('ALLOWANCE_FORMAT');
 quoteTime(d.evaluatedAtSeconds);age(d.maxAllowanceAgeSeconds);
 const checked=await prepareProposalAllowanceReview({quoteReviewFile:d.quoteReviewFile,observation:d.observation},{...settings(options),nowSeconds:d.evaluatedAtSeconds,maxAllowanceAgeSeconds:d.maxAllowanceAgeSeconds});
 const output=JSON.parse(checked.text);
 if(output.observationSha256!==d.observationSha256)fail('ALLOWANCE_CHECKSUM');
 const r=record(d.result,['checksSatisfied','reasons','allowanceShortfallBaseUnits','authorizesExecution']);
 if(JSON.stringify(r)!==JSON.stringify(output.result))fail('ALLOWANCE_RECORDED_RESULT');
 return Object.freeze({files:checked.files,recordedResult:checked.result,historicalOnly:true,timestampAuthenticated:false,authorizesExecution:false});
}
