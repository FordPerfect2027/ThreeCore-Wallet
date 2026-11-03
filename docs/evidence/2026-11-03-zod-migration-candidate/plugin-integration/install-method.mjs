import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {writeFile} from 'node:fs/promises';
const root='C:/Users/aseet/AppData/Local/Temp/threecore-zod4-plugin-integration-20261103';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
const common=['--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--userconfig='+root+'/empty-user.npmrc','--globalconfig='+root+'/empty-global.npmrc','--cache=C:/Users/aseet/AppData/Local/Temp/threecore-hardhat-zod4-migration-20261103/npm-cache'];
const steps=[];
for(const [name,args] of [['lock',['install','--package-lock-only']],['install',['ci']]]){
const startedAt=new Date().toISOString(),log=createWriteStream(root+'/'+name+'.log',{flags:'wx'});
const outcome=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js',...args,...common],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});const timer=setTimeout(()=>child.kill(),240000);child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',(code,signal)=>{clearTimeout(timer);log.end();resolve({code,signal});});});steps.push({name,startedAt,endedAt:new Date().toISOString(),...outcome});if(outcome.code!==0){await writeFile(root+'/install-result.json',JSON.stringify({steps},null,2)+'\n');process.exit(outcome.code??1);}}
await writeFile(root+'/install-result.json',JSON.stringify({steps,scriptsDisabled:true,sourcePatchedAfterInstall:false},null,2)+'\n');console.log(JSON.stringify({steps}));
