import {writeFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const base='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/',downloads='C:/Users/aseet/Downloads/';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|windir|temp|tmp|comspec|pathext|localappdata|appdata|userprofile)$/i.test(key)));
env.HARDHAT_DISABLE_TELEMETRY_PROMPT='true';env.NO_COLOR='1';
const runs=[];
for(const token of ['DAT','EMA','CAWELON']){
 const root=base+'token-dependency-repair-'+token+'-20261102';
 for(const [kind,args] of [
  ['tooling',['--test','--test-reporter=tap','integration/source-portability.test.mjs','integration/test-routing.test.mjs']],
  ['contracts-fixed',['scripts/test-contracts.js','--no-compile']],
  ['history',['--test','--test-reporter=tap','integration/history-compatibility.test.mjs']],
  ['wallet',['--test','--test-reporter=tap',base+'threecore-wallet-operation-rehearsal-20261029/integration/token-compatibility.test.mjs']]
 ]){
  let output='',errors='';const started=new Date().toISOString(),path=downloads+'ThreeCore-source-'+token+'-'+kind+'-20261102.log';
  const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  function save(){writeFileSync(path,output+errors);}
  child.stdout.on('data',b=>{output+=b;save();});child.stderr.on('data',b=>{errors+=b;save();});
  const timer=setTimeout(()=>child.kill(),120000);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);save();
  const result={token,kind,args,started,finished:new Date().toISOString(),code,logSha256:createHash('sha256').update(output+errors).digest('hex')};runs.push(result);
  writeFileSync(downloads+'ThreeCore-source-portability-validation-fixed-20261102.json',JSON.stringify({node:process.version,runs,scope:'Synthetic local EVM with fixture accounts; no user-wallet/private-key access or public-chain transactions; existing dependencies reused'},null,2)+'\n');
  console.log(JSON.stringify(result));assert.equal(code,0,token+' '+kind);
 }
}
