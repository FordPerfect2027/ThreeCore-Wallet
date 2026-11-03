import { captureDataRecord, captureOptionalDataFields, sha256Hex } from "./security-data.js";
import { boundedUtf8Length, parseSecurityJson } from "./security-json.js";
import { AERODROME_BASE, THREECORE_BASE_TOKENS } from "./aerodrome-readonly.js";
import { BASE_NATIVE_USDC } from "./aerodrome-pools.js";
import { inspectOperationProposalReviewFile, prepareOperationProposalReview } from "./operation-proposal-file.js";

export const AERODROME_QUOTE_SCHEMA="threecore.aerodrome-classic-quote.v1";
export const AERODROME_QUOTE_FILE_SCHEMA="threecore.aerodrome-classic-quote-file.v1";
export const AERODROME_QUOTE_FILE_LIMIT=16384;
export class AerodromeQuoteError extends Error { constructor(code){super(code);this.name="AerodromeQuoteError";this.code=code;} }
export const failAerodromeQuote=code=>{throw new AerodromeQuoteError(code);};
const fail=failAerodromeQuote,MAX=(1n<<256n)-1n;
function record(value,keys){try{return captureDataRecord(value,keys);}catch{fail("QUOTE_STRUCTURE");}}
export function quoteUnits(value){if(typeof value!=="string"||!/^(0|[1-9][0-9]{0,77})$/.test(value)||BigInt(value)>MAX)fail("QUOTE_AMOUNT");return value;}
export function quoteTime(value){if(!Number.isSafeInteger(value)||value<0||value>253402300799)fail("QUOTE_TIME");return value;}
function address(value){if(typeof value!=="string"||!/^0x[0-9a-f]{40}$/.test(value)||/^0x0{40}$/.test(value))fail("QUOTE_ADDRESS");return value;}
function bps(value,max=10000){if(!Number.isInteger(value)||value<0||value>max)fail("QUOTE_BPS");return value;}
function bounded(value){try{boundedUtf8Length(value,AERODROME_QUOTE_FILE_LIMIT);}catch{fail("QUOTE_FILE_SIZE");}return value;}

export function validateAerodromeQuote(input){
  const q=record(input,["schema","agent","chainId","dappOrigin","routerAddress","factoryAddress","poolAddress","direction","inputToken","outputToken","inputDecimals","outputDecimals","inputBaseUnits","reserveInBaseUnits","reserveOutBaseUnits","feeBps","poolOutputBaseUnits","routerOutputBaseUnits","slippageBps","blockNumber","blockHash","blockTimestampSeconds","observedAtSeconds","canonicalBlockRechecked","readOnly"]);
  if(q.schema!==AERODROME_QUOTE_SCHEMA||typeof q.agent!=="string"||!Object.hasOwn(THREECORE_BASE_TOKENS,q.agent)||q.chainId!==8453||q.dappOrigin!=="https://aerodrome.finance"||q.routerAddress!==AERODROME_BASE.router||q.factoryAddress!==AERODROME_BASE.poolFactory||q.readOnly!==true||q.canonicalBlockRechecked!==true)fail("QUOTE_CONTEXT");
  if(!["buy","sell"].includes(q.direction))fail("QUOTE_DIRECTION");
  const buy=q.direction==="buy",token=THREECORE_BASE_TOKENS[q.agent];
  if(q.inputToken!==(buy?BASE_NATIVE_USDC:token)||q.outputToken!==(buy?token:BASE_NATIVE_USDC)||q.inputDecimals!==(buy?6:18)||q.outputDecimals!==(buy?18:6))fail("QUOTE_PAIR");
  address(q.poolAddress);for(const key of ["inputBaseUnits","reserveInBaseUnits","reserveOutBaseUnits","poolOutputBaseUnits","routerOutputBaseUnits","blockNumber"])quoteUnits(q[key]);
  if(typeof q.blockHash!=="string"||!/^0x[0-9a-f]{64}$/.test(q.blockHash))fail("QUOTE_BLOCK");
  quoteTime(q.blockTimestampSeconds);quoteTime(q.observedAtSeconds);bps(q.feeBps,300);bps(q.slippageBps,9999);
  const amount=BigInt(q.inputBaseUnits),rin=BigInt(q.reserveInBaseUnits),rout=BigInt(q.reserveOutBaseUnits),fee=BigInt(q.feeBps);
  if(amount===0n||rin===0n||rout===0n)fail("QUOTE_EMPTY");
  // Match the on-chain uint256 fee subtraction and constant-product rounding.
  if(amount*fee>MAX)fail("QUOTE_ARITHMETIC_OVERFLOW");
  const net=amount-amount*fee/10000n;
  if(net*rout>MAX||rin+net>MAX)fail("QUOTE_ARITHMETIC_OVERFLOW");
  const expected=net*rout/(rin+net);
  if(expected===0n||expected>=rout)fail("QUOTE_ZERO_OR_INVALID_OUTPUT");
  if(BigInt(q.poolOutputBaseUnits)!==expected||BigInt(q.routerOutputBaseUnits)!==expected)fail("QUOTE_OUTPUT_MISMATCH");
  return Object.freeze({...q});
}
export function calculateAerodromeQuote(input){
  const q=validateAerodromeQuote(input),amount=BigInt(q.inputBaseUnits),rin=BigInt(q.reserveInBaseUnits),rout=BigInt(q.reserveOutBaseUnits),out=BigInt(q.poolOutputBaseUnits);
  const denominator=amount*rout,loss=denominator-out*rin;
  return Object.freeze({quote:q,minimumOutputBaseUnits:(out*BigInt(10000-q.slippageBps)/10000n).toString(),
    inputFeeBaseUnits:(amount*BigInt(q.feeBps)/10000n).toString(),outputShortfallBpsCeil:Number((loss*10000n+denominator-1n)/denominator),
    shortfallIncludesFeesAndRounding:true,historicalOnly:true,authorizesExecution:false});
}
export async function prepareAerodromeQuoteFile(input,options={}){
  const quote=validateAerodromeQuote(input);let settings;try{settings=captureOptionalDataFields(options,["subtle","signal","timeoutMs"]);}catch{fail("QUOTE_OPTIONS");}
  const checksum=await sha256Hex(new TextEncoder().encode(JSON.stringify(quote)),settings.subtle,settings);
  return Object.freeze({text:bounded(JSON.stringify({schema:AERODROME_QUOTE_FILE_SCHEMA,quote,sha256:checksum},null,2)+"\n"),quote,sha256:checksum});
}
export async function inspectAerodromeQuoteFile(text,options={}){
  bounded(text);let raw;try{raw=parseSecurityJson(text);}catch{fail("QUOTE_JSON");}
  const data=record(raw,["schema","quote","sha256"]);
  if(data.schema!==AERODROME_QUOTE_FILE_SCHEMA||typeof data.sha256!=="string"||!/^[0-9a-f]{64}$/.test(data.sha256))fail("QUOTE_FILE_FORMAT");
  const checked=await prepareAerodromeQuoteFile(data.quote,options);if(checked.sha256!==data.sha256)fail("QUOTE_CHECKSUM");
  return calculateAerodromeQuote(checked.quote);
}

/** Compare current proposal conditions and a source-linked quote; never build or send a transaction. */
export async function inspectProposalQuote(reviewFile,quoteFile,options={}){
  let s;try{s=captureOptionalDataFields(options,["nowSeconds","maxQuoteAgeSeconds","maxBlockAgeSeconds","maxOutputShortfallBps","maxSlippageBps","signal","subtle","timeoutMs"]);}catch{fail("QUOTE_OPTIONS");}
  const now=quoteTime(s.nowSeconds??Math.floor(Date.now()/1000));
  for(const key of ["maxQuoteAgeSeconds","maxBlockAgeSeconds"])if(!Number.isInteger(s[key])||s[key]<1||s[key]>3600)fail("QUOTE_AGE_LIMIT");
  bps(s.maxOutputShortfallBps,10000);bps(s.maxSlippageBps,9999);
  const stored=await inspectOperationProposalReviewFile(reviewFile,s),current=await prepareOperationProposalReview(stored.files,{...s,nowSeconds:now});
  const quote=await inspectAerodromeQuoteFile(quoteFile,s),q=quote.quote,p=current.result.proposal,reasons=[];
  if(!current.result.checksSatisfied)reasons.push("PROPOSAL_CONDITIONS_UNSATISFIED");
  if(p.agent!==q.agent||p.chainId!==q.chainId||p.tokenAddress!==q.inputToken||p.spendUnits!==q.inputBaseUnits||p.nativeValueWei!=="0"||p.dapp.origin!==q.dappOrigin||p.dapp.contract!==q.routerAddress)reasons.push("QUOTE_PROPOSAL_MISMATCH");
  const o=current.result.evidence.comparisons.find(item=>item.agent===p.agent)?.observation;
  if(!o||o.blockNumber!==q.blockNumber||o.blockHash!==q.blockHash)reasons.push("QUOTE_BUDGET_BLOCK_MISMATCH");
  if(q.observedAtSeconds>now||q.blockTimestampSeconds>q.observedAtSeconds)reasons.push("QUOTE_FUTURE_TIME");
  if(now-q.observedAtSeconds>s.maxQuoteAgeSeconds)reasons.push("QUOTE_STALE");
  if(now-q.blockTimestampSeconds>s.maxBlockAgeSeconds)reasons.push("QUOTE_BLOCK_STALE");
  if(quote.outputShortfallBpsCeil>s.maxOutputShortfallBps)reasons.push("QUOTE_OUTPUT_SHORTFALL_LIMIT");
  if(q.slippageBps>s.maxSlippageBps)reasons.push("QUOTE_SLIPPAGE_LIMIT");
  if(quote.minimumOutputBaseUnits==="0")reasons.push("QUOTE_MINIMUM_OUTPUT_ZERO");
  return Object.freeze({schema:"threecore.proposal-quote-review.v1",evaluatedAtSeconds:now,limits:Object.freeze({maxQuoteAgeSeconds:s.maxQuoteAgeSeconds,maxBlockAgeSeconds:s.maxBlockAgeSeconds,maxOutputShortfallBps:s.maxOutputShortfallBps,maxSlippageBps:s.maxSlippageBps}),proposalReview:current.result,quote,
    reasons:Object.freeze(reasons),checksSatisfied:reasons.length===0,historicalOnly:true,currentStateVerified:false,
    sourceAuthorAuthenticated:false,gasEstimated:false,allowanceVerified:false,simulationExecuted:false,authorizesExecution:false});
}
