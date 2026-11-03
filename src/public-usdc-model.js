import { captureDataRecord,sha256Hex } from './security-data.js';
import { boundedUtf8Length,parseSecurityJson } from './security-json.js';
import { identityAddress,identityUnits,validateTokenMetadata } from './token-identity-codec.js';
import { BASE_NATIVE_USDC } from './aerodrome-pools.js';

export const PUBLIC_USDC_SCHEMA='threecore.public-usdc-observation.v1';
export const PUBLIC_USDC_FILE_SCHEMA='threecore.public-usdc-file.v1';
export const PUBLIC_USDC_FILE_LIMIT=16384;
export class PublicUsdcError extends Error{constructor(code){super(code);this.code=code;this.name='PublicUsdcError';}}
export const failPublicUsdc=code=>{throw new PublicUsdcError(code);};
const fail=failPublicUsdc;
function record(input,keys){try{return captureDataRecord(input,keys);}catch{fail('USDC_STRUCTURE');}}
function bounded(text){try{boundedUtf8Length(text,PUBLIC_USDC_FILE_LIMIT);}catch{fail('USDC_FILE_SIZE');}return text;}
function time(value){if(!Number.isSafeInteger(value)||value<0||value>253402300799)fail('USDC_TIME');return value;}
export function validatePublicUsdc(input){
 const o=record(input,['schema','chainId','rpcUrl','account','tokenAddress','blockNumber','blockHash','blockTimestampSeconds','observedAtSeconds','metadata','balanceBaseUnits','nativeBalanceBaseUnits','hasCode','canonicalBlockRechecked','readOnly','walletConnected']);
 if(o.schema!==PUBLIC_USDC_SCHEMA||o.chainId!==8453||o.rpcUrl!=='https://mainnet.base.org'||o.tokenAddress!==BASE_NATIVE_USDC||o.hasCode!==true||o.canonicalBlockRechecked!==true||o.readOnly!==true||o.walletConnected!==false)fail('USDC_CONTEXT');
 if(typeof o.blockHash!=='string'||!/^0x[0-9a-f]{64}$/.test(o.blockHash))fail('USDC_BLOCK');
 const metadata=validateTokenMetadata(o.metadata);
 if(metadata.name!=='USD Coin'||metadata.symbol!=='USDC'||metadata.decimals!==6)fail('USDC_IDENTITY');
 const balanceBaseUnits=identityUnits(o.balanceBaseUnits);if(BigInt(balanceBaseUnits)>BigInt(metadata.totalSupply))fail('USDC_SUPPLY');
 return Object.freeze({...o,account:identityAddress(o.account),blockNumber:identityUnits(o.blockNumber),blockTimestampSeconds:time(o.blockTimestampSeconds),observedAtSeconds:time(o.observedAtSeconds),
   metadata,balanceBaseUnits,nativeBalanceBaseUnits:identityUnits(o.nativeBalanceBaseUnits)});
}
export async function preparePublicUsdcFile(input,{subtle=globalThis.crypto?.subtle,signal,timeoutMs}={}){
 const observation=validatePublicUsdc(input),canonical=JSON.stringify(observation),digest=await sha256Hex(new TextEncoder().encode(canonical),subtle,{signal,timeoutMs});
 const text=bounded(JSON.stringify({schema:PUBLIC_USDC_FILE_SCHEMA,observation,digest},null,2)+'\n');
 return Object.freeze({text,observation,digest,filename:'ThreeCore-USDC-'+observation.blockNumber+'.json',mimeType:'application/json',authenticated:false});
}
export async function decodePublicUsdcFile(text,options={}){
 bounded(text);let input;try{input=parseSecurityJson(text);}catch{fail('USDC_JSON');}const data=record(input,['schema','observation','digest']);
 if(data.schema!==PUBLIC_USDC_FILE_SCHEMA||typeof data.digest!=='string'||!/^[0-9a-f]{64}$/.test(data.digest))fail('USDC_FILE_FORMAT');
 const checked=await preparePublicUsdcFile(data.observation,options);if(data.digest!==checked.digest)fail('USDC_CHECKSUM');return Object.freeze({observation:checked.observation,checksumVerified:true,authenticated:false});
}
/** One USDC holding may fund several agent budgets; it is not three separate balances. */
export function publicUsdcBudgetObservation(input,agent){
 const o=validatePublicUsdc(input);if(!['DAT','EMA','CAWELON'].includes(agent))fail('USDC_AGENT');
 return Object.freeze({...o,source:'public-rpc',agent,spendingAsset:'USDC',identityMatches:true,securityAudit:false});
}
