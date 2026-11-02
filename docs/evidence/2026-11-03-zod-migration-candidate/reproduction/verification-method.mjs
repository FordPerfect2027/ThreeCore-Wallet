import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {writeFile,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const root="C:/Users/aseet/AppData/Local/Temp/threecore-zod4-repro-20261103";
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
const steps=[];
for(const [name,args] of [['types-receipted',['node_modules/typescript/bin/tsc','--noEmit','--strict','--module','nodenext','--target','es2023','--types','node','--skipLibCheck','false','type-fixture.ts','hardhat-types-fixture.ts']],['integrated-probe',['integrated-probe.mjs']]]){
const startedAt=new Date().toISOString(),log=createWriteStream(root+'/'+name+'.log',{flags:'wx'});
const outcome=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']}); child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const timer=setTimeout(()=>child.kill(),120000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',(code,signal)=>{clearTimeout(timer);log.end(()=>resolve({code,signal}));});});steps.push({name,startedAt,endedAt:new Date().toISOString(),...outcome});if(outcome.code!==0)break;}
await writeFile(root+'/verification-result.json',JSON.stringify({steps},null,2)+'\n');console.log(JSON.stringify({steps}));assert(steps.length===2&&steps.every(s=>s.code===0));
const probe=JSON.parse(await readFile(root+'/integrated-probe-result.json','utf8'));assert.equal(probe.allCasesStructurallyCompatible,true);assert.equal(probe.candidateEarlySizeGate,true);
