import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve,dirname,basename} from 'node:path';import {spawnSync} from 'node:child_process';
import {rehearsalExampleV2} from '../src/operation-rehearsal-examples.js';import {encodeRehearsal} from '../src/operation-rehearsal.js';
import {REHEARSAL_WORKSPACE_SCHEMA,encodeRehearsalWorkspace} from '../src/operation-rehearsal-workspace.js';
import {encodeRehearsalComparison} from '../src/operation-rehearsal-comparison.js';
import {encodeRehearsalScenario} from '../src/operation-rehearsal-scenario.js';
import {REHEARSAL_SCENARIO_SET_SCHEMA,encodeRehearsalScenarioSet,encodeRehearsalScenarioSetReport} from '../src/operation-rehearsal-scenario-set.js';
import {captureRehearsalCheckSuite,encodeRehearsalCheckSuite,encodeRehearsalCheckReport,runRehearsalCheckSuite} from '../src/operation-rehearsal-check-suite.js';
import {reviewRehearsalReport,reviewedRehearsalInputChoices,exportReviewedRehearsalPart} from '../src/operation-rehearsal-report-review.js';
import {recoverRehearsalReportInputs} from '../scripts/recover-rehearsal-report-inputs.js';

const before=rehearsalExampleV2(),after={...before,policy:{...before.policy,paused:true}};
const workspace={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:'DAT',ledgers:[before]};
const changed={...workspace,activeAgent:'EMA',ledgers:[after,rehearsalExampleV2('EMA','pending')]};
const cases={schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:'paused-case',label:'停止条件の比較',before,after},{id:'second',label:'同条件',before:after,after}]};
const suite=structuredClone(captureRehearsalCheckSuite(cases));suite.expectationOrigin='manually-specified';suite.expected[0].before.metrics.cash='999';
const scenarios=[
 {text:encodeRehearsalComparison(workspace,changed),parts:[['workspace-before',encodeRehearsalWorkspace(workspace)],['workspace-after',encodeRehearsalWorkspace(changed)]]},
 {text:encodeRehearsalScenario(before,after),parts:[['scenario-before',encodeRehearsal(before)],['scenario-after',encodeRehearsal(after)]]},
 {text:encodeRehearsalScenarioSetReport(cases),parts:[['scenario-set',encodeRehearsalScenarioSet(cases)]]},
 {text:encodeRehearsalCheckReport(suite),parts:[['check-suite',encodeRehearsalCheckSuite(suite)]]}
];
for(const sample of scenarios)test('fresh verified '+sample.parts[0][0]+' recovers only explicit correct inputs',async()=>{
 const receipt=await reviewRehearsalReport(sample.text),choices=reviewedRehearsalInputChoices(receipt);
 assert.deepEqual(choices.map(c=>c.part),sample.parts.map(([part])=>part));assert.ok(Object.isFrozen(choices));assert.ok(choices.every(Object.isFrozen));
 for(const [part,text]of sample.parts){const file=exportReviewedRehearsalPart(receipt,part);assert.equal(file.text,text);assert.equal(file.filename,'ThreeCore-recovered-'+part+'.json');assert.ok(Object.isFrozen(file));assert.ok(file.destination);}
 for(const part of [undefined,'','after','ALL',{},null])assert.throws(()=>exportReviewedRehearsalPart(receipt,part),e=>e.code==='INVALID_REVIEW_PART');
 for(const other of scenarios)if(other!==sample)assert.throws(()=>exportReviewedRehearsalPart(receipt,other.parts[0][0]),e=>e.code==='REVIEW_PART_UNAVAILABLE');
});
test('expected input recovery preserves manual failing expectations rather than making them pass',async()=>{
 const sample=scenarios[3],receipt=await reviewRehearsalReport(sample.text);assert.equal(receipt.matchesRecomputation,true);assert.equal(receipt.reportOutcome.allMatched,false);
 const output=JSON.parse(exportReviewedRehearsalPart(receipt,'check-suite').text);assert.deepEqual(output,suite);assert.equal(output.expectationOrigin,'manually-specified');
 const result=runRehearsalCheckSuite(output);assert.equal(result.summary.allMatched,false);assert.equal(result.rows[0].differenceCount,1);
});
test('empty named case collections remain empty instead of inventing cases',async()=>{
 const empty={...cases,cases:[]},receipt=await reviewRehearsalReport(encodeRehearsalScenarioSetReport(empty));
 assert.equal(exportReviewedRehearsalPart(receipt,'scenario-set').text,encodeRehearsalScenarioSet(empty));
});
test('copied or mismatching receipts cannot enable any recovered part',async()=>{
 let called=0;const forged={get matchesRecomputation(){called++;return true;}};
 for(const sample of scenarios){const receipt=await reviewRehearsalReport(sample.text),altered=JSON.parse(sample.text);altered.authorizesExecution=true;
  for(const denied of [{...receipt},JSON.parse(JSON.stringify(receipt)),null,forged,await reviewRehearsalReport(JSON.stringify(altered)),await reviewRehearsalReport(sample.text,{expectedSha256:'0'.repeat(64)})]){
   assert.deepEqual(reviewedRehearsalInputChoices(denied),[]);assert.throws(()=>exportReviewedRehearsalPart(denied,sample.parts[0][0]),e=>e.code==='REVIEW_PART_UNAVAILABLE');
  }
 }assert.equal(called,0);
});
test('offline report-input recovery reproduces each output and leaves every source unchanged',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'threecore-reviewed-parts-')),path=join(dir,'report.json');
 const run=async args=>{let out='',err='';const status=await recoverRehearsalReportInputs(args,{write:v=>{out+=v;}},{write:v=>{err+=v;}});return{status,out,err};};
 try{for(const sample of scenarios){await writeFile(path,sample.text);const receipt=await reviewRehearsalReport(sample.text);
   for(const [part,text]of sample.parts){for(const flags of [['--part',part],['--sha256',receipt.sha256.toUpperCase(),'--part',part],['--part',part,'--sha256',receipt.sha256]]){const result=await run([path,...flags]);assert.equal(result.status,0,result.err);assert.equal(result.out,text);}}
   assert.equal(await readFile(path,'utf8'),sample.text);
  }
  const actual=spawnSync(process.execPath,['scripts/recover-rehearsal-report-inputs.js',path,'--part','check-suite'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:20000});assert.equal(actual.status,0,actual.stderr);assert.equal(actual.stdout,encodeRehearsalCheckSuite(suite));
  for(const [args,status]of [[[path],1],[[path,'--sha256','0'.repeat(64)],1],[[path,'--part','check-suite','--part','check-suite'],1],[[path,'--part','bad'],1],[[path,'--part','check-suite','--sha256','0'.repeat(64)],2],[[path,'--part','workspace-before'],2]]){const result=await run(args);assert.equal(result.status,status,result.err);assert.equal(result.out,'');assert.ok(result.err.length);}
  const altered=JSON.parse(scenarios[3].text);altered.summary.allMatched=true;await writeFile(path,JSON.stringify(altered));const refused=await run([path,'--part','check-suite']);assert.equal(refused.status,2);assert.equal(refused.out,'');
 }finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('threecore-reviewed-parts-'));await rm(dir,{recursive:true,force:true});}
});
