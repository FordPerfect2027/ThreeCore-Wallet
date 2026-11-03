import { readFileSync, writeFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/';
const downloads='C:/Users/aseet/Downloads/';
const files=['src/canonical-token-read.js','src/onchain-identity.js','scripts/verify-base-mainnet.js','test/onchain-identity.test.mjs','test/onchain-identity-cli.test.mjs'];
const results=await Promise.all(['DAT','EMA','CAWELON'].map(async token=>{
 const cwd=root+'token-dependency-repair-'+token+'-20261102';
 const before=execFileSync('git',['show','HEAD:src/onchain-identity.js'],{cwd,encoding:'utf8',windowsHide:true});
 const current=readFileSync(cwd+'/src/onchain-identity.js','utf8');
 const spec=s=>s.match(/export const DEPLOYED_TOKEN = Object.freeze\(\{[\s\S]*?\}\);/)[0].replaceAll('\r\n','\n');
 if(spec(before)!==spec(current))throw Error(token+' published identity changed');
 for(const file of files)writeFileSync(cwd+'/'+file,readFileSync(cwd+'/'+file,'utf8').replaceAll('\r\n','\n'));
 const startedAt=new Date().toISOString();
 const result=await new Promise((resolve,reject)=>execFile(process.execPath,['scripts/verify-base-mainnet.js'],{cwd,windowsHide:true,timeout:60000,maxBuffer:32768,env:{PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,BASE_MAINNET_READ_RPC_URL:'https://mainnet.base.org'}},(error,stdout,stderr)=>{
   if(error&&(error.killed||typeof error.code!=='number'))reject(error);else resolve({exitCode:error?.code??0,stdout,stderr});
 }));
 const report={token,startedAt,finishedAt:new Date().toISOString(),endpoint:'https://mainnet.base.org',baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd,encoding:'utf8',windowsHide:true}).trim(),sourceSha256:Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(cwd+'/'+file)).digest('hex')])),...result};
 writeFileSync(downloads+'ThreeCore-'+token+'-canonical-live-20261102.json',JSON.stringify(report,null,2)+'\n');
 return {token,exitCode:result.exitCode,stderr:result.stderr,observation:result.exitCode===0?JSON.parse(result.stdout):null};
}));
console.log(JSON.stringify(results,null,2));
if(results.some(row=>row.exitCode!==0))process.exitCode=1;
