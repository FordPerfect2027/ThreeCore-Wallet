import{execFile}from'node:child_process';import{readFileSync,writeFileSync}from'node:fs';import{createHash}from'node:crypto';
const root='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-dependency-repair-DAT-20261102';
const folder='C:/Users/aseet/Downloads/ThreeCore-sepolia-artifact-diagnosis-20261102';
const artifact=folder+'/lf-only-artifact.json',started=new Date().toISOString();
const result=await new Promise(resolve=>execFile(process.execPath,[root+'/scripts/verify-base-sepolia.js','--artifact',artifact],{cwd:root,windowsHide:true,timeout:180000,maxBuffer:65536,env:{PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,BASE_SEPOLIA_RPC_URL:'https://sepolia.base.org'}},(error,stdout,stderr)=>resolve({exitCode:error?.code??0,killed:Boolean(error?.killed),stdout,stderr})));
writeFileSync(folder+'/live-check.json',JSON.stringify({started,finished:new Date().toISOString(),endpoint:'https://sepolia.base.org',artifactSha256:createHash('sha256').update(readFileSync(artifact)).digest('hex'),...result,noWalletOrPrivateKeyUsed:true,scope:'Public historical reads and eth_call-only simulations; no transaction submitted or signature created'},null,2)+'\n');
console.log(JSON.stringify(result));if(result.exitCode!==0)process.exitCode=1;
