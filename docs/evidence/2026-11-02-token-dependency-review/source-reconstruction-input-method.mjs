import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const work='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work';
const dir=join(work,'threecore-wallet-operation-rehearsal-20261029/docs/evidence/2026-11-02-token-dependency-review');
const source='C:/Users/aseet/Downloads/ThreeCore-metadata-path-reconstruction-20261102';
const require=createRequire(join(work,'token-dependency-repair-DAT-20261102/package.json')),solc=require('solc');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest={schema:'threecore-runtime-source-reconstruction-inputs.v1',compilerVersion:solc.version(),soljsonSha256:sha(await readFile(require.resolve('solc/soljson.js'))),publicRecordSha256:sha(await readFile(join(dir,'runtime-public-comparison.json'))),inputs:[]};
for(const token of ['DAT','EMA','CAWELON']){
 const repo=join(work,'token-dependency-repair-'+token+'-20261102');
 const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim();
 assert.equal(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8',windowsHide:true}).trim(),'');
 const bytes=await readFile(join(source,token+'-hardhat-saved-paths-input.json')),input=JSON.parse(bytes);
 const projectSource=input.sources['project/contracts/'+token+'Core.sol'].content;
 const committed=execFileSync('git',['show',revision+':contracts/'+token+'Core.sol'],{cwd:repo,windowsHide:true});assert.equal(sha(projectSource),sha(committed));
 const file='source-reconstruction-'+token+'-input.json';await writeFile(join(dir,file),bytes,{flag:'wx'});
 manifest.inputs.push({token,sourceRevision:revision,file,sha256:sha(bytes),projectSourceSha256:sha(projectSource)});
}
await writeFile(join(dir,'source-reconstruction-inputs.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({inputs:manifest.inputs.length,compilerVersion:manifest.compilerVersion,soljsonSha256:manifest.soljsonSha256}));
