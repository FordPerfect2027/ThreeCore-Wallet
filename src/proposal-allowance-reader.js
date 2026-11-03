import { captureOptionalDataFields } from './security-data.js';
import { subscribeReadAbort } from './security-abort.js';
import { createPublicBaseRpcReader } from './public-base-rpc.js';
import { decodeMetadataWord } from './token-identity-codec.js';
import { AERODROME_BASE, THREECORE_BASE_TOKENS } from './aerodrome-readonly.js';
import { BASE_NATIVE_USDC } from './aerodrome-pools.js';
import { PROPOSAL_ALLOWANCE_SCHEMA, validateProposalAllowanceRequest, validateProposalAllowance, failAllowance as fail } from './proposal-allowance.js';

export async function readProposalAllowance(input,options={}) {
 const request=validateProposalAllowanceRequest(input);let s;
 try { s=captureOptionalDataFields(options,['fetchImpl','signal','timeoutMs','requestTimeoutMs']); } catch { fail('ALLOWANCE_OPTIONS'); }
 const timeout=s.timeoutMs??120000;if(!Number.isInteger(timeout)||timeout<100||timeout>120000)fail('ALLOWANCE_TIMEOUT_OPTION');
 const controller=new AbortController();let subscription,timer,timedOut=false;
 const guard=()=>{if(controller.signal.aborted)fail(timedOut?'ALLOWANCE_TIMEOUT':'ALLOWANCE_CANCELLED');};
 try {
  subscription=subscribeReadAbort(s.signal,()=>controller.abort());guard();
  const rpc=createPublicBaseRpcReader({rpcUrl:AERODROME_BASE.rpcUrl,fetchImpl:s.fetchImpl??globalThis.fetch,signal:controller.signal,timeoutMs:s.requestTimeoutMs??10000,includeBlockTimestamp:true});
  timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
  const read=async(method,params=[])=>{guard();const result=await rpc(method,params);guard();return result;};
  if(BigInt(await read('eth_chainId'))!==8453n)fail('ALLOWANCE_NETWORK');
  const height='0x'+BigInt(request.blockNumber).toString(16),block=await read('eth_getBlockByNumber',[height,false]);
  if(block.hash!==request.blockHash)fail('ALLOWANCE_BLOCK_CHANGED');
  const selector={blockHash:request.blockHash,requireCanonical:true},token=request.direction==='buy'?BASE_NATIVE_USDC:THREECORE_BASE_TOKENS[request.agent],spender=AERODROME_BASE.router;
  const tokenHasCode=await read('eth_getCode',[token,selector])!=='0x',spenderHasCode=await read('eth_getCode',[spender,selector])!=='0x';
  const nativeBalanceBaseUnits=BigInt(await read('eth_getBalance',[request.account,selector])).toString();
  const word=a=>a.slice(2).padStart(64,'0'),call=async data=>decodeMetadataWord(await read('eth_call',[{to:token,data},selector])).toString();
  const tokenBalanceBaseUnits=tokenHasCode?await call('0x70a08231'+word(request.account)):null;
  const allowanceBaseUnits=tokenHasCode?await call('0xdd62ed3e'+word(request.account)+word(spender)):null;
  const final=await read('eth_getBlockByNumber',[height,false]);
  if(final.hash!==block.hash||final.timestamp!==block.timestamp)fail('ALLOWANCE_BLOCK_CHANGED');
  if(BigInt(await read('eth_chainId'))!==8453n)fail('ALLOWANCE_NETWORK_CHANGED');
  const result=validateProposalAllowance({...request,schema:PROPOSAL_ALLOWANCE_SCHEMA,chainId:8453,rpcUrl:AERODROME_BASE.rpcUrl,tokenAddress:token,spenderAddress:spender,blockTimestampSeconds:Number(BigInt(block.timestamp)),observedAtSeconds:Math.floor(Date.now()/1000),tokenHasCode,spenderHasCode,tokenBalanceBaseUnits,allowanceBaseUnits,nativeBalanceBaseUnits,canonicalBlockRechecked:true,readOnly:true,walletConnected:false});guard();return result;
 } catch(error) { guard();throw error; } finally { clearTimeout(timer);subscription?.dispose();controller.abort(); }
}
