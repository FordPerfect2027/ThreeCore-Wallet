import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {join,relative,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const paths=JSON.parse(await readFile('C:/Users/aseet/Downloads/ThreeCore-runtime-installation-20261102/paths.json','utf8'));
const repoRoot='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/';
const env={PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,SystemDrive:process.env.SystemDrive,TEMP:process.env.TEMP,TMP:process.env.TMP};
async function run(args,cwd,label,limit=240000){
 const rel=relative(paths.owned,resolve(cwd));assert(rel&&!rel.startsWith('..')&&!isAbsolute(rel));
 const result=await new Promise((done,reject)=>{
  const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  const timer=setTimeout(()=>child.kill(),limit);
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  child.on('error',error=>{clearTimeout(timer);reject(error)});child.on('close',(exitCode,signal)=>{clearTimeout(timer);done({exitCode,signal,stdout,stderr})});
 });
 await writeFile(join(paths.output,label+'.log'),result.stdout+result.stderr);
 assert.equal(result.exitCode,0,label+': '+result.stderr.slice(-3000));return result;
}
async function check(token){
 const repo=repoRoot+'token-dependency-repair-'+token+'-20261102';
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,windowsHide:true,encoding:'utf8'}).trim();
 const root=join(paths.owned,token+'-minimal'),zip=join(paths.owned,token+'-source.zip');await mkdir(root);
 execFileSync('git',['-c','core.autocrlf=false','archive','--format=zip','--output='+zip,revision],{cwd:repo,windowsHide:true});
 execFileSync('tar.exe',['-xf',zip,'-C',root],{windowsHide:true});
 for(const name of ['package.json','package-lock.json'])await copyFile(join(repo,name),join(root,name));
 await run([paths.npm,'ci','--omit=dev','--omit=optional','--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--cache='+paths.cache,'--userconfig='+paths.userconfig,'--globalconfig='+paths.globalconfig],root,token+'-minimal-install');
 const lock=JSON.parse(await readFile(join(root,'node_modules/.package-lock.json'),'utf8'));
 const installed=Object.entries(lock.packages).map(([name,p])=>({name,version:p.version}));
 assert.equal(installed.length,19);
 for(const name of ['hardhat','solc','typescript','zod'])assert(!installed.some(p=>p.name.endsWith('/'+name)));
 console.log(JSON.stringify({token,stage:'installed',packages:installed.length}));
 const tests=(await readdir(join(root,'test'))).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'test/'+n);
 const result=await run(['--test','--test-concurrency=2',...tests],root,token+'-minimal-readonly');
 assert.match(result.stdout,/# tests 213\b/);assert.match(result.stdout,/# pass 213\b/);assert.match(result.stdout,/# fail 0\b/);
 const receipt={token,recordedAt:new Date().toISOString(),sourceBaseCommit:revision,node:process.version,npm:'11.17.0',installCommand:'npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund',installedPackages:installed,readOnlyTests:{passed:213,failed:0},sourcePatch:'Move viem 2.56.6 from devDependencies to dependencies; npm lock classification flags only',sourcePackageSha256:createHash('sha256').update(await readFile(join(root,'package.json'))).digest('hex'),sourceLockSha256:createHash('sha256').update(await readFile(join(root,'package-lock.json'))).digest('hex'),sourceVersionsUnchanged:true,realWallet:false,publicRpc:false,lifecycleScripts:false,fullDevelopmentZodAdvisoryRemainsOpen:true};
 await writeFile(join(paths.output,token+'-minimal-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({token,stage:'passed',passed:213,failed:0}));return receipt;
}
const results=await Promise.allSettled(['EMA','CAWELON'].map(check));
for(const r of results)if(r.status==='rejected')throw r.reason;
