import { captureOptionalDataFields } from './security-data.js';
import { subscribeReadAbort } from './security-abort.js';
import { createPublicBaseRpcReader } from './public-base-rpc.js';
import { identityAddress,identityUnits,METADATA_FIELDS,decodeMetadataField,decodeMetadataWord } from './token-identity-codec.js';
import { BASE_NATIVE_USDC } from './aerodrome-pools.js';
import { PUBLIC_USDC_SCHEMA,validatePublicUsdc,failPublicUsdc as fail } from './public-usdc-model.js';
export async function readPublicUsdc(input={}){
 let s;try{s=captureOptionalDataFields(input,['account','blockNumber','fetchImpl','signal','timeoutMs','requestTimeoutMs']);}catch{fail('USDC_OPTIONS');}
 const account=identityAddress(s.account);if(s.blockNumber!==undefined)identityUnits(s.blockNumber);
 const timeout=s.timeoutMs??120000;if(!Number.isInteger(timeout)||timeout<100||timeout>120000)fail('USDC_TIMEOUT_OPTION');
 const controller=new AbortController();let cancellation,timer,timedOut=false;const guard=()=>{if(controller.signal.aborted)fail(timedOut?'USDC_TIMEOUT':'USDC_CANCELLED');};
 try{
  try{cancellation=subscribeReadAbort(s.signal,()=>controller.abort());}catch{fail('USDC_SIGNAL');}guard();
  const rpc=createPublicBaseRpcReader({rpcUrl:'https://mainnet.base.org',fetchImpl:s.fetchImpl??globalThis.fetch,signal:controller.signal,timeoutMs:s.requestTimeoutMs??10000,includeBlockTimestamp:true});
  timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);const read=async(method,params=[])=>{guard();const result=await rpc(method,params);guard();return result;};
  if(BigInt(await read('eth_chainId'))!==8453n)fail('USDC_NETWORK');
  const height=s.blockNumber===undefined?await read('eth_blockNumber'):'0x'+BigInt(s.blockNumber).toString(16),block=await read('eth_getBlockByNumber',[height,false]),selector={blockHash:block.hash,requireCanonical:true};
  if(await read('eth_getCode',[BASE_NATIVE_USDC,selector])==='0x')fail('USDC_CODE_MISSING');
  const nativeBalanceBaseUnits=BigInt(await read('eth_getBalance',[account,selector])).toString(),metadata={};
  for(const [key,data] of Object.entries(METADATA_FIELDS))metadata[key]=decodeMetadataField(key,await read('eth_call',[{to:BASE_NATIVE_USDC,data},selector]));
  const balanceBaseUnits=decodeMetadataWord(await read('eth_call',[{to:BASE_NATIVE_USDC,data:'0x70a08231'+account.slice(2).padStart(64,'0')},selector])).toString();
  const final=await read('eth_getBlockByNumber',[block.number,false]);if(final.hash!==block.hash||final.timestamp!==block.timestamp)fail('USDC_BLOCK_CHANGED');
  if(BigInt(await read('eth_chainId'))!==8453n)fail('USDC_NETWORK_CHANGED');
  const result=validatePublicUsdc({schema:PUBLIC_USDC_SCHEMA,chainId:8453,rpcUrl:'https://mainnet.base.org',account,tokenAddress:BASE_NATIVE_USDC,blockNumber:BigInt(block.number).toString(),blockHash:block.hash,blockTimestampSeconds:Number(BigInt(block.timestamp)),observedAtSeconds:Math.floor(Date.now()/1000),metadata,balanceBaseUnits,nativeBalanceBaseUnits,hasCode:true,canonicalBlockRechecked:true,readOnly:true,walletConnected:false});guard();return result;
 }catch(error){guard();throw error;}finally{clearTimeout(timer);cancellation?.dispose();controller.abort();}
}
