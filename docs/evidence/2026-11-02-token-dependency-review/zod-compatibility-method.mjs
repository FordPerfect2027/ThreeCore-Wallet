import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {join,relative,resolve,isAbsolute} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const repo='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-dependency-repair-DAT-20261102';
const helper=join(repo,'node_modules/@nomicfoundation/hardhat-zod-utils/dist/src/index.js');
const helperPackage=JSON.parse(await readFile(join(repo,'node_modules/@nomicfoundation/hardhat-zod-utils/package.json'),'utf8'));
assert.equal(helperPackage.version,'3.0.6');
const original=await readFile(helper);const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const imports=original.toString('utf8').match(/^import.*$/gm);assert.deepEqual(imports,['import { z } from "zod";']);
const output='C:/Users/aseet/Downloads/ThreeCore-zod-compatibility-20261102';await mkdir(output);
const owned='C:/Users/aseet/AppData/Local/Temp/threecore-zod-compatibility-'+randomUUID();await mkdir(owned);
const runtime=JSON.parse(await readFile('C:/Users/aseet/Downloads/ThreeCore-runtime-installation-20261102/paths.json','utf8'));
const env={PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,SystemDrive:process.env.SystemDrive,TEMP:process.env.TEMP,TMP:process.env.TMP};
const npmOptions=['--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--cache='+runtime.cache,'--userconfig='+runtime.userconfig,'--globalconfig='+runtime.globalconfig];
const probe=`import {z} from 'zod';
import {validateUserConfigZodType} from './hardhat-zod-utils-original.mjs';
const results=[];
for(const [name,value,schema] of [
 ['valid-config',{name:'fixture'},()=>z.object({name:z.string()})],
 ['invalid-config',{name:123},()=>z.object({name:z.string()})],
 ['record-config',{networks:{fixture:{type:'edr-simulated'}}},()=>z.object({networks:z.record(z.object({type:z.string()}))})]
]){
 try{results.push({name,status:'returned',errors:validateUserConfigZodType(value,schema())});}
 catch(error){results.push({name,status:'threw',errorName:error.name,message:error.message});}
}
console.log(JSON.stringify({results}));
`;
async function run(args,cwd,label){
 const rel=relative(owned,resolve(cwd));assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));
 const result=await new Promise((done,reject)=>{
  const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill(),180000);
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('close',(exitCode,signal)=>{clearTimeout(timer);done({exitCode,signal,stdout,stderr})});
 });
 await writeFile(join(output,label+'.log'),result.stdout+result.stderr);assert.equal(result.exitCode,0,label+': '+result.stderr.slice(-2000));return result;
}
async function check(label,version){
 const cwd=join(owned,label);await mkdir(cwd);
 await writeFile(join(cwd,'package.json'),JSON.stringify({name:'threecore-zod-compatibility-'+label,version:'0.0.0',private:true,type:'module',dependencies:{zod:version}},null,2)+'\n');
 await copyFile(helper,join(cwd,'hardhat-zod-utils-original.mjs'));assert.equal(sha(await readFile(join(cwd,'hardhat-zod-utils-original.mjs'))),sha(original));
 await writeFile(join(cwd,'probe.mjs'),probe);
 await run([runtime.npm,'install',...npmOptions],cwd,label+'-install');
 const installed=JSON.parse(await readFile(join(cwd,'node_modules/zod/package.json'),'utf8'));assert.equal(installed.version,version);
 const result=await run(['probe.mjs'],cwd,label+'-probe');
 const parsed=JSON.parse(result.stdout);await copyFile(join(cwd,'package-lock.json'),join(output,label+'-package-lock.json'));
 const packageLock=JSON.parse(await readFile(join(cwd,'package-lock.json'),'utf8'));
 console.log(JSON.stringify({label,version,...parsed}));
 return {label,zodVersion:version,helperVersion:helperPackage.version,helperSha256:sha(original),helperZodPeerRequirement:helperPackage.peerDependencies.zod,package:packageLock.packages['node_modules/zod'],...parsed};
}
await writeFile(join(output,'paths.json'),JSON.stringify({output,owned,sourceRepository:repo,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,windowsHide:true,encoding:'utf8'}).trim()},null,2)+'\n');
await copyFile(helper,join(output,'hardhat-zod-utils-original.mjs'));await writeFile(join(output,'probe.mjs'),probe);
const runs=await Promise.allSettled([check('baseline','3.25.76'),check('candidate','4.6.6')]);for(const run of runs)if(run.status==='rejected')throw run.reason;
const [baseline,candidate]=runs.map(run=>run.value);
assert(baseline.results.every(r=>r.status==='returned'));assert.deepEqual(baseline.results[0].errors,[]);assert.equal(baseline.results[1].errors.length,1);assert.deepEqual(baseline.results[2].errors,[]);
const record={recordedAt:new Date().toISOString(),node:process.version,npm:'11.17.0',baseline,candidate,majorOverrideCompatibleInThisProbe:candidate.results.every(r=>r.status==='returned'),sourceRepositoriesChanged:false,originalNodeModulesChanged:false,fullHardhatBuildRun:false,userConfigurationOrSecretsLoaded:false,publicRpc:false,realWallet:false,method:'Byte-identical installed Hardhat Zod helper tested against separate npm installations of Zod 3.25.76 and 4.6.6 using three bounded fictional configuration values. Only the helper imports Zod; the complete Hardhat project is not imported.'};
await writeFile(join(output,'result.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({result:record.majorOverrideCompatibleInThisProbe?'compatible-in-three-probes':'incompatible',candidateThrownCases:candidate.results.filter(r=>r.status==='threw').map(r=>r.name)}));
