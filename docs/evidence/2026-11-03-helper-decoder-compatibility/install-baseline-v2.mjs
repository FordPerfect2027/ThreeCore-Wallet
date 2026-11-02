import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {writeFile,lstat} from 'node:fs/promises';
const root="C:/Users/aseet/AppData/Local/Temp/threecore-zod4-rpc-review-20261103";
const baseline=root+'/baseline';
let prior=null;try{prior=await lstat(baseline+'/node_modules');}catch(e){if(e.code!=='ENOENT')throw e;}
if(prior)throw new Error('Expected a new isolated baseline without node_modules');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
const args=['C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js','install','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--userconfig='+root+'/empty.npmrc','--globalconfig='+root+'/empty-global.npmrc','--cache=C:/Users/aseet/AppData/Local/Temp/threecore-hardhat-zod4-migration-20261103/npm-cache'];
const startedAt=new Date().toISOString(),log=createWriteStream(root+'/baseline-install-v2.log',{flags:'wx'});
const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:baseline,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const timer=setTimeout(()=>child.kill(),120000);child.on('error',reject);child.on('close',(code,signal)=>{clearTimeout(timer);log.end();resolve({code,signal});});});
await writeFile(root+'/baseline-install-v2.json',JSON.stringify({startedAt,endedAt:new Date().toISOString(),...result,scriptsDisabled:true,isolated:true},null,2));console.log(JSON.stringify(result));process.exitCode=result.code??1;
