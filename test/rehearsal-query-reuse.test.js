import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve,dirname,basename} from 'node:path';import {spawnSync} from 'node:child_process';
import {rehearsalExampleV2} from '../src/operation-rehearsal-examples.js';import {REHEARSAL_WORKSPACE_SCHEMA,encodeRehearsalWorkspace} from '../src/operation-rehearsal-workspace.js';
import {encodeRehearsalOverview} from '../src/operation-rehearsal-overview.js';
import {encodeRehearsalRecordReport,encodeRehearsalContextRecordReport,encodeRehearsalReasonRecordReport,encodeRehearsalRecordSummary,rehearsalReasonRecordCsv,rehearsalRecordSummaryCsv,REHEARSAL_RECORD_QUERY} from '../src/operation-rehearsal-records.js';
import {reviewRehearsalReport,canReuseReviewedRehearsalQuery,extractReviewedRehearsalQuery} from '../src/operation-rehearsal-report-review.js';
import {replayRehearsalQuery} from '../scripts/replay-rehearsal-query.js';
const old={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:'DAT',ledgers:[rehearsalExampleV2(),rehearsalExampleV2('EMA')]};
const query={...REHEARSAL_RECORD_QUERY,agent:'EMA',kind:'settle'},modern={...query,searchScope:'stored',reason:'all'};
const sources=[encodeRehearsalRecordReport(old,query),encodeRehearsalContextRecordReport(old,{...query,searchScope:'both'}),encodeRehearsalReasonRecordReport(old,{...modern,reason:'WRONG_ACCOUNT'}),encodeRehearsalRecordSummary(old,{...modern,searchScope:'recorded'})];
test('verified query versions retain their original context scope and reason while returning criteria only',async()=>{
 for(let i=0;i<sources.length;i++){const receipt=await reviewRehearsalReport(sources[i]);assert.equal(canReuseReviewedRehearsalQuery(receipt),true);const extracted=extractReviewedRehearsalQuery(receipt);
  assert.deepEqual(extracted,{...modern,searchScope:['stored','both','stored','recorded'][i],reason:i===2?'WRONG_ACCOUNT':'all'});assert.ok(Object.isFrozen(extracted));assert.equal(Object.hasOwn(extracted,'inputs'),false);
 }
});
test('unsupported, copied and failed verification receipts cannot authorize query reuse',async()=>{
 const text=sources[0],receipt=await reviewRehearsalReport(text),changed=JSON.parse(text);changed.matchedRecords=99;
 let getters=0;for(const value of [{...receipt},JSON.parse(JSON.stringify(receipt)),{get matchesRecomputation(){getters++;return true;}},null,await reviewRehearsalReport(JSON.stringify(changed)),await reviewRehearsalReport(text,{expectedSha256:'0'.repeat(64)}),await reviewRehearsalReport(encodeRehearsalOverview(old))]){
  assert.equal(canReuseReviewedRehearsalQuery(value),false);assert.throws(()=>extractReviewedRehearsalQuery(value),e=>e.code==='REVIEW_QUERY_UNAVAILABLE');
 }assert.equal(getters,0);
});
test('offline query reuse reads current inputs, produces a valid zero result, and leaves both originals unchanged',async()=>{
 const current={...old,activeAgent:'EMA',ledgers:[rehearsalExampleV2('EMA','pending')]},dir=await mkdtemp(join(tmpdir(),'threecore-query-reuse-')),reportPath=join(dir,'query.json'),currentPath=join(dir,'current.json'),currentText=encodeRehearsalWorkspace(current);
 const run=async args=>{let out='',err='';const code=await replayRehearsalQuery(args,{write:v=>{out+=v;}},{write:v=>{err+=v;}});return{code,out,err};};
 try{await writeFile(reportPath,sources[0]);await writeFile(currentPath,currentText);const checked=await reviewRehearsalReport(sources[0]);
  for(const view of ['records','summary'])for(const format of ['json','csv']){
   const result=await run([reportPath,currentPath,'--format',format,'--sha256',checked.sha256.toUpperCase(),'--view',view]);assert.equal(result.code,0,result.err);
   const encode=view==='summary'?(format==='csv'?rehearsalRecordSummaryCsv:encodeRehearsalRecordSummary):(format==='csv'?rehearsalReasonRecordCsv:encodeRehearsalReasonRecordReport);assert.equal(result.out,encode(current,modern));
   if(format==='json'){const parsed=JSON.parse(result.out);assert.equal(parsed.matchedRecords,0);assert.deepEqual(parsed.inputs,current);assert.equal((await reviewRehearsalReport(result.out)).matchesRecomputation,true);}
  }
  const cli=spawnSync(process.execPath,['scripts/replay-rehearsal-query.js',reportPath,currentPath],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:20000});assert.equal(cli.status,0,cli.stderr);assert.equal(cli.stdout,encodeRehearsalReasonRecordReport(current,modern));
  for(const [args,code]of [[[reportPath,currentPath,'--view','all'],1],[[reportPath,currentPath,'--format','csv','--format','json'],1],[[reportPath,currentPath,'--sha256','0'.repeat(64)],2],[[reportPath,currentPath,'--format'],1]]){const result=await run(args);assert.equal(result.code,code,result.err);assert.equal(result.out,'');assert.ok(result.err);}
  assert.equal(await readFile(reportPath,'utf8'),sources[0]);assert.equal(await readFile(currentPath,'utf8'),currentText);
  await writeFile(reportPath,encodeRehearsalOverview(old));const unsupported=await run([reportPath,join(dir,'missing-current.json')]);assert.equal(unsupported.code,2);assert.equal(unsupported.out,'');assert.match(unsupported.err,/REVIEW_QUERY_UNAVAILABLE/);
 }finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('threecore-query-reuse-'));await rm(dir,{recursive:true,force:true});}
});
