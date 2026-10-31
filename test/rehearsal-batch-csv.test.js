import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {reviewRehearsalReportBatch,encodeRehearsalBatchCsv} from '../src/operation-rehearsal-report-review.js';
const text=readFileSync(new URL('../docs/evidence/2026-11-01-browser-report-batch/01-saved-report.json',import.meta.url),'utf8');
const hash=text=>createHash('sha256').update(text).digest('hex');
function rows(csv){assert(csv.startsWith('\ufeff'));assert(csv.endsWith('\r\n'));const [header,...values]=csv.slice(1,-2).split('\r\n').map(line=>line.slice(1,-1).split('","').map(v=>v.replaceAll('""','"')));return values.map(row=>Object.fromEntries(header.map((key,i)=>[key,row[i]])));}
test('CSV retains exact per-file hashes, unknown fields and whole batch scope',async()=>{
 const result=await reviewRehearsalReportBatch([{name:'元,資料.json',text},{name:'other.json',text:'{}'}]);const parsed=rows(encodeRehearsalBatchCsv(result));
 assert.equal(parsed.length,2);assert.equal(parsed[0].name,'元,資料.json');assert.equal(parsed[0].sha256,hash(text));assert.equal(parsed[0].differenceCount,'0');assert.equal(parsed[1].differenceCount,'');assert.equal(parsed[1].status,'unsupported');
 for(const row of parsed){assert.equal(row.selected,'2');assert.equal(row.pending,'0');assert.equal(row.simulationOnly,'true');assert.equal(row.sourceVerified,'false');assert.equal(row.authorizesExecution,'false');assert.equal(row.referenceProvided,'false');assert.equal(row.checksumMatches,'');assert.equal(row.allExternalChecksumsMatch,'');assert.equal(row.allRecomputationsMatch,'false');}
});
test('CSV differentiates mismatch from missing comparison and keeps expected values',async()=>{
 const manifest=hash(text)+'  a.json\n';const result=await reviewRehearsalReportBatch([{name:'a.json',text:text+'\n'}],{manifestText:manifest});const[row]=rows(encodeRehearsalBatchCsv(result));
 assert.equal(row.expectedSha256,hash(text));assert.equal(row.sha256,hash(text+'\n'));assert.equal(row.checksumMatches,'false');assert.equal(row.allExternalChecksumsMatch,'false');assert.equal(row.referenceSha256,hash(manifest));assert.equal(row.status,'checksum-mismatch');assert.equal(row.differenceCount,'');
});
test('partial CSV contains all pending filenames and never claims full completion',async()=>{
 const abort=new AbortController();const result=await reviewRehearsalReportBatch([{name:'a.json',text},{name:'b.json',text}],{signal:abort.signal,onProgress:p=>{if(p.reviewed===1)abort.abort();}});const parsed=rows(encodeRehearsalBatchCsv(result));
 for(const row of parsed){assert.equal(row.phase,'cancelled');assert.equal(row.complete,'false');assert.equal(row.selected,'2');assert.equal(row.reviewed,'1');assert.equal(row.pending,'1');assert.equal(row.allRecomputationsMatch,'false');}assert.equal(parsed[1].status,'pending');assert.equal(parsed[1].sha256,'');
});
for(const prefix of ['=','+','-','@'])test('CSV escapes spreadsheet formula filename '+prefix,async()=>{
 const result=await reviewRehearsalReportBatch([{name:prefix+'SUM(1,2).json',text}]);assert.equal(rows(encodeRehearsalBatchCsv(result))[0].name,"'"+prefix+'SUM(1,2).json');assert.equal(result.files[0].name,prefix+'SUM(1,2).json');
});
test('faithful reports with failed expectations remain distinguishable in CSV',async()=>{
 const dir=new URL('../docs/evidence/2026-11-01-browser-report-batch/',import.meta.url),prior=JSON.parse(readFileSync(new URL('browser-api-batch-review.json',dir),'utf8')),name=prior.files.find(row=>row.expectedOutcomes?.differing>0).name;
 const result=await reviewRehearsalReportBatch([{name,text:readFileSync(new URL(name,dir),'utf8')}]);const[row]=rows(encodeRehearsalBatchCsv(result));assert.equal(row.status,'matched');assert.equal(Number(row.expectationsDiffering),result.files[0].expectedOutcomes.differing);assert(Number(row.expectedCases)>0);
});
test('CSV refuses cloned or forged receipts',async()=>{const result=await reviewRehearsalReportBatch([{name:'a.json',text}]);for(const value of [null,{},JSON.parse(JSON.stringify(result))])assert.throws(()=>encodeRehearsalBatchCsv(value),{code:'UNRECOGNIZED_REVIEW_BATCH'});});
