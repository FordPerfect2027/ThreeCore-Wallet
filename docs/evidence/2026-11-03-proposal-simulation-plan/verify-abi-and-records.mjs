import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {allowanceFixture} from '../../../test/helpers/proposal-allowance-fixture.js';
import {prepareProposalAllowanceReview} from '../../../src/proposal-allowance.js';
import {prepareProposalSimulationPlan,inspectProposalSimulationPlanFile,CLASSIC_SWAP_SELECTOR} from '../../../src/proposal-simulation-plan.js';
const here=new URL('./',import.meta.url),hash=b=>createHash('sha256').update(b).digest('hex');
const reference='https://raw.githubusercontent.com/aerodrome-finance/contracts/1ba30815bba620f7e9faa34769ffd00c214c9b82/contracts/interfaces/IRouter.sol';
const response=await fetch(reference,{redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);const bytes=new Uint8Array(await response.arrayBuffer());assert.equal(hash(bytes),'2c0af7ca32880175d8d5ecd583e7f52fb63707ccdbe83b6c7696fd3a13c1ef82');
const source=new TextDecoder().decode(bytes);assert.match(source,/function swapExactTokensForTokens\(\s*uint256 amountIn,\s*uint256 amountOutMin,\s*Route\[\] calldata routes,\s*address to,\s*uint256 deadline\s*\)/);
const project=JSON.parse(await readFile(new URL('../2026-11-03-token-simulation/preflight.json',here),'utf8'))[0].root;
const require=createRequire(project+'/package.json'),viem=require('viem');
const signature='swapExactTokensForTokens(uint256,uint256,(address,address,bool,address)[],address,uint256)';assert.equal(viem.toFunctionSelector(signature),CLASSIC_SWAP_SELECTOR);
const abi=viem.parseAbi(['function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,(address from,address to,bool stable,address factory)[] routes,address to,uint256 deadline) returns (uint256[])']);
const verified=[];
for(const input of [{},...['DAT','EMA','CAWELON'].map(agent=>({buy:true,agent}))]){
 const f=await allowanceFixture(input),allowance=await prepareProposalAllowanceReview(f.files,f.options),prepared=await prepareProposalSimulationPlan(allowance.text,{nowSeconds:f.options.nowSeconds}),p=prepared.plan;
 const encoded=viem.encodeFunctionData({abi,functionName:'swapExactTokensForTokens',args:[BigInt(p.amountInBaseUnits),BigInt(p.minimumOutputBaseUnits),[p.route],p.recipient,BigInt(p.deadlineSeconds)]});assert.equal(encoded,p.call.data);
 const decoded=viem.decodeFunctionData({abi,data:p.call.data});assert.equal(decoded.functionName,'swapExactTokensForTokens');assert.equal(decoded.args[3].toLowerCase(),p.recipient);assert.equal(decoded.args[2].length,1);
 const filename=(input.agent??'DAT')+'-'+(input.buy?'buy':'sell')+'-synthetic-plan.json';await writeFile(new URL(filename,here),prepared.text,{flag:'wx'});await inspectProposalSimulationPlanFile(prepared.text);verified.push({file:filename,sourceType:'synthetic',abiMatches:true,bytes:(encoded.length-2)/2,sha256:hash(prepared.text)});
}
const original=await readFile(new URL('../2026-11-03-proposal-allowance/browser-account2.json',here),'utf8');const blocked=await prepareProposalSimulationPlan(original);assert.equal(blocked.plan.call,null);assert.equal(blocked.plan.eligibleForSimulation,false);await writeFile(new URL('account2-blocked-plan.json',here),blocked.text,{flag:'wx'});
const report={officialReference:reference,officialSha256:hash(bytes),independentAbiLibrary:'viem '+JSON.parse(await readFile(project+'/node_modules/viem/package.json','utf8')).version,selector:CLASSIC_SWAP_SELECTOR,verified,historicalAccount2Blocked:true,transactionsSent:false,simulationExecuted:false};
await writeFile(new URL('verification.json',here),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
