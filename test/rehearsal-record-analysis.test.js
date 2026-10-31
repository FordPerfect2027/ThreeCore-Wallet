import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve,dirname,basename} from 'node:path';
import {rehearsalExampleV2} from '../src/operation-rehearsal-examples.js';
import {encodeRehearsal,decodeRehearsal} from '../src/operation-rehearsal.js';
import {REHEARSAL_WORKSPACE_SCHEMA,encodeRehearsalWorkspace} from '../src/operation-rehearsal-workspace.js';
import {indexRehearsalRecords,summarizeRehearsalRecords,encodeRehearsalRecordSummary,rehearsalRecordSummaryCsv,reportRehearsalRecordPrefix,encodeRehearsalRecordPrefix,extractRehearsalRecordPrefix,REHEARSAL_SUMMARY_QUERY} from '../src/operation-rehearsal-records.js';
import {reviewRehearsalReport,exportReviewedRehearsalWorkspace,exportReviewedRehearsalPart,encodeRehearsalReviewEvidence,reviewRehearsalEvidence} from '../src/operation-rehearsal-report-review.js';
import {describeRehearsalFileTarget} from '../src/file-read-status.js';
import {inspectRehearsalRecords} from '../scripts/inspect-rehearsal-records.js';import {inspectRehearsalPrefix} from '../scripts/inspect-rehearsal-prefix.js';
const workspace=(...ledgers)=>({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:'DAT',ledgers});
const sample=()=>{const dat=rehearsalExampleV2();return workspace({...dat,events:[...dat.events,{...dat.events[1],id:'foreign',account:'0x'+'9'.repeat(40)}]},rehearsalExampleV2('EMA','pending'));};
test('record summary preserves per-agent changes and distinguishes missing input from no matches',()=>{
 const source=sample(),index=indexRehearsalRecords(source),report=summarizeRehearsalRecords(index);
 assert.equal(report.matchedRecords,4);assert.equal(report.rows[0].balanceChanges.cash,'28000000');assert.equal(report.rows[0].acceptedFeeUnits,'2000000');
 assert.equal(report.rows[0].acceptedRecords,2);assert.equal(report.rows[0].rejectedRecords,1);assert.equal(report.rows[1].balanceChanges.cash,'-101000000');assert.equal(report.rows[1].balanceChanges.realizedPnl,'-1000000');
 assert.equal(report.rows[2].present,false);assert.equal(report.rows[2].balanceChanges.cash,null);assert.equal(report.rows[2].acceptedFeeUnits,null);
 const noMatches=summarizeRehearsalRecords(index,{...REHEARSAL_SUMMARY_QUERY,search:'no-match'});assert.equal(noMatches.rows[0].balanceChanges.cash,'0');assert.equal(noMatches.rows[2].balanceChanges.cash,null);
 assert.ok(Object.isFrozen(report.rows[0].balanceChanges));assert.throws(()=>summarizeRehearsalRecords({...index}));
});
test('filtered summary counts only matched record contributions and keeps multi-reason counts independent',()=>{
 const index=indexRehearsalRecords(sample()),settled=summarizeRehearsalRecords(index,{...REHEARSAL_SUMMARY_QUERY,kind:'settle',decision:'accepted'});
 assert.equal(settled.matchedRecords,1);assert.equal(settled.rows[0].balanceChanges.cash,'129000000');assert.equal(settled.rows[0].balanceChanges.realizedPnl,'29000000');assert.deepEqual(settled.rows[0].recordKeys,['DAT:settle-one']);
 const denied=summarizeRehearsalRecords(index,{...REHEARSAL_SUMMARY_QUERY,reason:'WRONG_ACCOUNT'});assert.equal(denied.matchedRecords,1);assert.equal(denied.rows[0].acceptedFeeUnits,'0');assert.equal(denied.rows[0].balanceChanges.cash,'0');assert.deepEqual(denied.rows[0].reasonCounts,[{reason:'WRONG_ACCOUNT',records:1}]);
 const bad=structuredClone(rehearsalExampleV2());bad.events=[{...bad.events[0],agent:'EMA',chainId:8453,account:'0x'+'9'.repeat(40)}];const multi=summarizeRehearsalRecords(indexRehearsalRecords(workspace(bad)));
 assert.equal(multi.rows[0].rejectedRecords,1);assert.equal(multi.rows[0].reasonCounts.length,3);
});
test('summary exact large integers and CSV missing values survive without floating-point conversion',()=>{
 const source=structuredClone(rehearsalExampleV2('DAT','deposit'));source.events[0].amount='900719925474099312345';const input=workspace(source),report=summarizeRehearsalRecords(indexRehearsalRecords(input));
 assert.equal(report.rows[0].balanceChanges.cash,source.events[0].amount);const csv=rehearsalRecordSummaryCsv(input);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.endsWith('\r\n'));
 const rows=csv.slice(1,-2).split('\r\n').map(line=>JSON.parse('['+line+']'));assert.equal(rows.length,4);const cash=rows[0].indexOf('cashChangeUnits');assert.equal(rows[1][cash],source.events[0].amount);assert.equal(rows[2][cash],'');
});
test('prefix includes every earlier record despite search scope and excludes later settlements and other agents',()=>{
 const input=sample(),index=indexRehearsalRecords(input),prefix=reportRehearsalRecordPrefix(index,'DAT:open-one');assert.equal(prefix.includedRecords,1);assert.equal(prefix.omittedLaterRecords,2);assert.equal(prefix.sourceRecords,3);
 assert.equal(prefix.result.openPositions,1);assert.equal(prefix.result.realizedPnl,'-1000000');assert.equal(prefix.prefix.agent,'DAT');assert.deepEqual(prefix.prefix.events,[input.ledgers[0].events[0]]);
 const last=reportRehearsalRecordPrefix(index,'DAT:foreign');assert.equal(last.includedRecords,3);assert.equal(last.result.rows.at(-1).withinEnteredLimits,false);assert.equal(last.omittedLaterRecords,0);
 assert.equal(extractRehearsalRecordPrefix(input,'DAT:foreign'),encodeRehearsal(input.ledgers[0]));assert.equal(decodeRehearsal(extractRehearsalRecordPrefix(input,'EMA:open-one')).agent,'EMA');
 assert.throws(()=>reportRehearsalRecordPrefix(index,'CAWELON:open-one'));assert.throws(()=>reportRehearsalRecordPrefix({...index},'DAT:open-one'));
});
test('summary and prefix reports independently recompute, reveal tampering and route to the report panel',async()=>{
 const input=sample();for(const text of [encodeRehearsalRecordSummary(input),encodeRehearsalRecordPrefix(input,'DAT:open-one')]){
  const receipt=await reviewRehearsalReport(text);assert.equal(receipt.matchesRecomputation,true);assert.equal(describeRehearsalFileTarget(text,'report'),null);assert.match(describeRehearsalFileTarget(text,'workspace'),/資料を再計算して確認/);
  const evidence=await reviewRehearsalEvidence(encodeRehearsalReviewEvidence(receipt));assert.equal(evidence.reportReview.matchesRecomputation,true);
  const changed=JSON.parse(text);if(changed.rows)changed.rows[0].balanceChanges.cash='999';else changed.prefix.events=[];assert.equal((await reviewRehearsalReport(JSON.stringify(changed))).matchesRecomputation,false);
  if(receipt.reportOutcome.kind==='record-summary')assert.equal(exportReviewedRehearsalWorkspace(receipt),encodeRehearsalWorkspace(input));
  else assert.equal(exportReviewedRehearsalPart(receipt,'record-prefix').text,extractRehearsalRecordPrefix(input,'DAT:open-one'));
 }
});
test('summary and prefix commands reproduce exports, refuse invalid flags and never change the source',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'threecore-record-analysis-')),path=join(dir,'workspace.json'),input=sample(),text=encodeRehearsalWorkspace(input);
 const run=async(fn,args)=>{let out='',err='';const code=await fn(args,{write:v=>{out+=v;}},{write:v=>{err+=v;}});return{out,err,code};};
 try{await writeFile(path,text);for(const format of ['json','csv']){const result=await run(inspectRehearsalRecords,[path,'--view','summary','--kind','settle','--format',format]);assert.equal(result.code,0,result.err);assert.equal(result.out,(format==='json'?encodeRehearsalRecordSummary:rehearsalRecordSummaryCsv)(input,{...REHEARSAL_SUMMARY_QUERY,kind:'settle'}));}
  for(const format of ['report','input']){const result=await run(inspectRehearsalPrefix,[path,'DAT:open-one','--format',format]);assert.equal(result.code,0,result.err);assert.equal(result.out,(format==='report'?encodeRehearsalRecordPrefix:extractRehearsalRecordPrefix)(input,'DAT:open-one'));}
  for(const [fn,args]of [[inspectRehearsalRecords,[path,'--view','all']],[inspectRehearsalRecords,[path,'--view','summary','--view','summary']],[inspectRehearsalPrefix,[path,'DAT:missing']],[inspectRehearsalPrefix,[path,'DAT:open-one','--format','csv']]]){const result=await run(fn,args);assert.equal(result.code,1);assert.equal(result.out,'');assert.ok(result.err);}
  assert.equal(await readFile(path,'utf8'),text);
 }finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('threecore-record-analysis-'));await rm(dir,{recursive:true,force:true});}
});
