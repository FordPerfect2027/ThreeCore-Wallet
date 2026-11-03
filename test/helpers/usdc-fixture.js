import { PUBLIC_USDC_SCHEMA } from '../../src/public-usdc-model.js';
import { BASE_NATIVE_USDC } from '../../src/aerodrome-pools.js';
import { operationBudgetExample,USDC_OPERATION_BUDGET_SCHEMA } from '../../src/operation-budget.js';
import { ACCOUNT,HASH,word,abiText } from './identity-fixtures.js';
export function usdcFixture(changes={}){return {schema:PUBLIC_USDC_SCHEMA,chainId:8453,rpcUrl:'https://mainnet.base.org',account:ACCOUNT,tokenAddress:BASE_NATIVE_USDC,blockNumber:'42',blockHash:HASH,blockTimestampSeconds:1793700000,observedAtSeconds:1793700002,metadata:{name:'USD Coin',symbol:'USDC',decimals:6,totalSupply:'1000000000'},balanceBaseUnits:'10000000',nativeBalanceBaseUnits:'10000000000000000',hasCode:true,canonicalBlockRechecked:true,readOnly:true,walletConnected:false,...changes};}
export function usdcBudget(agent='DAT',changes={}){const b=structuredClone(operationBudgetExample());b.schema=USDC_OPERATION_BUDGET_SCHEMA;b.agent=agent;b.chainId=8453;b.token={decimals:6,balanceUnits:'10000000',reservedUnits:'1000000',reserveFloorUnits:'1000000',spendUnits:'1000000'};b.fees.operatorFeeBudgetWei='0';return {...b,...changes};}
export function usdcRpc({observation=usdcFixture(),modify=()=>{}}={}){const calls=[];let headers=0,chains=0;return {calls,fetchImpl:async(url,options)=>{
 const request=JSON.parse(options.body);calls.push(request);let result;const {method,params}=request;
 if(method==='eth_chainId'){chains++;result='0x2105';}else if(method==='eth_blockNumber')result='0x2a';else if(method==='eth_getBlockByNumber'){headers++;result={number:params[0],hash:observation.blockHash,timestamp:'0x'+BigInt(observation.blockTimestampSeconds).toString(16)};}
 else if(method==='eth_getCode')result='0x6000';else if(method==='eth_getBalance')result='0x'+BigInt(observation.nativeBalanceBaseUnits).toString(16);
 else if(method==='eth_call'){const selector=params[0].data.slice(0,10);result=selector==='0x06fdde03'?abiText(observation.metadata.name):selector==='0x95d89b41'?abiText(observation.metadata.symbol):selector==='0x313ce567'?word(observation.metadata.decimals):selector==='0x18160ddd'?word(observation.metadata.totalSupply):selector==='0x70a08231'?word(observation.balanceBaseUnits):undefined;if(result===undefined)throw Error('SELECTOR');}else throw Error('METHOD');
 const c={request,result,url,options,headers,chains};modify(c);return Response.json({jsonrpc:'2.0',id:request.id,result:c.result});
 }};}
