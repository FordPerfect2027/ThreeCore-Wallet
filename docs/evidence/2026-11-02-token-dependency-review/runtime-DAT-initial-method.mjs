import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {join,relative,resolve,isAbsolute} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const paths=JSON.parse(await readFile('C:/Users/aseet/Downloads/ThreeCore-runtime-installation-20261102/paths.json','utf8'));
const root=join(paths.owned,'minimal');
await mkdir(root);
execFileSync('tar.exe',['-xf',join(paths.owned,'source.zip'),'-C',root],{windowsHide:true});
for(const name of ['package.json','package-lock.json']) await copyFile(join(paths.candidate,name),join(root,name));
const env={PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,SystemDrive:process.env.SystemDrive,TEMP:process.env.TEMP,TMP:process.env.TMP};
async function run(args,label,limit=180000){
  const rel=relative(paths.owned,resolve(root));assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));
  const result=await new Promise((done,reject)=>{
    const child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
    const timer=setTimeout(()=>child.kill(),limit);
    child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
    child.on('error',error=>{clearTimeout(timer);reject(error)});
    child.on('close',(exitCode,signal)=>{clearTimeout(timer);done({exitCode,signal,stdout,stderr})});
  });
  await writeFile(join(paths.output,label+'.log'),result.stdout+result.stderr);
  assert.equal(result.exitCode,0,label+': '+result.stderr.slice(-3000));return result;
}
await run([paths.npm,'ci','--omit=dev','--omit=optional','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--cache='+paths.cache,'--userconfig='+paths.userconfig,'--globalconfig='+paths.globalconfig],'minimal-production-install');
const lock=JSON.parse(await readFile(join(root,'node_modules/.package-lock.json'),'utf8'));
const installed=Object.entries(lock.packages).map(([name,p])=>({name,version:p.version}));
for(const name of ['hardhat','solc','typescript','zod'])assert(!installed.some(p=>p.name.endsWith('/'+name)),'Unexpected installed package: '+name);
assert(installed.some(p=>p.name==='node_modules/viem'&&p.version==='2.56.6'));
console.log(JSON.stringify({stage:'minimal-installed',root,packages:installed.length,hardhatSolcTypescriptZodAbsent:true}));
const tests=(await readdir(join(root,'test'))).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'test/'+n);
const regression=await run(['--test','--test-concurrency=2',...tests],'minimal-readonly-regression');
assert.match(regression.stdout,/# tests 213\b/);assert.match(regression.stdout,/# pass 213\b/);assert.match(regression.stdout,/# fail 0\b/);
const receipt={recordedAt:new Date().toISOString(),sourceRevision:paths.sourceRevision,candidatePackageClassification:true,node:process.version,npm:'11.17.0',installCommand:'npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund',installedPackages:installed,readOnlyTests:{passed:213,failed:0},realWallet:false,publicRpc:false,lifecycleScripts:false,fullDevelopmentZodAdvisoryRemainsOpen:true,root,sourcePackageSha256:createHash('sha256').update(await readFile(join(root,'package.json'))).digest('hex'),sourceLockSha256:createHash('sha256').update(await readFile(join(root,'package-lock.json'))).digest('hex')};
await writeFile(join(paths.output,'minimal-installation-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({stage:'minimal-verified',passed:213,failed:0,packages:installed.length}));
