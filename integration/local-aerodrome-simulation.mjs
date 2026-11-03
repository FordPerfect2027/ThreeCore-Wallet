// Real pinned Aerodrome contracts + real ThreeCore artifacts in Hardhat's local EVM.
// Uses only the simulator's disposable accounts. Never a public fork or user wallet.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {makeLocalProposalSource} from './fixtures/local-proposal-source.js';
import {AERODROME_BASE,THREECORE_BASE_TOKENS} from '../src/aerodrome-readonly.js';
import {BASE_NATIVE_USDC} from '../src/aerodrome-pools.js';
import {PROPOSAL_FEE_SCHEMA,prepareProposalFeeReview} from '../src/proposal-fee-review.js';
const [directory,toolchain,...extra]=process.argv.slice(2);if(!directory||!toolchain||extra.length)throw Error('Expected prepared directory and token toolchain');
assert.equal(process.env.CI,'true');assert(process.env.THREECORE_SIM_NETWORK_LOG);assert.match(process.env.NODE_OPTIONS??'',/deny-network\.mjs/);
const folder=resolve(directory),require=createRequire(resolve(toolchain,'package.json')),viem=require('viem'),sha=b=>createHash('sha256').update(b).digest('hex');
const compiledBytes=await readFile(resolve(folder,'compiled-artifacts.json')),compiled=JSON.parse(compiledBytes),artifacts=compiled.artifacts;
const {config,network}=await import(pathToFileURL(require.resolve('hardhat')).href);
assert.equal(config.networks.hardhatOp.type,'edr-simulated');assert.equal(config.networks.hardhatOp.forking,undefined);
const connection=await network.create({network:'hardhatOp',chainType:'op',override:{chainId:8453,initialDate:new Date(Date.now()-3600000),initialBaseFeePerGas:10000000}});
const outcomes=[],tokenSources=[];
const json=value=>JSON.stringify(value,(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
try {
 const {provider}=connection,client=await connection.viem.getPublicClient(),[owner,holder]=await connection.viem.getWalletClients();
 const deploy=async(artifact,args=[])=>{const hash=await owner.deployContract({abi:artifact.abi,bytecode:artifact.bytecode,args});const receipt=await client.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');return viem.getContract({address:receipt.contractAddress,abi:artifact.abi,client:{public:client,wallet:owner}});};
 const mined=async promise=>{const receipt=await client.waitForTransactionReceipt({hash:await promise});assert.equal(receipt.status,'success');return receipt;};
 const implementation=await deploy(artifacts.Pool),factory=await deploy(artifacts.PoolFactory,[implementation.address]);
 const registry=await deploy(artifacts.FactoryRegistry,[factory.address,owner.account.address,owner.account.address,owner.account.address]);
 const usdc=await deploy(artifacts.ThreeCoreTestUSDC,[owner.account.address]);
 const router=await deploy(artifacts.Router,[viem.zeroAddress,registry.address,factory.address,owner.account.address,usdc.address]);
 const projects=JSON.parse(await readFile(new URL('../docs/evidence/2026-11-03-token-simulation/preflight.json',import.meta.url),'utf8'));
 const tokens={},pools={};
 for(const p of projects){const name=p.token==='DAT'?'DATCore':p.token==='EMA'?'EMACore':'CAWELONCore',path=resolve(p.root,'artifacts/contracts/'+name+'.sol/'+name+'.json'),bytes=await readFile(path),artifact=JSON.parse(bytes);
  const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:p.root,windowsHide:true,encoding:'utf8'}).trim();assert.equal(execFileSync('git',['status','--porcelain'],{cwd:p.root,windowsHide:true,encoding:'utf8'}).trim(),'');tokenSources.push({agent:p.token,root:p.root,revision,artifactSha256:sha(bytes)});
  const token=await deploy(artifact,[owner.account.address]);tokens[p.token]=token;
  await mined(factory.write.createPool([token.address,usdc.address,false]));
  const poolAddress=await factory.read.getPool([token.address,usdc.address,false]);const pool=viem.getContract({address:poolAddress,abi:artifacts.Pool.abi,client:{public:client,wallet:owner}});pools[p.token]=pool;
  await mined(token.write.transfer([pool.address,2000000n*10n**18n]));await mined(usdc.write.transfer([pool.address,100n*10n**6n]));await mined(pool.write.mint([owner.account.address]));await mined(token.write.transfer([holder.account.address,1000n*10n**18n]));
  await mined(holder.writeContract({address:token.address,abi:artifact.abi,functionName:'approve',args:[router.address,50n*10n**18n]}));
 }
 await mined(usdc.write.transfer([holder.account.address,10n*10n**6n]));await mined(holder.writeContract({address:usdc.address,abi:artifacts.ThreeCoreTestUSDC.abi,functionName:'approve',args:[router.address,1000000n]}));
 await provider.request({method:'hardhat_setBalance',params:[holder.account.address,'0x'+(10n**16n).toString(16)]});
 const snapshot=()=>provider.request({method:'evm_snapshot',params:[]});const restore=id=>provider.request({method:'evm_revert',params:[id]});
 for(const agent of ['DAT','EMA','CAWELON'])for(const direction of ['buy','sell']) {
  const caseSnapshot=await snapshot(),token=tokens[agent],pool=pools[agent],buy=direction==='buy',input=buy?usdc:token,output=buy?token:usdc,amountIn=buy?1000000n:50n*10n**18n;
  const block=await client.getBlock({blockTag:'latest'}),r=await pool.read.getReserves(),token0=(await pool.read.token0()).toLowerCase(),inputFirst=token0===input.address.toLowerCase(),route={from:input.address,to:output.address,stable:false,factory:factory.address};
  const metadata={name:await input.read.name(),symbol:await input.read.symbol(),decimals:await input.read.decimals(),totalSupply:await input.read.totalSupply()};
  const balance=await input.read.balanceOf([holder.account.address]),allowance=await input.read.allowance([holder.account.address,router.address]),nativeBalance=await client.getBalance({address:holder.account.address});
  const poolOut=await pool.read.getAmountOut([amountIn,input.address]),routerAmounts=await router.read.getAmountsOut([amountIn,[route]]);
  const prepared=await makeLocalProposalSource({agent,direction,account:holder.account.address,block,metadata,balance,allowance,nativeBalance,pool:pool.address,amountIn,reserveIn:inputFirst?r[0]:r[1],reserveOut:inputFirst?r[1]:r[0],feeBps:await factory.read.getFee([pool.address,false]),poolOut,routerOut:routerAmounts[1]});
  assert.equal(prepared.plan.eligibleForSimulation,true,JSON.stringify(prepared.plan.reasons));
  const original=viem.decodeFunctionData({abi:artifacts.Router.abi,data:prepared.plan.call.data});assert.equal(original.functionName,'swapExactTokensForTokens');
  const args=[original.args[0],original.args[1],[route],original.args[3],original.args[4]];
  assert.equal(original.args[2].length,1);assert.equal(original.args[2][0].factory.toLowerCase(),AERODROME_BASE.poolFactory);assert.equal(original.args[2][0].from.toLowerCase(),buy?BASE_NATIVE_USDC:THREECORE_BASE_TOKENS[agent]);assert.equal(original.args[2][0].to.toLowerCase(),buy?THREECORE_BASE_TOKENS[agent]:BASE_NATIVE_USDC);assert.equal(original.args[2][0].stable,false);assert.equal(original.args[3].toLowerCase(),holder.account.address.toLowerCase());
  const call={account:holder.account,address:router.address,abi:artifacts.Router.abi,functionName:'swapExactTokensForTokens',args};
  const state=async()=>({block:await client.getBlockNumber({cacheTime:0}),nonce:await client.getTransactionCount({address:holder.account.address}),native:await client.getBalance({address:holder.account.address}),input:await input.read.balanceOf([holder.account.address]),output:await output.read.balanceOf([holder.account.address]),allowance:await input.read.allowance([holder.account.address,router.address]),reserves:await pool.read.getReserves(),inputSupply:await input.read.totalSupply(),outputSupply:await output.read.totalSupply()});
  const before=await state(),simulation=await client.simulateContract(call),gasEstimate=await client.estimateContractGas(call);assert.deepEqual(await state(),before);assert.equal(simulation.result[1],poolOut);assert(gasEstimate<=BigInt(prepared.plan.limits.gasLimit));
  const feeObservation={schema:PROPOSAL_FEE_SCHEMA,planSha256:sha(prepared.text),environment:'isolated-evm',chainId:8453,blockNumber:block.number.toString(),blockHash:block.hash,observedAtSeconds:Number(block.timestamp),estimatedGas:gasEstimate.toString(),baseFeePerGasWei:block.baseFeePerGas.toString(),priorityFeePerGasWei:'0',l1FeeUpperBoundWei:null,operatorFeeUpperBoundWei:null,readOnly:true};
  const feeReview=await prepareProposalFeeReview({simulationPlanFile:prepared.text,observation:feeObservation},{nowSeconds:Number(block.timestamp)});
  assert.deepEqual(feeReview.result.reasons,['FEE_L1_UNKNOWN','FEE_OPERATOR_UNKNOWN']);assert.equal(feeReview.result.totalFeeUpperBoundWei,null);assert.equal(feeReview.result.checksSatisfied,false);
  const negatives=[];
  for(const scenario of ['minimum-too-high','expired','allowance-revoked','factory-paused']){
   const snap=await snapshot();let changed={...call,args:[...args]};
   if(scenario==='minimum-too-high')changed.args[1]=poolOut+1n;
   if(scenario==='expired'){await provider.request({method:'evm_setNextBlockTimestamp',params:[Number(args[4])+1]});await provider.request({method:'evm_mine',params:[]});}
   if(scenario==='allowance-revoked')await mined(holder.writeContract({address:input.address,abi:input.abi,functionName:'approve',args:[router.address,0n]}));
   if(scenario==='factory-paused')await mined(factory.write.setPauseState([true]));
   const initial=await state();let rejected=false,revertDetail;
   try{await client.simulateContract(changed);}catch(error){const reverted=error.walk?.(e=>e.name==='ContractFunctionRevertedError');assert.equal(reverted?.name,'ContractFunctionRevertedError',error.shortMessage);rejected=true;revertDetail={name:reverted.data?.errorName??null,reason:reverted.reason??null,raw:reverted.raw??null};}
   assert.equal(rejected,true,scenario);assert.deepEqual(await state(),initial);
   const expectedRaw={'minimum-too-high':'0x42301c23',expired:'0x203d82d8','allowance-revoked':'0x','factory-paused':viem.toFunctionSelector('IsPaused()')}[scenario];
   assert.equal(revertDetail.raw,expectedRaw,scenario+' must fail for the intended reason');
   negatives.push({scenario,evmRevertObserved:true,stateUnchanged:true,revertDetail});assert.equal(await restore(snap),true);
  }
  const calldata=viem.encodeFunctionData({abi:artifacts.Router.abi,functionName:'swapExactTokensForTokens',args});
  const receipt=await mined(holder.sendTransaction({to:router.address,data:calldata,value:0n,gas:BigInt(prepared.plan.limits.gasLimit),maxFeePerGas:BigInt(prepared.plan.limits.maxFeePerGasWei),maxPriorityFeePerGas:0n}));
  const after=await state();assert.equal(before.input-after.input,amountIn);assert.equal(after.output-before.output,poolOut);assert.equal(before.allowance-after.allowance,amountIn);assert.equal(after.inputSupply,before.inputSupply);assert.equal(after.outputSupply,before.outputSupply);assert(receipt.gasUsed<=gasEstimate);assert(after.output-before.output>=BigInt(prepared.plan.minimumOutputBaseUnits));
  const nativeFeePaidWei=before.native-after.native,l2FeePaidWei=receipt.gasUsed*receipt.effectiveGasPrice;
  // OP-specific components are exposed by the raw receipt, not the viem formatter.
  // This profile has zero operator parameters; reject other profiles until supported.
  assert(nativeFeePaidWei>=l2FeePaidWei);assert(l2FeePaidWei<=BigInt(feeReview.result.l2FeeCeilingWei));
  const rawReceipt=await provider.request({method:'eth_getTransactionReceipt',params:[receipt.transactionHash]});
  const l1FeePaidWei=BigInt(rawReceipt.l1Fee);assert.equal(BigInt(rawReceipt.operatorFeeScalar),0n);assert.equal(BigInt(rawReceipt.operatorFeeConstant),0n);
  assert.equal(nativeFeePaidWei,l2FeePaidWei+l1FeePaidWei);
  const record={agent,direction,environment:'isolated-hardhat-op-no-fork',publicChainObserved:false,userWalletUsed:false,planSha256:sha(prepared.text),originalCall:prepared.plan.call,localCall:{from:holder.account.address,to:router.address,data:calldata,value:'0'},mapping:{publishedRouter:AERODROME_BASE.router,localRouter:router.address,publishedFactory:AERODROME_BASE.poolFactory,localFactory:factory.address,publishedToken:THREECORE_BASE_TOKENS[agent],localToken:token.address,publishedUsdc:BASE_NATIVE_USDC,localUsdcFixture:usdc.address},gasEstimate,gasUsed:receipt.gasUsed,effectiveGasPrice:receipt.effectiveGasPrice,l2ExecutionFeeWei:l2FeePaidWei,nativeFeePaidWei,l1FeeWei:l1FeePaidWei,operatorFeeWei:'0',localFeeBreakdownVerified:true,totalBaseFeeVerified:false,outputBaseUnits:poolOut,before,after,rawReceipt,readOnlySimulationPreservedState:true,localExecutionReceiptStatus:receipt.status,receiptHash:receipt.transactionHash,negatives};
  await writeFile(resolve(folder,agent+'-'+direction+'-plan.json'),prepared.text,{flag:'wx'});await writeFile(resolve(folder,agent+'-'+direction+'-fee-review.json'),feeReview.text,{flag:'wx'});await writeFile(resolve(folder,agent+'-'+direction+'-result.json'),json(record),{flag:'wx'});outcomes.push(record);console.log(JSON.stringify({agent,direction,gasEstimate:String(gasEstimate),gasUsed:String(receipt.gasUsed),negativeControls:negatives.length}));assert.equal(await restore(caseSnapshot),true);
 }
 await writeFile(resolve(folder,'execution-summary.json'),json({scope:'isolated EVM, actual pinned Aerodrome source, real token artifacts, six-decimal USDC fixture',compilerArtifactSha256:sha(compiledBytes),tokenSources,simulator:'Hardhat edr-simulated / hardhatOp / no fork',publicChainWrites:false,userKeysRead:false,outcomes}),{flag:'wx'});
}finally{await connection.close();}
