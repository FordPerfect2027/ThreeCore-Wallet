import {mkdir,readFile,writeFile,copyFile,symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const repo='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-dependency-repair-DAT-20261102';
const folder='C:/Users/aseet/AppData/Local/Temp/threecore history baseline '+randomUUID();
await mkdir(folder);const zip=folder+'/source.zip',exported=folder+'/source';await mkdir(exported);
const git=args=>{const r=spawnSync('git',args,{cwd:repo,windowsHide:true,encoding:'utf8',maxBuffer:1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const revision=git(['rev-parse','HEAD']);assert.equal(revision,'62dee6aba8a092e179643e0e4b19d53473cd6e67');
git(['-c','core.autocrlf=false','archive','--format=zip','--output='+zip,revision]);
const extracted=spawnSync('tar.exe',['-xf',zip,'-C',exported],{windowsHide:true,encoding:'utf8'});assert.equal(extracted.status,0,extracted.stderr);
const sourceHashes={};
for(const file of ['scripts/inspect-transfers.js','scripts/inspect-approvals.js']){
 const bytes=await readFile(exported+'/'+file),before=spawnSync('git',['show',revision+':'+file],{cwd:repo,windowsHide:true});assert.equal(before.status,0);assert(bytes.equals(before.stdout));
 sourceHashes[file]=createHash('sha256').update(bytes).digest('hex');
}
for(const file of ['test/history-cli.test.mjs','test/support/local-rpc-preload.mjs','src/history-cli-input.js'])await copyFile(repo+'/'+file,exported+'/'+file);
await symlink(repo+'/node_modules',exported+'/node_modules','junction');
const r=spawnSync(process.execPath,['--test','--test-name-pattern=CLI rejects excessive ranges before any RPC','test/history-cli.test.mjs'],{cwd:exported,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
const log=r.stdout+r.stderr;await writeFile('C:/Users/aseet/Downloads/ThreeCore-history-cli-baseline-failure-20261102.log',log);
assert.equal(r.status,1);assert.match(log,/fail 2/);assert.match(log,/3 !== 0/);
const receipt={recordedAt:new Date().toISOString(),token:'DAT',baselineCommit:revision,baselineCliBytesUnchanged:true,sourceHashes,testFixtureFilesAdded:['test/history-cli.test.mjs','test/support/local-rpc-preload.mjs','src/history-cli-input.js'],helperNotImportedByBaselineCommands:true,expectedFailedCases:2,observedRpcCallsPerInvalidRange:3,expectedRpcCalls:0,realNetworkUsed:false,transactionsPerformed:false,dependencyInstallationReused:true};
await writeFile('C:/Users/aseet/Downloads/ThreeCore-history-cli-before-after-20261102.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
