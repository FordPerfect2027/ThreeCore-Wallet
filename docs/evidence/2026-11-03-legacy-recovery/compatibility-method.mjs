import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const repo='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029';
const revision='07041f00efdb503cb76a06fbe12e5531cb380930';
const root='C:/Users/aseet/Downloads/ThreeCore-public-checkpoint-07041f0-20261103';
const extracted='C:/Users/aseet/AppData/Local/Temp/threecore old source '+randomUUID();
const sha=b=>createHash('sha256').update(b).digest('hex');
const safeEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
async function run(executable,args,cwd=repo){return new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd,env:safeEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>child.kill(),120000);child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,out,err});});});}
await mkdir(root);await mkdir(extracted);const archive=join(root,'source.zip');
let proc=await run('git',['archive','--format=zip','--output='+archive,revision]);assert.equal(proc.code,0,proc.err);
proc=await run('tar.exe',['-xf',archive,'-C',extracted]);assert.equal(proc.code,0,proc.err);
const {verifySourceCheckpoint}=await import(pathToFileURL(join(repo,'scripts/verify-source-checkpoint.js')));
const source=await verifySourceCheckpoint(repo,revision,extracted);assert(source.allMatched);await writeFile(join(root,'source-verification.json'),JSON.stringify(source,null,2)+'\n');
const files=[{name:'mainnet-three-records',basename:'ThreeCore-workspace-backup (12).json'},{name:'sepolia-three-records',basename:'ThreeCore-workspace-backup (14).json'},{name:'latest-nine-records',basename:'ThreeCore-workspace-backup (19).json'}];
const observations=[];
for(const file of files){const path='C:/Users/aseet/Downloads/'+file.basename,original=await readFile(path);const result=await run(process.execPath,['scripts/check-workspace-backup.js','--file',path,'--json'],extracted);const current=await run(process.execPath,['scripts/check-workspace-backup.js','--file',path,'--json'],repo);assert.equal(current.code,0,current.err);const after=await readFile(path);assert.equal(sha(after),sha(original));observations.push({input:file.name,bytes:original.length,sha256:sha(original),oldExitCode:result.code,oldResult:result.code===0?JSON.parse(result.out):null,oldFailure:result.code!==0?result.err.trim():null,currentExitCode:current.code,currentResult:JSON.parse(current.out),inputUnchanged:true});}
const {createDemoServer}=await import(pathToFileURL(join(extracted,'examples/dev-server.js')));
const server=createDemoServer();const startup=[];let closed=false;
try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;for(const [path,file] of [['/','examples/index.html'],['/rehearsal/','examples/operation-rehearsal.html']]){const response=await fetch(origin+path);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(response.status,200);assert.equal(sha(bytes),sha(await readFile(join(extracted,file))));startup.push({path,status:response.status,sourceBytesMatch:true});}}finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));closed=true;}
const result={schema:'threecore.public-checkpoint-backup-compatibility.v1',recordedAt:new Date().toISOString(),oldPublicPrHead:revision,currentSource:'bf690f38b070362aab1369fbf22c8e68b1a6567f',sourceSummary:source.summary,sourceArchive:{bytes:(await readFile(archive)).length,sha256:sha(await readFile(archive))},observations,startup,ownServerClosed:closed,existingServersRestarted:false,publicReleaseExists:false,publicReleaseStatusBasis:'Previously recorded November 2 Releases response; not re-fetched by this check',isPublicReleaseRollback:false,browserRestorePerformed:false,walletOrRpcUsed:false,githubWrites:false};
await writeFile(join(root,'summary.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,extracted,sourceSummary:source.summary,backups:observations.map(o=>({input:o.input,oldExitCode:o.oldExitCode,currentExitCode:o.currentExitCode,oldFailure:o.oldFailure})),startup,closed},null,2));
