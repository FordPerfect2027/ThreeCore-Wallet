import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(process.argv[2]),destination=process.argv[3];
const imp=path=>import(pathToFileURL(resolve(root,path)).href);
const {scenario,workspace,event,record,archive,hash,ACCOUNT,OTHER}=await imp('test/helpers/reconciliation-fixtures.js');
const {validateTransferSnapshot}=await imp('src/transfer-codec.js');
const {validateTransferArchive,describeTransferArchive}=await imp('src/transfer-archive.js');
const {validateReconciliationWorkspace}=await imp('src/reconciliation-model.js');
const {validateTokenObservation}=await imp('src/token-identity-model.js');
const {queryReconciliationEvents}=await imp('src/reconciliation-query.js');
const {vaultActivityCsv}=await imp('src/transfer-vault-analytics.js');
const {vaultBundle}=await imp('src/transfer-vault-model.js');
const records=Array.from({length:10},(_,window)=>{
 const block=31+window;return record(block,block,Array.from({length:50},(_,index)=>event({blockNumber:String(block),blockHash:hash(block),transactionHash:hash(10000+window*100+index),transactionIndex:String(index),logIndex:String(index),from:OTHER,to:ACCOUNT,amountBaseUnits:'1'},index)));
});
const stored=archive(records),slot=scenario();slot.archive=stored;const input=workspace([slot]),observation=validateTokenObservation(slot.earlier),snapshot=validateTransferSnapshot(records[0]);
const rows=[];
for(const [name,run,iterations] of [
 ['snapshot',()=>validateTransferSnapshot(snapshot),5],['archive',()=>validateTransferArchive(stored),3],
 ['reconciliation-workspace',()=>validateReconciliationWorkspace(input),3],['observation',()=>validateTokenObservation(observation),20],
 ['archive-summary',()=>describeTransferArchive(stored),3],
 ['reconciliation-query',()=>queryReconciliationEvents(input,{agent:'DAT',direction:'incoming',search:'',page:5}),1],
]){
 const reference=JSON.stringify(run()),times=[];let result;
 for(let sample=0;sample<3;sample++){const started=performance.now();for(let i=0;i<iterations;i++)result=run();times.push((performance.now()-started)/iterations);}
 if(JSON.stringify(result)!==reference)throw Error('Nondeterministic result');
 rows.push({name,iterations,samples:times,medianMs:[...times].sort((a,b)=>a-b)[1],resultSha256:createHash('sha256').update(reference).digest('hex')});
}
const files=['src/transfer-codec.js','src/transfer-archive.js','src/reconciliation-model.js','src/token-identity-model.js'];
const data={source:execFileSync('git',['rev-parse','--short','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
 sourceFiles:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')])),
 runtime:process.version,platform:process.platform,syntheticWindows:10,syntheticEvents:500,rows};
writeFileSync(destination,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data));
