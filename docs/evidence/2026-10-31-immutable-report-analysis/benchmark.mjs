import {resolve,join} from 'node:path';import {pathToFileURL} from 'node:url';import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {performance} from 'node:perf_hooks';
const root=resolve(process.argv[2]),destination=process.argv[3],imp=p=>import(pathToFileURL(join(root,p)).href);
if(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())throw Error('Benchmark requires a clean source checkout');
const source=execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const {sequenceSet,demoSetHistory}=await imp('test/helpers/report-set-fixtures.js');const input=sequenceSet(demoSetHistory());
const {analyzePeriodReport}=await imp('src/period-report-engine.js');const {analyzeReportSet}=await imp('src/report-set-engine.js');
const {reportSetTimeline,reportSetMissingHistoryQueue}=await imp('src/report-set-timeline.js');
const {querySetDiagnostics}=await imp('src/report-set-diagnostics.js');const {reportSetHTML}=await imp('src/report-set-export.js');
const cases=[['period-analysis',()=>analyzePeriodReport(input.entries[0].report)],['set-analysis',()=>analyzeReportSet(input)],['timeline',()=>reportSetTimeline(input)],['missing-queue',()=>reportSetMissingHistoryQueue(input,{groupId:'CAWELON-1'})],['check-search',()=>querySetDiagnostics(input,{severity:'conflict'})],['html-export',()=>reportSetHTML(input)]];
const rows=[];
for(const[name,run]of cases){
 for(let i=0;i<2;i++)run();const samples=[];let result;
 for(let i=0;i<15;i++){const start=performance.now();result=run();samples.push(performance.now()-start);}
 const sorted=[...samples].sort((a,b)=>a-b),text=JSON.stringify(result);
 rows.push({name,iterations:samples.length,medianMs:sorted[Math.floor(sorted.length/2)],meanMs:samples.reduce((a,b)=>a+b,0)/samples.length,minMs:sorted[0],maxMs:sorted.at(-1),outputBytes:Buffer.byteLength(text),outputSha256:createHash('sha256').update(text).digest('hex')});
}
const files=['src/period-report-engine.js','src/report-set-engine.js','src/report-set-timeline.js'];
const result={source,node:process.version,platform:process.platform,arch:process.arch,synthetic:true,workload:'Seven canonical immutable report snapshots including duplicates, gaps, archived partial evidence and conflicts; two warmups then fifteen timed repetitions per operation; serialization/hash excluded from timings',sourceFiles:files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')})),rows};
writeFileSync(destination,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(rows));
