import { captureOptionalDataFields } from "./security-data.js";
import { subscribeReadAbort } from "./security-abort.js";
import { createPublicBaseRpcReader } from "./public-base-rpc.js";
import { AERODROME_BASE,THREECORE_BASE_TOKENS } from "./aerodrome-readonly.js";
import { BASE_NATIVE_USDC } from "./aerodrome-pools.js";
import { AERODROME_QUOTE_SCHEMA,quoteUnits,quoteTime,validateAerodromeQuote,failAerodromeQuote as fail } from "./aerodrome-quote-model.js";

export const CLASSIC_QUOTE_SELECTORS=Object.freeze({getPool:"0x79bc57d5",token0:"0x0dfe1681",token1:"0xd21220a7",reserves:"0x0902f1ac",stable:"0x22be3de1",factory:"0xc45a0155",isPaused:"0xb187bd26",defaultFactory:"0xd4b6846d",decimals:"0x313ce567",getFee:"0xcc56b2c5",poolQuote:"0xf140a35a",routerQuote:"0x5509a1ac"});
const S=CLASSIC_QUOTE_SELECTORS,word=n=>BigInt(n).toString(16).padStart(64,"0"),addrWord=a=>a.slice(2).padStart(64,"0");
function words(value,count){if(typeof value!=="string"||!new RegExp('^0x[0-9a-fA-F]{'+(64*count)+'}$').test(value))fail("QUOTE_ABI");return Array.from({length:count},(_,i)=>BigInt('0x'+value.slice(2+i*64,66+i*64)));}
function address(value){if(typeof value!=="string"||!/^0x0{24}[0-9a-fA-F]{40}$/.test(value))fail("QUOTE_ABI_ADDRESS");return '0x'+value.slice(-40).toLowerCase();}
export function encodeClassicRouterQuote(amount,inputToken,outputToken){
  quoteUnits(amount);for(const address of [inputToken,outputToken])if(typeof address!=="string"||!/^0x[0-9a-f]{40}$/.test(address))fail("QUOTE_ADDRESS");
  return S.routerQuote+word(amount)+word(64)+word(1)+addrWord(inputToken)+addrWord(outputToken)+word(0)+addrWord(AERODROME_BASE.poolFactory);
}
export async function readAerodromeQuote(input={}){
  let s;try{s=captureOptionalDataFields(input,["agent","direction","inputBaseUnits","slippageBps","blockNumber","fetchImpl","signal","timeoutMs","requestTimeoutMs"]);}catch{fail("QUOTE_OPTIONS");}
  if(typeof s.agent!=="string"||!Object.hasOwn(THREECORE_BASE_TOKENS,s.agent))fail("QUOTE_AGENT");
  if(!["buy","sell"].includes(s.direction))fail("QUOTE_DIRECTION");quoteUnits(s.inputBaseUnits);if(s.inputBaseUnits==="0")fail("QUOTE_AMOUNT");
  if(!Number.isInteger(s.slippageBps)||s.slippageBps<0||s.slippageBps>9999)fail("QUOTE_BPS");
  if(s.blockNumber!==undefined)quoteUnits(s.blockNumber);
  const timeout=s.timeoutMs??120000;if(!Number.isInteger(timeout)||timeout<100||timeout>120000)fail("QUOTE_TIMEOUT_OPTION");
  const controller=new AbortController();let cancellation,timer,timedOut=false;
  const guard=()=>{if(controller.signal.aborted)fail(timedOut?"QUOTE_TIMEOUT":"QUOTE_CANCELLED");};
  try{
    try{cancellation=subscribeReadAbort(s.signal,()=>controller.abort());}catch{fail("QUOTE_SIGNAL");}guard();
    const rpc=createPublicBaseRpcReader({rpcUrl:AERODROME_BASE.rpcUrl,fetchImpl:s.fetchImpl??globalThis.fetch,timeoutMs:s.requestTimeoutMs??10000,signal:controller.signal,includeBlockTimestamp:true});
    timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
    const read=async(method,params=[])=>{guard();const result=await rpc(method,params);guard();return result;};
    if(BigInt(await read("eth_chainId"))!==8453n)fail("QUOTE_NETWORK");
    const height=s.blockNumber===undefined?await read("eth_blockNumber"):"0x"+BigInt(s.blockNumber).toString(16);
    const block=await read("eth_getBlockByNumber",[height,false]),selector={blockHash:block.hash,requireCanonical:true};
    const blockTimestampSeconds=quoteTime(Number(BigInt(block.timestamp)));
    const call=(to,data)=>read("eth_call",[{to,data},selector]);
    const token=THREECORE_BASE_TOKENS[s.agent],factory=AERODROME_BASE.poolFactory,router=AERODROME_BASE.router;
    for(const to of [factory,router,token,BASE_NATIVE_USDC])if(await read("eth_getCode",[to,selector])==="0x")fail("QUOTE_CONTRACT_MISSING");
    if(words(await call(factory,S.isPaused),1)[0]!==0n)fail("QUOTE_FACTORY_PAUSED");
    if(address(await call(router,S.defaultFactory))!==factory)fail("QUOTE_ROUTER_FACTORY");
    const pool=address(await call(factory,S.getPool+addrWord(token)+addrWord(BASE_NATIVE_USDC)+word(0)));
    if(/^0x0{40}$/.test(pool))fail("QUOTE_POOL_MISSING");
    if(await read("eth_getCode",[pool,selector])==="0x")fail("QUOTE_POOL_CODE_MISSING");
    if(address(await call(pool,S.factory))!==factory||words(await call(pool,S.stable),1)[0]!==0n)fail("QUOTE_POOL_FACTORY_OR_TYPE");
    const t0=address(await call(pool,S.token0)),t1=address(await call(pool,S.token1));
    if(t0===t1||![t0,t1].includes(token)||![t0,t1].includes(BASE_NATIVE_USDC))fail("QUOTE_PAIR");
    if(words(await call(token,S.decimals),1)[0]!==18n||words(await call(BASE_NATIVE_USDC,S.decimals),1)[0]!==6n)fail("QUOTE_DECIMALS");
    const [r0,r1]=words(await call(pool,S.reserves),3),buy=s.direction==="buy",tokenIn=buy?BASE_NATIVE_USDC:token,tokenOut=buy?token:BASE_NATIVE_USDC;
    const rin=t0===tokenIn?r0:r1,rout=t0===tokenIn?r1:r0;if(rin===0n||rout===0n)fail("QUOTE_EMPTY");
    const fee=words(await call(factory,S.getFee+addrWord(pool)+word(0)),1)[0];if(fee>300n)fail("QUOTE_FEE");
    const poolOut=words(await call(pool,S.poolQuote+word(s.inputBaseUnits)+addrWord(tokenIn)),1)[0];
    const routerOut=words(await call(router,encodeClassicRouterQuote(s.inputBaseUnits,tokenIn,tokenOut)),4);
    if(routerOut[0]!==32n||routerOut[1]!==2n||routerOut[2]!==BigInt(s.inputBaseUnits))fail("QUOTE_ROUTER_ABI");
    const final=await read("eth_getBlockByNumber",[block.number,false]);if(final.hash!==block.hash||final.timestamp!==block.timestamp)fail("QUOTE_BLOCK_CHANGED");
    if(BigInt(await read("eth_chainId"))!==8453n)fail("QUOTE_NETWORK_CHANGED");
    const result=validateAerodromeQuote({schema:AERODROME_QUOTE_SCHEMA,agent:s.agent,chainId:8453,dappOrigin:"https://aerodrome.finance",routerAddress:router,factoryAddress:factory,poolAddress:pool,direction:s.direction,inputToken:tokenIn,outputToken:tokenOut,inputDecimals:buy?6:18,outputDecimals:buy?18:6,inputBaseUnits:s.inputBaseUnits,reserveInBaseUnits:rin.toString(),reserveOutBaseUnits:rout.toString(),feeBps:Number(fee),poolOutputBaseUnits:poolOut.toString(),routerOutputBaseUnits:routerOut[3].toString(),slippageBps:s.slippageBps,blockNumber:BigInt(block.number).toString(),blockHash:block.hash,blockTimestampSeconds,observedAtSeconds:Math.floor(Date.now()/1000),canonicalBlockRechecked:true,readOnly:true});
    guard();return result;
  }catch(error){guard();throw error;}finally{clearTimeout(timer);cancellation?.dispose();controller.abort();}
}
