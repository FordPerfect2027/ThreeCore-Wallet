import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, access, lstat, realpath } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const folder=dirname(fileURLToPath(import.meta.url));
const projects=JSON.parse(await readFile(join(folder,'preflight.json'),'utf8'));
const baseEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(path|systemroot|systemdrive|windir|temp|tmp|comspec|pathext)$/i.test(key)));
const guard=join(folder,'deny-network.mjs');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(cwd,args)=>execFileSync('git',args,{cwd,windowsHide:true,encoding:'utf8',env:baseEnv}).trim();
const results=[];

async function run(cwd,name,args,expected=0) {
  const startedAt=new Date().toISOString();
  const log=join(folder,name+'-final.log'),networkLog=join(folder,name+'-final-network-attempts.jsonl');
  const env={...baseEnv,CI:'true',HARDHAT_DISABLE_TELEMETRY:'true',NODE_OPTIONS:`--import=${pathToFileURL(guard).href}`,THREECORE_SIM_NETWORK_LOG:networkLog};
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';const timer=setTimeout(()=>child.kill(),180000);
    child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr});});
  });
  await writeFile(log,result.stdout+result.stderr);
  let attempted=false;try{await access(networkLog);attempted=true;}catch(e){assert.equal(e.code,'ENOENT');}
  const blocked=attempted?(await readFile(networkLog,'utf8')).trim().split('\n').map(JSON.parse):[];
  const networkAttempts=blocked.filter(r=>r.category!=='windows-named-pipe').length;
  const receipt={name,startedAt,endedAt:new Date().toISOString(),code:result.code,signal:result.signal,blockedCalls:blocked.length,blockedNamedPipeCalls:blocked.filter(r=>r.category==='windows-named-pipe').length,networkAttempts,logSha256:sha(await readFile(log))};
  results.push(receipt);console.log(JSON.stringify(receipt));
  assert.equal(result.code,expected,result.stderr.slice(-2000)+' '+result.stdout.slice(-2000));
  if(name!=='guard-control') assert.equal(networkAttempts,0,'Unexpected network attempt');
  return result;
}

await run(projects[0].root,'guard-control',['--input-type=module','-e',"import assert from 'node:assert/strict';import net from 'node:net';assert.throws(()=>fetch('https://example.invalid'),/SIMULATION_NETWORK_BLOCKED/);assert.throws(()=>new net.Socket().connect(9,'127.0.0.1'),/SIMULATION_NETWORK_BLOCKED/);console.log('Both network controls rejected before dispatch')"]);
for(const p of projects) {
  assert.equal(git(p.root,['rev-parse','HEAD']),p.revision);
  assert.equal(git(p.root,['status','--porcelain']),'');
  assert.equal((await lstat(join(p.root,'node_modules'))).isSymbolicLink(),false);
  assert.equal(await realpath(join(p.root,'node_modules')),p.moduleDirectory);
  const config=await readFile(join(p.root,'hardhat.config.ts'),'utf8');
  assert(config.includes('type: "edr-simulated"'));assert(!config.includes('forking:'));
}

const outcomes=await Promise.allSettled(projects.map(async p=>{
  const configProbe="import assert from 'node:assert/strict';import { config } from 'hardhat';assert.equal(config.networks.hardhatOp.type,'edr-simulated');assert.equal(config.networks.hardhatOp.forking,undefined);console.log('hardhatOp: edr-simulated, no remote fork')";
  await run(p.root,p.token+'-configuration',['--input-type=module','-e',configProbe]);
  await run(p.root,p.token+'-contracts',['scripts/test-contracts.js','--no-compile']);
  await run(p.root,p.token+'-history',['--test','integration/history-compatibility.test.mjs']);
  assert.equal(git(p.root,['status','--porcelain']),'');
  return {token:p.token,revision:p.revision,workingTreeUnchanged:true};
}));
await writeFile(join(folder,'run-summary.json'),JSON.stringify({recordedAt:new Date().toISOString(),node:process.version,isolatedSimulatedChain:true,realWalletUsed:false,realAssetsMoved:false,userKeysRead:false,publicChainWrites:false,dependenciesInstalled:false,compilationRerun:false,results,outcomes:outcomes.map(r=>r.status==='fulfilled'?r:{status:r.status,reason:String(r.reason)})},null,2)+'\n');
for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason;
