#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {readFile,writeFile,access,lstat,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const [directory,toolchain,...extra]=process.argv.slice(2);if(!directory||!toolchain||extra.length)throw Error('Expected prepared directory and token toolchain');
const folder=resolve(directory),cwd=resolve(toolchain),root=fileURLToPath(new URL('../',import.meta.url));
assert.equal((await lstat(resolve(cwd,'node_modules'))).isSymbolicLink(),false);const moduleDirectory=await realpath(resolve(cwd,'node_modules'));
const guard=resolve(root,'docs/evidence/2026-11-03-token-simulation/deny-network.mjs'),networkLog=resolve(folder,'execution-network-attempts.jsonl');
try{await access(resolve(folder,'execution-summary.json'));throw Error('Output already exists; use a new run directory');}catch(error){if(error.code!=='ENOENT')throw error;}
const baseEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
const env={...baseEnv,CI:'true',HARDHAT_DISABLE_TELEMETRY:'true',NODE_OPTIONS:'--import='+pathToFileURL(guard).href,THREECORE_SIM_NETWORK_LOG:networkLog};
const startedAt=new Date().toISOString();
await writeFile(resolve(folder,'execution-start.json'),JSON.stringify({startedAt,moduleDirectory},null,2)+'\n',{flag:'wx'});
const result=await new Promise((res,rej)=>{const child=spawn(process.execPath,[resolve(root,'integration/local-aerodrome-simulation.mjs'),folder,cwd],{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';const timer=setTimeout(()=>child.kill(),240000);child.stdout.on('data',b=>{log+=b;process.stdout.write(b);});child.stderr.on('data',b=>{log+=b;process.stderr.write(b);});child.on('error',e=>{clearTimeout(timer);rej(e);});child.on('close',(code,signal)=>{clearTimeout(timer);res({code,signal,log});});});
await writeFile(resolve(folder,'execution.log'),result.log);
let attempts=[];try{attempts=(await readFile(networkLog,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);}catch(error){assert.equal(error.code,'ENOENT');}
const report={startedAt,endedAt:new Date().toISOString(),exitCode:result.code,signal:result.signal,moduleDirectory,filteredEnvironment:true,networkAttempts:attempts.filter(a=>a.category!=='windows-named-pipe').length,blockedLocalIpc:attempts.filter(a=>a.category==='windows-named-pipe').length};await writeFile(resolve(folder,'execution-run.json'),JSON.stringify(report,null,2)+'\n');assert.equal(result.code,0,'Isolated execution failed; inspect saved log');assert.equal(report.networkAttempts,0);console.log(JSON.stringify(report));
