import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,basename,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const downloads='C:/Users/aseet/Downloads/',base='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/';
const before=JSON.parse(readFileSync(downloads+'ThreeCore-source-portability-before-20261102.json'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|windir|temp|tmp|comspec|pathext|localappdata|appdata|userprofile)$/i.test(key)));
env.HARDHAT_DISABLE_TELEMETRY_PROMPT='true';env.NO_COLOR='1';
async function run(cwd,args,name,expected=0){
 const started=new Date().toISOString();let stdout='',stderr='';
 const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const timer=setTimeout(()=>child.kill(),180000);const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
 writeFileSync(downloads+'ThreeCore-source-'+name+'-20261102.log',stdout+stderr);
 assert.equal(code,expected,name+': '+stderr.slice(-1000));
 const result={name,args,started,finished:new Date().toISOString(),code,logSha256:sha(stdout+stderr)};
 console.log(JSON.stringify(result));return result;
}
function stripMetadata(bytes){const length=parseInt(bytes.slice(-4),16);assert(length>0&&length<(bytes.length-2)/2);return bytes.slice(0,-(length+2)*2);}
const comparisons=[];
for(const item of before){
 const path='contracts/'+item.contract+'.sol',source=readFileSync(item.root+'/'+path),raw=readFileSync(item.root+'/artifacts/'+path+'/'+item.contract+'.json'),artifact=JSON.parse(raw);
 assert.equal(sha(source),item.sourceAfterSha256);assert.equal(sha(readFileSync(item.root+'/package-lock.json')),item.lockSha256);
 assert.deepEqual(artifact.abi,item.artifactBefore.abi);assert.deepEqual(artifact.immutableReferences,item.artifactBefore.immutableReferences);
 assert.equal(stripMetadata(artifact.bytecode),stripMetadata(item.artifactBefore.bytecode));assert.equal(stripMetadata(artifact.deployedBytecode),stripMetadata(item.artifactBefore.deployedBytecode));
 const buildRaw=readFileSync(item.root+'/artifacts/build-info/'+artifact.buildInfoId+'.json'),build=JSON.parse(buildRaw);
 assert.equal(sha(build.input.sources['project/'+path].content),item.sourceAfterSha256);
 const comparison={token:item.token,contract:item.contract,sourceSha256:sha(source),artifactSha256:sha(raw),buildInfoSha256:sha(buildRaw),abiUnchanged:true,immutableReferencesUnchanged:true,creationExecutableBytesUnchanged:true,runtimeExecutableBytesUnchanged:true,metadataChanged:artifact.deployedBytecode!==item.artifactBefore.deployedBytecode,onlySourceLineEndingsChanged:true,compiler:build.solcLongVersion};
 if(item.token==='DAT'){
  const reference=JSON.parse(readFileSync(item.root+'/deployments/reference/DATCore-base-sepolia.json'));
  for(const field of ['abi','bytecode','deployedBytecode','immutableReferences'])assert.deepEqual(artifact[field],reference[field]);
  const {verifySepoliaDeployment}=await import(pathToFileURL(item.root+'/src/sepolia-deployment-verifier.js'));
  let requests=0;await assert.rejects(verifySepoliaDeployment({async request(){requests++;throw Error('PREFLIGHT_PASSED_NO_RPC_SENT');}},JSON.parse(readFileSync(item.root+'/deployments/base-sepolia.json')),artifact),/PREFLIGHT_PASSED_NO_RPC_SENT/);assert.equal(requests,1);
  comparison.matchesHistoricalReference=true;comparison.verifierArtifactPreflightPassed=true;
 }
 comparisons.push(comparison);
}
writeFileSync(downloads+'ThreeCore-source-portability-comparison-20261102.json',JSON.stringify({recordedAt:new Date().toISOString(),comparisons,scope:'Actual ordinary forced Hardhat builds; executable bytes and ABI compared to preserved original artifacts; metadata changes acknowledged; no public RPC'},null,2)+'\n');
console.log(JSON.stringify({buildComparisons:comparisons}));
const parent=resolve(tmpdir()),control=mkdtempSync(join(parent,'threecore-portability-control-'));
try{
 for(const path of ['integration','scripts','contracts'])mkdirSync(join(control,path));
 const dat=before[0];for(const path of ['integration/source-portability.test.mjs','scripts/check-contract-source.js','contracts/DATCore.sol'])writeFileSync(join(control,path),readFileSync(dat.root+'/'+path));
 writeFileSync(join(control,'package.json'),'{"type":"module"}');
 writeFileSync(join(control,'.gitattributes'),'# Deliberately omit source LF policy for regression control.\n');
 await run(control,['--test','--test-reporter=tap','integration/source-portability.test.mjs'],'portability-negative-control',1);
}finally{assert.equal(dirname(resolve(control)),parent);assert(basename(control).startsWith('threecore-portability-control-'));assert(!lstatSync(control).isSymbolicLink());rmSync(control,{recursive:true,force:true});}
const runs=[];
for(const item of before){
 runs.push(await run(item.root,[item.root+'/node_modules/hardhat/dist/src/cli.js','test','nodejs','--no-compile'],item.token+'-contracts'));
 runs.push(await run(item.root,['--test','--test-reporter=tap','integration/history-compatibility.test.mjs'],item.token+'-history'));
 runs.push(await run(item.root,['--test','--test-reporter=tap',base+'threecore-wallet-operation-rehearsal-20261029/integration/token-compatibility.test.mjs'],item.token+'-wallet'));
}
writeFileSync(downloads+'ThreeCore-source-portability-validation-20261102.json',JSON.stringify({node:process.version,runs,scope:'Synthetic local EVM tests with fixture accounts only; no user-wallet/private-key access or public-chain transaction; existing installed dependencies reused'},null,2)+'\n');
