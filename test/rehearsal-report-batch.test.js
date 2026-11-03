import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {createHash,webcrypto} from 'node:crypto';import {syncBuiltinESMExports} from 'node:module';import {tmpdir} from 'node:os';import {join,resolve,dirname,basename} from 'node:path';import {spawnSync} from 'node:child_process';
import {reviewRehearsalReportBatch,encodeRehearsalBatchReview,REHEARSAL_BATCH_LIMITS} from '../scripts/rehearsal-report-batch.js';
import {runRehearsalBatchReview} from '../scripts/verify-rehearsal-report-batch.js';
import {rehearsalExampleV2} from '../src/operation-rehearsal-examples.js';import {REHEARSAL_WORKSPACE_SCHEMA} from '../src/operation-rehearsal-workspace.js';import {encodeRehearsalOverview} from '../src/operation-rehearsal-overview.js';
import {REHEARSAL_SCENARIO_SET_SCHEMA} from '../src/operation-rehearsal-scenario-set.js';import {captureRehearsalCheckSuite,encodeRehearsalCheckReport} from '../src/operation-rehearsal-check-suite.js';
const hash=value=>createHash('sha256').update(value).digest('hex'),line=(name,text)=>hash(text)+'  '+name;
const input={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:'DAT',ledgers:[rehearsalExampleV2()]},source=encodeRehearsalOverview(input);
async function fixture(action){const parent=await fs.realpath(tmpdir()),dir=await fs.mkdtemp(join(parent,'threecore-report-batch-')),root=join(dir,'reports'),manifest=join(root,'SHA256SUMS.txt');await fs.mkdir(root);
 try{await action({dir,root,manifest,save:async(name,text)=>{const path=join(root,name);await fs.writeFile(path,text);return path;}});}
 finally{assert.equal(dirname(resolve(dir)),parent);assert.ok(basename(dir).startsWith('threecore-report-batch-'));assert.equal(await fs.realpath(dir),resolve(dir));await fs.rm(dir,{recursive:true,force:true});}}
async function run(args){let output='',errors='';const code=await runRehearsalBatchReview(args,{write:v=>{output+=v;}},{write:v=>{errors+=v;}});return{code,output,errors};}

test('batch preserves exact Unicode and CRLF report bytes and exposes immutable review receipts',()=>fixture(async({root,manifest,save})=>{
 const text=' \r\n'+source.replaceAll('\n','\r\n'),path=await save('日本語の資料.json',text),manifestText='\uFEFF'+line('日本語の資料.json',text)+'\r\n';await fs.writeFile(manifest,manifestText);
 const result=await reviewRehearsalReportBatch(manifest);assert.equal(result.allChecksumsAndRecomputationsMatch,true);assert.equal(result.summary.matched,1);assert.equal(result.files[0].review.sha256,hash(text));assert.equal(result.files[0].review.checksumMatches,true);assert.equal(result.manifestSha256,hash(manifestText));
 assert.equal(result.readOnly,true);assert.equal(result.authenticatesOrigin,false);assert.ok(Object.isFrozen(result.files[0]));assert.equal(result.summary.readBytes,Buffer.byteLength(text));
 assert.equal(await fs.readFile(path,'utf8'),text);assert.equal(await fs.readFile(manifest,'utf8'),manifestText);assert.deepEqual((await fs.readdir(root)).sort(),['SHA256SUMS.txt','日本語の資料.json']);
 assert.equal(Object.hasOwn(result.files[0],'sourceText'),false);
}));
test('mixed batch retains recomputation differences, byte mismatches, unsupported and missing files separately',()=>fixture(async({manifest,save})=>{
 const changed=JSON.parse(source);changed.authorizesExecution=true;const changedText=JSON.stringify(changed),values=[['good.json',source],['different.json',changedText],['wrong-hash.json',source],['unsupported.json','{}']];
 for(const[name,text]of values)await save(name,text);await fs.writeFile(manifest,[...values.map(([name,text])=>line(name,name==='wrong-hash.json'?'expected other bytes':text)),line('missing.json','')].join('\n'));
 const result=await reviewRehearsalReportBatch(manifest);assert.deepEqual(result.files.map(row=>row.status),['matched','different','checksum-mismatch','unsupported','unreadable']);
 assert.equal(result.files[1].review.matchesRecomputation,false);assert.equal(Object.hasOwn(result.files[2],'review'),false);assert.equal(result.files[4].code,'FILE_MISSING');
 assert.equal(result.allChecksumsAndRecomputationsMatch,false);assert.equal(result.summary.different,1);assert.equal(result.summary.checksumMismatched,1);assert.equal(result.summary.unsupported,1);assert.equal(result.summary.unreadable,1);
 const cli=await run([manifest]);assert.equal(cli.code,2);assert.equal(JSON.parse(cli.output).summary.files,5);
}));
test('faithful reports with failed expectations are counted without being called successful expected outcomes',()=>fixture(async({manifest,save})=>{
 const before=rehearsalExampleV2(),cases={schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:'one',label:'manual baseline',before,after:before}]};
 const suite=structuredClone(captureRehearsalCheckSuite(cases));suite.expectationOrigin='manually-specified';suite.expected[0].before.metrics.cash='999';const text=encodeRehearsalCheckReport(suite);
 await save('failed-expectation.json',text);await fs.writeFile(manifest,line('failed-expectation.json',text));const result=await reviewRehearsalReportBatch(manifest);
 assert.equal(result.allChecksumsAndRecomputationsMatch,true);assert.equal(result.summary.reportsWithFailedExpectations,1);assert.equal(result.files[0].review.reportOutcome.allMatched,false);
 assert.ok(encodeRehearsalBatchReview(result,'csv').includes('"true","false"\r\n'));
}));
test('batch limits cannot be widened and executable options are never observed',async()=>{
 let observed=0;for(const options of [null,[],{unknown:1},{maxReports:51},{maxReports:0},{maxReportBytes:REHEARSAL_BATCH_LIMITS.maxReportBytes+1},{maxTotalBytes:-1},{get maxReports(){observed++;return 1;}}])await assert.rejects(reviewRehearsalReportBatch('unread',options),{code:'INVALID_BATCH_LIMITS'});
 assert.equal(observed,0);
});
test('per-file and total byte budgets preserve completed earlier reviews',()=>fixture(async({manifest,save})=>{
 await save('one.json',source);await save('two.json',source);await fs.writeFile(manifest,[line('one.json',source),line('two.json',source)].join('\n'));
 let result=await reviewRehearsalReportBatch(manifest,{maxTotalBytes:Buffer.byteLength(source)});assert.deepEqual(result.files.map(row=>row.code??row.status),['matched','TOTAL_SIZE_LIMIT']);assert.equal(result.summary.readBytes,Buffer.byteLength(source));
 result=await reviewRehearsalReportBatch(manifest,{maxReportBytes:10});assert.ok(result.files.every(row=>row.code==='FILE_SIZE_LIMIT'));assert.equal(result.summary.readBytes,0);
 result=await reviewRehearsalReportBatch(manifest,{maxTotalBytes:0});assert.equal(result.summary.readBytes,0);assert.equal(result.summary.admittedBytes,0);
}));
test('non-JSON paths, too many reports and unsafe manifest names fail before producing a batch',()=>fixture(async({manifest})=>{
 for(const [text,code]of [[line('sample.log',source),'REPORT_JSON_REQUIRED'],[Array.from({length:51},(_,i)=>line('r'+i+'.json',source)).join('\n'),'BATCH_ENTRY_LIMIT'],[line('../outside.json',source),'MANIFEST_PATH'],[[line('A.json',source),line('a.json',source)].join('\n'),'MANIFEST_DUPLICATE_PATH']]){
  await fs.writeFile(manifest,text);await assert.rejects(reviewRehearsalReportBatch(manifest),{code});const cli=await run([manifest]);assert.equal(cli.code,1);assert.equal(cli.output,'');
 }
}));
test('outside junctions and both path and physical aliases cannot receive multiple successful reviews',()=>fixture(async({dir,root,manifest,save})=>{
 const outside=join(dir,'outside'),inside=join(root,'inside');await fs.mkdir(outside);await fs.mkdir(inside);await fs.writeFile(join(outside,'private.json'),source);await fs.writeFile(join(inside,'report.json'),source);
 await fs.symlink(outside,join(root,'external'),process.platform==='win32'?'junction':'dir');await fs.symlink(inside,join(root,'alias'),process.platform==='win32'?'junction':'dir');await fs.link(join(inside,'report.json'),join(root,'hardlink.json'));
 await fs.writeFile(manifest,['external/private.json','inside/report.json','alias/report.json','hardlink.json'].map(name=>line(name,source)).join('\n'));
 const result=await reviewRehearsalReportBatch(manifest);assert.deepEqual(result.files.map(row=>row.code??row.status),['OUTSIDE_EVIDENCE_DIRECTORY','matched','FILE_ALIAS_DUPLICATE','FILE_ALIAS_DUPLICATE']);
 assert.equal(result.files[0].actualSha256,null);assert.equal(result.files[0].byteLength,null);assert.equal(await fs.readFile(join(outside,'private.json'),'utf8'),source);
}));
test('directories, empty files, malformed UTF8 and self-reference never become valid report reviews',()=>fixture(async({root,save})=>{
 const manifest=join(root,'manifest.json');await fs.mkdir(join(root,'folder.json'));await save('empty.json','');await save('utf8.json',Uint8Array.from([255]));await save('bad.json','{');
 await fs.writeFile(manifest,[line('folder.json',''),line('empty.json',''),line('utf8.json',Uint8Array.from([255])),line('bad.json','{'),line('manifest.json','')].join('\n'));
 const result=await reviewRehearsalReportBatch(manifest);assert.deepEqual(result.files.map(row=>row.code),['FILE_NOT_REGULAR','FILE_SIZE_LIMIT','INVALID_UTF8','INVALID_REVIEW_REPORT','MANIFEST_SELF_REFERENCE']);assert.equal(result.summary.matched,0);
}));
test('JSON and formula-safe CSV commands reproduce owned results and refuse copied result objects',()=>fixture(async({manifest,save})=>{
 await save('=SUM(1).json',source);await fs.writeFile(manifest,line('=SUM(1).json',source));const report=await reviewRehearsalReportBatch(manifest);
 for(const format of ['json','csv']){const result=await run([manifest,'--format',format]);assert.equal(result.code,0,result.errors);assert.equal(result.output,encodeRehearsalBatchReview(report,format));}
 const csv=encodeRehearsalBatchReview(report,'csv');assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=SUM(1).json"'));assert.ok(csv.endsWith('\r\n'));
 for(const value of [{...report},JSON.parse(JSON.stringify(report)),null])assert.throws(()=>encodeRehearsalBatchReview(value),{code:'INVALID_BATCH_RESULT'});
 const cli=spawnSync(process.execPath,['scripts/verify-rehearsal-report-batch.js',manifest],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:20000});assert.equal(cli.status,0,cli.stderr);assert.equal(cli.stdout,encodeRehearsalBatchReview(report));
 for(const args of [[],[manifest,'--write'],[manifest,'--format','xml'],[manifest,'--format','json','--format','csv']]){const result=await run(args);assert.equal(result.code,1);assert.equal(result.output,'');}
}));
test('a report modified during asynchronous hashing is rejected after recomputation',t=>fixture(async({manifest,save})=>{
 const path=await save('report.json',source);await fs.writeFile(manifest,line('report.json',source));const original=webcrypto.subtle.digest.bind(webcrypto.subtle);
 const mock=t.mock.method(webcrypto.subtle,'digest',async(...args)=>{const result=await original(...args);await fs.writeFile(path,source.replace('1000000000','9000000000'));return result;});
 try{const result=await reviewRehearsalReportBatch(manifest);assert.equal(result.files[0].code,'FILE_CHANGED');assert.equal(result.allChecksumsAndRecomputationsMatch,false);}finally{mock.mock.restore();}
}));
test('a changing manifest suppresses the entire batch output',t=>fixture(async({manifest,save})=>{
 await save('report.json',source);await fs.writeFile(manifest,line('report.json',source));const original=webcrypto.subtle.digest.bind(webcrypto.subtle);
 const mock=t.mock.method(webcrypto.subtle,'digest',async(...args)=>{const result=await original(...args);await fs.appendFile(manifest,'\n');return result;});
 try{const result=await run([manifest]);assert.equal(result.code,1);assert.equal(result.output,'');assert.match(result.errors,/MANIFEST_CHANGED/);}finally{mock.mock.restore();}
}));
for(const fault of ['replaced-before-read','changed-after-read','growth','invalid-read-count','read-error'])test('opened report '+fault+' is refused and its owned handle is closed',t=>fixture(async({manifest,save})=>{
 const path=await save('report.json',source);await fs.writeFile(manifest,line('report.json',source));const info=await fs.lstat(path,{bigint:true}),original=fs.open.bind(fs),bytes=Buffer.from(source);let stats=0,reads=0,closed=0;
 const handle={async stat(){stats++;return{...info,isFile:()=>true,mtimeNs:info.mtimeNs+((fault==='replaced-before-read'||fault==='changed-after-read'&&stats>1)?1n:0n)};},
  async read(target,offset,length,position){reads++;if(fault==='read-error')throw Error('private raw details');if(fault==='invalid-read-count')return{bytesRead:length+1};if(position===bytes.length)return{bytesRead:fault==='growth'?1:0};const size=Math.min(length,bytes.length-position);target.set(bytes.subarray(position,position+size),offset);return{bytesRead:size};},async close(){closed++;}};
 const mock=t.mock.method(fs,'open',async(file,...args)=>resolve(file)===resolve(path)?handle:original(file,...args));syncBuiltinESMExports();
 try{const result=await reviewRehearsalReportBatch(manifest);assert.equal(result.files[0].status,'unreadable');assert.equal(closed,1);if(fault==='replaced-before-read')assert.equal(reads,0);assert.ok(!JSON.stringify(result).includes('private raw details'));}
 finally{mock.mock.restore();syncBuiltinESMExports();}
}));
