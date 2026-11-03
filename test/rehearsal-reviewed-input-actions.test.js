import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve,dirname,basename} from 'node:path';
import {rehearsalExampleV2} from '../src/operation-rehearsal-examples.js';
import {encodeRehearsal} from '../src/operation-rehearsal.js';
import {REHEARSAL_WORKSPACE_SCHEMA,encodeRehearsalWorkspace} from '../src/operation-rehearsal-workspace.js';
import {encodeRehearsalRecordReport,REHEARSAL_RECORD_QUERY} from '../src/operation-rehearsal-records.js';
import {encodeRehearsalComparison} from '../src/operation-rehearsal-comparison.js';
import {reviewRehearsalReport,exportReviewedRehearsalAgent,compareReviewedRehearsalWorkspace} from '../src/operation-rehearsal-report-review.js';
import {recoverRehearsalWorkspace} from '../scripts/recover-rehearsal-workspace.js';

const input={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:'EMA',ledgers:[rehearsalExampleV2(),{...rehearsalExampleV2('EMA'),events:[]}]};
const source=encodeRehearsalRecordReport(input,{...REHEARSAL_RECORD_QUERY,agent:'DAT'});
test('agent extraction includes filtered-out empty inputs without manufacturing an absent agent',async()=>{
 const receipt=await reviewRehearsalReport(source);
 assert.equal(exportReviewedRehearsalAgent(receipt,'DAT'),encodeRehearsal(input.ledgers[0]));
 assert.equal(exportReviewedRehearsalAgent(receipt,'EMA'),encodeRehearsal(input.ledgers[1]));
 assert.throws(()=>exportReviewedRehearsalAgent(receipt,'CAWELON'),e=>e.code==='REVIEW_AGENT_MISSING');
 let coerced=0;for(const agent of ['dat','all','',null,{toString(){coerced++;return 'DAT';}}])assert.throws(()=>exportReviewedRehearsalAgent(receipt,agent),e=>e.code==='INVALID_REVIEW_AGENT');
 assert.equal(coerced,0);assert.equal(encodeRehearsalRecordReport(input,{...REHEARSAL_RECORD_QUERY,agent:'DAT'}),source);
});
test('reviewed comparison has explicit current-to-report direction and retains distinct accounting contexts',async()=>{
 const dat=structuredClone(rehearsalExampleV2('DAT','loss'));dat.account='0x'+'9'.repeat(40);
 const current={...input,activeAgent:'CAWELON',ledgers:[dat,rehearsalExampleV2('CAWELON','pending')]},before=JSON.stringify(current);
 const receipt=await reviewRehearsalReport(source),comparison=compareReviewedRehearsalWorkspace(receipt,current);
 assert.equal(encodeRehearsalWorkspace(comparison.inputs.before),encodeRehearsalWorkspace(current));
 assert.equal(encodeRehearsalWorkspace(comparison.inputs.after),encodeRehearsalWorkspace(input));
 assert.equal(comparison.selectedAgentChanged,true);assert.deepEqual(comparison.rows.map(r=>r.action),['replaced','added','removed']);
 assert.equal(comparison.rows[0].sameAccountingContext,false);assert.equal(JSON.stringify(current),before);
 const checked=await reviewRehearsalReport(encodeRehearsalComparison(comparison.inputs.before,comparison.inputs.after));
 assert.equal(checked.matchesRecomputation,true);assert.equal(checked.authorizesExecution,false);
});
test('both reviewed input actions require an owned faithful unambiguous receipt',async()=>{
 const good=await reviewRehearsalReport(source),changed=JSON.parse(source);changed.matchedRecords=999;
 for(const receipt of [{...good},null,await reviewRehearsalReport(JSON.stringify(changed)),await reviewRehearsalReport(source,{expectedSha256:'0'.repeat(64)}),await reviewRehearsalReport(encodeRehearsalComparison(input,input))]){
  assert.throws(()=>exportReviewedRehearsalAgent(receipt,'DAT'),e=>e.code==='REVIEW_WORKSPACE_UNAVAILABLE');
  assert.throws(()=>compareReviewedRehearsalWorkspace(receipt,input),e=>e.code==='REVIEW_WORKSPACE_UNAVAILABLE');
 }
 assert.throws(()=>compareReviewedRehearsalWorkspace(good,{...input,ledgers:[input.ledgers[0],input.ledgers[0]]}));
});
test('agent recovery CLI validates explicit selection and checksum flags and emits no partial refusals',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'threecore-reviewed-agent-')),path=join(dir,'report.json');
 const run=async args=>{let out='',err='';const status=await recoverRehearsalWorkspace(args,{write:v=>{out+=v;}},{write:v=>{err+=v;}});return{status,out,err};};
 try{await writeFile(path,source);const receipt=await reviewRehearsalReport(source);
  for(const flags of [[],['--agent','EMA'],['--agent','EMA','--sha256',receipt.sha256],['--sha256',receipt.sha256.toUpperCase(),'--agent','EMA']]){
   const result=await run([path,...flags]);assert.equal(result.status,0,result.err);assert.equal(result.out,flags.length?encodeRehearsal(input.ledgers[1]):encodeRehearsalWorkspace(input));
  }
  for(const [flags,code]of [[['--agent','CAWELON'],2],[['--agent','EMA','--sha256','0'.repeat(64)],2],[['--agent','ema'],1],[['--agent','EMA','--agent','DAT'],1],[['--sha256',receipt.sha256,'--sha256',receipt.sha256],1],[['--agent'],1],[['--token','EMA'],1]]){
   const result=await run([path,...flags]);assert.equal(result.status,code,result.err);assert.equal(result.out,'');assert.ok(result.err.length);
  }
  assert.equal(await readFile(path,'utf8'),source);
 }finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('threecore-reviewed-agent-'));await rm(dir,{recursive:true,force:true});}
});
