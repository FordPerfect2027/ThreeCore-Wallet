import { AERODROME_BASE,THREECORE_BASE_TOKENS } from '../../src/aerodrome-readonly.js';
import { BASE_NATIVE_USDC } from '../../src/aerodrome-pools.js';
import { AERODROME_QUOTE_SCHEMA } from '../../src/aerodrome-quote-model.js';
import { CLASSIC_QUOTE_SELECTORS as S } from '../../src/aerodrome-quote-reader.js';
export const QUOTE_POOL='0x'+'55'.repeat(20),QUOTE_HASH='0x'+'ab'.repeat(32);
export const word=n=>BigInt(n).toString(16).padStart(64,'0'),abiAddress=a=>'0x'+a.slice(2).padStart(64,'0');
export function quoteFixture({agent='DAT',direction='sell',inputBaseUnits=direction==='buy'?'1000000':'50000000000000000000',nowSeconds=1793700000}={}){
  const buy=direction==='buy',token=THREECORE_BASE_TOKENS[agent],rin=buy?100000000n:2000000n*10n**18n,rout=buy?2000000n*10n**18n:100000000n;
  const amount=BigInt(inputBaseUnits),net=amount-amount*30n/10000n,out=net*rout/(rin+net);
  return {schema:AERODROME_QUOTE_SCHEMA,agent,chainId:8453,dappOrigin:'https://aerodrome.finance',routerAddress:AERODROME_BASE.router,factoryAddress:AERODROME_BASE.poolFactory,poolAddress:QUOTE_POOL,direction,inputToken:buy?BASE_NATIVE_USDC:token,outputToken:buy?token:BASE_NATIVE_USDC,inputDecimals:buy?6:18,outputDecimals:buy?18:6,inputBaseUnits,reserveInBaseUnits:rin.toString(),reserveOutBaseUnits:rout.toString(),feeBps:30,poolOutputBaseUnits:out.toString(),routerOutputBaseUnits:out.toString(),slippageBps:50,blockNumber:'42',blockHash:QUOTE_HASH,blockTimestampSeconds:nowSeconds-2,observedAtSeconds:nowSeconds,canonicalBlockRechecked:true,readOnly:true};
}
export function quoteRpc({quote=quoteFixture(),modify=()=>{},reverse=false,onRequest=()=>{}}={}){
  const calls=[];let chainCalls=0,headers=0;const token=THREECORE_BASE_TOKENS[quote.agent];
  const fetchImpl=async(url,options)=>{
    const request=JSON.parse(options.body);calls.push(request);onRequest(request);let result;
    const {method,params}=request;
    if(method==='eth_chainId'){chainCalls++;result='0x2105';}
    else if(method==='eth_blockNumber')result='0x2a';
    else if(method==='eth_getBlockByNumber'){headers++;result={number:params[0],hash:QUOTE_HASH,timestamp:'0x'+BigInt(quote.blockTimestampSeconds).toString(16)};}
    else if(method==='eth_getCode')result='0x6000';
    else if(method==='eth_call'){
      const {to,data}=params[0],sel=data.slice(0,10);
      if(sel===S.isPaused)result='0x'+word(0);
      else if(sel===S.factory||sel===S.defaultFactory)result=abiAddress(AERODROME_BASE.poolFactory);
      else if(sel===S.getPool)result=abiAddress(QUOTE_POOL);
      else if(sel===S.stable)result='0x'+word(0);
      else if(sel===S.token0)result=abiAddress(reverse?BASE_NATIVE_USDC:token);
      else if(sel===S.token1)result=abiAddress(reverse?token:BASE_NATIVE_USDC);
      else if(sel===S.decimals)result='0x'+word(to===BASE_NATIVE_USDC?6:18);
      else if(sel===S.reserves){let r0=quote.direction==='sell'?quote.reserveInBaseUnits:quote.reserveOutBaseUnits,r1=quote.direction==='sell'?quote.reserveOutBaseUnits:quote.reserveInBaseUnits;if(reverse)[r0,r1]=[r1,r0];result='0x'+word(r0)+word(r1)+word(quote.blockTimestampSeconds);}
      else if(sel===S.getFee)result='0x'+word(quote.feeBps);
      else if(sel===S.poolQuote)result='0x'+word(quote.poolOutputBaseUnits);
      else if(sel===S.routerQuote)result='0x'+word(32)+word(2)+word(quote.inputBaseUnits)+word(quote.routerOutputBaseUnits);
      else throw Error('Unexpected selector');
    }else throw Error('Unexpected method');
    const context={request,result,chainCalls,headers,url,options};modify(context);return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result:context.result}));
  };return {calls,fetchImpl};
}
