import { captureDataRecord, captureDataArray, captureOptionalDataFields } from './security-data.js';
import { boundedUtf8Length, parseSecurityJson } from './security-json.js';
import { PROPOSAL_REVIEW_FILE_LIMIT } from './operation-proposal-file.js';
import { AERODROME_QUOTE_FILE_LIMIT, inspectProposalQuote, quoteTime, failAerodromeQuote as fail } from './aerodrome-quote-model.js';

export const PROPOSAL_QUOTE_FILE_SCHEMA='threecore.proposal-quote-review-file.v1';
export const PROPOSAL_QUOTE_FILE_LIMIT=6291456;
function bound(text,limit){try{boundedUtf8Length(text,limit);}catch{fail('QUOTE_REVIEW_FILE_SIZE');}return text;}
function record(value,keys){try{return captureDataRecord(value,keys);}catch{fail('QUOTE_REVIEW_FORMAT');}}
function sources(value){const files=record(value,['proposalReviewFile','quoteFile']);return Object.freeze({
  proposalReviewFile:bound(files.proposalReviewFile,PROPOSAL_REVIEW_FILE_LIMIT),quoteFile:bound(files.quoteFile,AERODROME_QUOTE_FILE_LIMIT)});}
const summary=r=>({checksSatisfied:r.checksSatisfied,reasons:r.reasons,authorizesExecution:false});

/** Preserve original files and user-selected limits. This is a record, not an execution permission. */
export async function prepareProposalQuoteReview(input,options={}){
  const files=sources(input),result=await inspectProposalQuote(files.proposalReviewFile,files.quoteFile,options);
  const text=bound(JSON.stringify({schema:PROPOSAL_QUOTE_FILE_SCHEMA,reviewOnly:true,...files,
    evaluatedAtSeconds:result.evaluatedAtSeconds,limits:result.limits,result:summary(result)},null,2)+'\n',PROPOSAL_QUOTE_FILE_LIMIT);
  return Object.freeze({text,files,result});
}

/** Replay the recorded comparison; no claim about current state or authenticated timestamps. */
export async function inspectProposalQuoteReviewFile(text,options={}){
  bound(text,PROPOSAL_QUOTE_FILE_LIMIT);let parsed;try{parsed=parseSecurityJson(text);}catch{fail('QUOTE_REVIEW_JSON');}
  const data=record(parsed,['schema','reviewOnly','proposalReviewFile','quoteFile','evaluatedAtSeconds','limits','result']);
  if(data.schema!==PROPOSAL_QUOTE_FILE_SCHEMA||data.reviewOnly!==true)fail('QUOTE_REVIEW_FORMAT');
  quoteTime(data.evaluatedAtSeconds);
  const files=sources({proposalReviewFile:data.proposalReviewFile,quoteFile:data.quoteFile});
  const limits=record(data.limits,['maxQuoteAgeSeconds','maxBlockAgeSeconds','maxOutputShortfallBps','maxSlippageBps']);
  const result=record(data.result,['checksSatisfied','reasons','authorizesExecution']);
  if(typeof result.checksSatisfied!=='boolean'||result.authorizesExecution!==false)fail('QUOTE_REVIEW_FORMAT');
  let reasons,settings;try{reasons=captureDataArray(result.reasons,16);settings=captureOptionalDataFields(options,['subtle','signal','timeoutMs']);}catch{fail('QUOTE_REVIEW_FORMAT');}
  if(reasons.some(code=>typeof code!=='string'||!/^[A-Z_]{1,64}$/.test(code)))fail('QUOTE_REVIEW_FORMAT');
  const checked=await prepareProposalQuoteReview(files,{...settings,...limits,nowSeconds:data.evaluatedAtSeconds});
  if(result.checksSatisfied!==checked.result.checksSatisfied||JSON.stringify(reasons)!==JSON.stringify(checked.result.reasons))fail('QUOTE_RECORDED_RESULT_MISMATCH');
  return Object.freeze({files,limits:checked.result.limits,recordedResult:checked.result,historicalOnly:true,timestampAuthenticated:false,authorizesExecution:false});
}
