import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeOperationBudget} from '../../../src/operation-budget.js';
import {decodeSharedOperationBudget,evaluateSharedOperationBudget} from '../../../src/shared-operation-budget.js';
import {decodeBudgetEvidence,inspectBudgetEvidence} from '../../../src/operation-budget-evidence.js';
const here=dirname(fileURLToPath(import.meta.url)),dir='C:/Users/aseet/Downloads',hash=b=>createHash('sha256').update(b).digest('hex');
const pairs=[['ThreeCore-budget-input (3).json','browser-live-budget.json','live-ema-usdc-budget.json'],['ThreeCore-shared-budget-input (2).json','browser-shared-budget.json','synthetic-shared-usdc-budget.json'],['ThreeCore-shared-budget-input (3).json','browser-shared-reexport.json','synthetic-shared-usdc-budget.json'],['ThreeCore-budget-evidence (7).json','browser-live-evidence.json','live-budget-evidence.json']];
const records=[];
for(const [download,name,expected] of pairs){const bytes=await readFile(resolve(dir,download));assert.deepEqual(bytes,await readFile(resolve(here,expected)));await writeFile(resolve(here,name),bytes,{flag:'wx'});records.push({download,file:name,bytes:bytes.length,sha256:hash(bytes),byteIdenticalTo:expected});}
assert.equal(decodeOperationBudget(await readFile(resolve(here,records[0].file),'utf8')).token.decimals,6);
const shared=evaluateSharedOperationBudget(decodeSharedOperationBudget(await readFile(resolve(here,records[1].file),'utf8')));assert.equal(shared.individuallySatisfied,true);assert.equal(shared.constraintsSatisfied,false);assert.equal(shared.sharedUsdc.shortfall,'4000000');
const evidence=await inspectBudgetEvidence(decodeBudgetEvidence(await readFile(resolve(here,records[3].file),'utf8')));assert.equal(evidence.consistent,true);assert.equal(evidence.budgetResult.constraintsSatisfied,false);
await copyFile(resolve(dir,'ThreeCore-USDC-shared-20261103.png'),resolve(here,'browser-shared.png'));await copyFile(resolve(dir,'ThreeCore-USDC-evidence-20261103.png'),resolve(here,'browser-live-evidence.png'));
await writeFile(resolve(here,'browser-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),records,sharedShortfallUnits:shared.sharedUsdc.shortfall,liveEvidenceConsistent:evidence.consistent,liveBudgetSatisfied:evidence.budgetResult.constraintsSatisfied},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({files:records.length,byteIdentical:true,sharedShortfallUSDC:'4',liveEvidenceConsistent:true,liveBudgetSatisfied:false}));
