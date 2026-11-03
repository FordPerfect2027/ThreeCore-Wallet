import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {allowanceFixture} from './helpers/proposal-allowance-fixture.js';
import {prepareProposalAllowanceReview} from '../src/proposal-allowance.js';
import {prepareProposalSimulationPlan,inspectProposalSimulationPlanFile,CLASSIC_SWAP_SELECTOR} from '../src/proposal-simulation-plan.js';
import {runSimulationPlan} from '../scripts/proposal-simulation-plan.js';
test('simulation call fixes source recipient, route, minimum, expiry and budget caps for sell and three USDC buys',async()=>{
 for(const input of [{},...['DAT','EMA','CAWELON'].map(agent=>({buy:true,agent}))]){
  const f=await allowanceFixture(input),source=await prepareProposalAllowanceReview(f.files,f.options),r=await prepareProposalSimulationPlan(source.text,{nowSeconds:f.options.nowSeconds});
  assert.equal(r.plan.eligibleForSimulation,true);assert.equal(r.plan.authorizesExecution,false);assert.equal(r.plan.call.from,f.request.account);assert.equal(r.plan.recipient,f.request.account);assert.equal(r.plan.call.to,f.observation.spenderAddress);assert.equal(r.plan.route.from,f.observation.tokenAddress);assert.equal(r.plan.call.value,'0');assert.equal(r.plan.call.data.slice(0,10),CLASSIC_SWAP_SELECTOR);assert.equal(r.plan.call.data.length,650);assert.equal(r.plan.deadlineSeconds,f.options.nowSeconds+58);
  assert.equal(r.plan.limits.gasLimit,'200000');assert.equal(r.plan.limits.operatorFeeBudgetWei,'0');assert.deepEqual((await inspectProposalSimulationPlanFile(r.text)).recordedPlan,r.plan);
 }
});
test('expired/failing preconditions cannot produce call data; reading saved success does not extend its window',async()=>{
 const f=await allowanceFixture(),source=await prepareProposalAllowanceReview(f.files,f.options),ready=await prepareProposalSimulationPlan(source.text,{nowSeconds:f.options.nowSeconds});
 for(const nowSeconds of [f.options.nowSeconds+58,f.options.nowSeconds+1000]){const r=await prepareProposalSimulationPlan(source.text,{nowSeconds});assert.equal(r.plan.call,null);assert.equal(r.plan.eligibleForSimulation,false);assert(r.plan.reasons.includes('SIMULATION_WINDOW_CLOSED'));assert.equal(r.plan.deadlineSeconds,ready.plan.deadlineSeconds);}
 const blocked=await prepareProposalAllowanceReview({...f.files,observation:{...f.observation,allowanceBaseUnits:'0'}},f.options);assert.equal((await prepareProposalSimulationPlan(blocked.text,{nowSeconds:f.options.nowSeconds})).plan.call,null);
});
test('shared source selects the intended agent fee budget and missing agent leaves an explicitly blocked plan',async()=>{
 for(const omitAgent of [false,true]) {
  const f=await allowanceFixture({buy:true,agent:'EMA',shared:true,omitAgent}),source=await prepareProposalAllowanceReview(f.files,f.options),r=await prepareProposalSimulationPlan(source.text,{nowSeconds:f.options.nowSeconds});
  if(omitAgent){assert.equal(r.plan.call,null);assert.equal(r.plan.limits,null);assert(r.plan.reasons.includes('SIMULATION_BUDGET_MISSING'));}
  else {assert.equal(r.plan.eligibleForSimulation,true);assert.equal(r.plan.limits.gasLimit,'210000');}
 }
});
test('saved plan rejects recipient, amounts, calldata, source, fee limits and expiry tampering',async()=>{
 const f=await allowanceFixture(),source=await prepareProposalAllowanceReview(f.files,f.options),ready=await prepareProposalSimulationPlan(source.text,{nowSeconds:f.options.nowSeconds});
 for(const mutate of [p=>{p.plan.call.data='0x';},p=>{p.plan.recipient='0x'+'22'.repeat(20);},p=>{p.plan.minimumOutputBaseUnits='0';},p=>{p.plan.deadlineSeconds++;},p=>{p.plan.limits.gasLimit='1';},p=>{p.plan.sourceSha256='0'.repeat(64);},p=>{p.plan.authorizesExecution=true;},p=>{p.evaluatedAtSeconds=null;}]){const data=JSON.parse(ready.text);mutate(data);await assert.rejects(inspectProposalSimulationPlanFile(JSON.stringify(data)));}
 const c=new AbortController();c.abort();await assert.rejects(prepareProposalSimulationPlan(source.text,{signal:c.signal}));
});
test('offline command prepares, verifies, rejects malformed inputs and distinguishes blocked plan from errors',async()=>{
 const folder=await mkdtemp(join(tmpdir(),'threecore-plan-'));try{
  const f=await allowanceFixture({nowSeconds:Math.floor(Date.now()/1000)}),source=await prepareProposalAllowanceReview(f.files,f.options),file=join(folder,'allowance.json'),out=join(folder,'plan.json');await writeFile(file,source.text);let text='',errors='';const output={write:s=>text+=s},error={write:s=>errors+=s};
  assert.equal(await runSimulationPlan(['prepare',file],output,error),0);await writeFile(out,text);assert.equal(await runSimulationPlan(['verify',out],{write(){}},error),0);
  const blocked=await prepareProposalAllowanceReview({...f.files,observation:{...f.observation,allowanceBaseUnits:'0'}},f.options);await writeFile(file,blocked.text);text='';assert.equal(await runSimulationPlan(['prepare',file],output,error),2);assert.equal(JSON.parse(text).plan.call,null);
  for(const args of [[],['send',file],['prepare',file,'extra'],['prepare','--help']])assert.equal(await runSimulationPlan(args,output,error),1);
  await writeFile(file,'{');assert.equal(await runSimulationPlan(['prepare',file],output,error),1);
 }finally{const target=await realpath(folder),base=await realpath(tmpdir());assert.equal(dirname(target),base);assert.match(basename(target),/^threecore-plan-[A-Za-z0-9]+$/);await rm(target,{recursive:true,force:true});}
});
