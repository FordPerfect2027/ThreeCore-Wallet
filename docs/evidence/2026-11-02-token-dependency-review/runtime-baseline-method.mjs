import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {join,resolve,relative,isAbsolute} from 'node:path';
import assert from 'node:assert/strict';
const repo='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-dependency-repair-DAT-20261102';
const output='C:/Users/aseet/Downloads/ThreeCore-runtime-installation-20261102';
const owned='C:/Users/aseet/AppData/Local/Temp/threecore runtime '+randomUUID();
await mkdir(output);await mkdir(owned);await mkdir(join(owned,'cache'));
const userconfig=join(owned,'empty-user.npmrc'),globalconfig=join(owned,'empty-global.npmrc');
await writeFile(userconfig,'');await writeFile(globalconfig,'');
const npm='C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';await access(npm);
const env={PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,SystemDrive:process.env.SystemDrive,TEMP:process.env.TEMP,TMP:process.env.TMP};
const npmOptions=['--registry=https://registry.npmjs.org','--ignore-scripts','--no-audit','--no-fund','--cache='+join(owned,'cache'),'--userconfig='+userconfig,'--globalconfig='+globalconfig];
async function run(args,cwd,label){
 const rel=relative(owned,resolve(cwd));assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));
 const result=await new Promise((resolveResult,reject)=>{
  const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.on('error',reject);child.on('close',exitCode=>resolveResult({exitCode,stdout,stderr}));
 });
 await writeFile(join(output,label+'.log'),result.stdout+result.stderr);return result;
}
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim();
assert.equal(revision,'45f0aa3f897538f1dfccfe3299dcec793156bd8e');
const zip=join(owned,'source.zip');execFileSync('git',['-c','core.autocrlf=false','archive','--format=zip','--output='+zip,revision],{cwd:repo,windowsHide:true});
const paths={output,owned,baseline:join(owned,'baseline'),candidate:join(owned,'candidate'),npm,userconfig,globalconfig,cache:join(owned,'cache'),sourceRevision:revision};
for(const dir of [paths.baseline,paths.candidate]){await mkdir(dir);execFileSync('tar.exe',['-xf',zip,'-C',dir],{windowsHide:true});}
await writeFile(join(output,'paths.json'),JSON.stringify(paths,null,2)+'\n');
const baselineInstall=await run([npm,'ci','--omit=dev',...npmOptions],paths.baseline,'baseline-production-install');assert.equal(baselineInstall.exitCode,0,baselineInstall.stderr);
const before=await run(['scripts/inspect-transfers.js','invalid-test-address'],paths.baseline,'baseline-command-failure');
assert.equal(before.exitCode,1);assert.match(before.stderr,/ERR_MODULE_NOT_FOUND/);assert.match(before.stderr,/viem/);
console.log(JSON.stringify({stage:'baseline',productionInstallSucceeded:true,readOnlyCommandFailedForMissingViem:true}));
const oldPackage=await readFile(join(paths.candidate,'package.json'),'utf8');
const pack=JSON.parse(oldPackage);assert.equal(pack.devDependencies.viem,'2.56.6');pack.dependencies.viem=pack.devDependencies.viem;delete pack.devDependencies.viem;
await writeFile(join(paths.candidate,'package.json'),JSON.stringify(pack,null,2)+(oldPackage.endsWith('\n')?'\n':''));
const oldLock=JSON.parse(await readFile(join(paths.candidate,'package-lock.json'),'utf8'));
const lockUpdate=await run([npm,'install','--package-lock-only',...npmOptions],paths.candidate,'candidate-lock-update');assert.equal(lockUpdate.exitCode,0,lockUpdate.stderr);
const newLock=JSON.parse(await readFile(join(paths.candidate,'package-lock.json'),'utf8'));
assert.deepEqual(Object.keys(newLock.packages).sort(),Object.keys(oldLock.packages).sort());
const changes=[];
for(const name of Object.keys(oldLock.packages).filter(Boolean)){
 const before=oldLock.packages[name],after=newLock.packages[name];
 const stripped=o=>Object.fromEntries(Object.entries(o).filter(([key])=>!['dev','devOptional','optional','peer'].includes(key)));
 assert.deepEqual(stripped(after),stripped(before),'Package version/resolution/metadata drift: '+name);
 if(JSON.stringify(before)!==JSON.stringify(after))changes.push({name,beforeFlags:Object.fromEntries(['dev','devOptional','optional','peer'].filter(key=>key in before).map(key=>[key,before[key]])),afterFlags:Object.fromEntries(['dev','devOptional','optional','peer'].filter(key=>key in after).map(key=>[key,after[key]]))});
}
const candidateInstall=await run([npm,'ci','--omit=dev',...npmOptions],paths.candidate,'candidate-production-install');assert.equal(candidateInstall.exitCode,0,candidateInstall.stderr);
const after=await run(['scripts/inspect-transfers.js','invalid-test-address'],paths.candidate,'candidate-command-validation');assert.equal(after.exitCode,2);assert.match(after.stderr,/INVALID_ADDRESS/);assert(!after.stderr.includes('ERR_MODULE_NOT_FOUND'));
const installed=JSON.parse(await readFile(join(paths.candidate,'node_modules/.package-lock.json'),'utf8'));
const list=Object.entries(installed.packages).map(([name,value])=>({name,version:value.version}));
const record={recordedAt:new Date().toISOString(),sourceRevision:revision,node:process.version,classificationChange:'viem 2.56.6 moved from devDependencies to dependencies',packageVersionsAndResolutionUnchanged:true,lockChangedPackageFlags:changes,baseline:{installExitCode:0,commandExitCode:before.exitCode,reason:'ERR_MODULE_NOT_FOUND: viem'},candidate:{installExitCode:0,commandExitCode:after.exitCode,reason:'Expected invalid-address validation',installed:list,zodInstalled:list.some(x=>x.name.endsWith('/zod')),hardhatInstalled:list.some(x=>x.name.endsWith('/hardhat'))},npmLifecycleScriptsDisabled:true,realWalletUsed:false,publicRpcRequested:false,sourceRepositoryModified:false,packageSha256:createHash('sha256').update(await readFile(join(paths.candidate,'package.json'))).digest('hex'),lockSha256:createHash('sha256').update(await readFile(join(paths.candidate,'package-lock.json'))).digest('hex')};
await writeFile(join(output,'classification-probe.json'),JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({stage:'candidate',runtimeStarts:true,installedPackages:list.length,zodInstalled:record.candidate.zodInstalled,hardhatInstalled:record.candidate.hardhatInstalled,changedFlags:changes.length,paths}));
