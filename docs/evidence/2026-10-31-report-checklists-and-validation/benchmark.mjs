import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(process.argv[2]),destination=process.argv[3];
const imp=path=>import(pathToFileURL(resolve(root,path)).href);
const {demoSetHistory,sequenceSet}=await imp('test/helpers/report-set-fixtures.js');
const {validatePeriodDraft}=await imp('src/period-draft.js');
const {validatePeriodReportInput}=await imp('src/period-report-model.js');
const {validateReportHistory}=await imp('src/report-history-model.js');
const {validateReportSet}=await imp('src/report-set-model.js');
const {querySetDiagnostics}=await imp('src/report-set-diagnostics.js');
const {reportSetDiagnosticsCSV}=await imp('src/report-set-export.js');
const history=demoSetHistory(),set=sequenceSet(history),report=set.entries[0].report,draft=report.slots[0].entry.draft;
const rows=[];
for(const [name,run,iterations] of [
 ['period-draft',()=>validatePeriodDraft(draft),20],['period-report',()=>validatePeriodReportInput(report),10],
 ['report-history',()=>validateReportHistory(history),3],['report-set',()=>validateReportSet(set),3],
 ['filtered-diagnostics',()=>querySetDiagnostics(set,{severity:'conflict'}),1],
 ['filtered-checklist-csv',()=>reportSetDiagnosticsCSV(set,{severity:'conflict'}),1],
]){
 const reference=JSON.stringify(run()),times=[];let result;
 for(let sample=0;sample<3;sample++){const started=performance.now();for(let i=0;i<iterations;i++)result=run();times.push((performance.now()-started)/iterations);}
 if(JSON.stringify(result)!==reference)throw Error('Nondeterministic result');
 rows.push({name,iterations,samples:times,medianMs:[...times].sort((a,b)=>a-b)[1],resultSha256:createHash('sha256').update(reference).digest('hex')});
}
const data={source:execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim(),runtime:process.version,platform:process.platform,syntheticReports:history.entries.length,rows};
writeFileSync(destination,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data));
