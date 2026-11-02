import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,copyFileSync,mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work';
const source=join(root,'threecore-wallet-operation-rehearsal-20261029/docs/evidence/2026-11-02-token-dependency-review');
const runtime=join(root,'token-dependency-repair-DAT-20261102');
const {keccak256}=createRequire(join(runtime,'package.json'))('viem');
const sha=b=>createHash('sha256').update(b).digest('hex');
const dir=mkdtempSync(join(tmpdir(),'threecore-runtime-evidence-controls-'));
const files=['runtime-public-comparison.json','runtime-immutables.json','runtime-immutable-bindings.json','verify-runtime-comparison.mjs',...['DAT','EMA','CAWELON'].map(t=>`source-${t}-artifact.json`)];
const results=[];
for(const control of ['unaltered','changed-opcode','changed-domain-immutable','changed-compiler-binding']){
  for(const file of files)copyFileSync(join(source,file),join(dir,file));
  if(control==='changed-opcode'||control==='changed-domain-immutable'){
    const report=JSON.parse(readFileSync(join(dir,'runtime-public-comparison.json')));
    const row=report.observations[0].rows[0];
    const artifact=JSON.parse(readFileSync(join(dir,'source-DAT-artifact.json')));
    const position=control==='changed-opcode'?0:Object.values(artifact.immutableReferences).flat()[0].start;
    const offset=2+position*2,raw=row.publicRuntimeBytecode;
    row.publicRuntimeBytecode=raw.slice(0,offset)+(parseInt(raw.slice(offset,offset+2),16)^1).toString(16).padStart(2,'0')+raw.slice(offset+2);
    row.onchainRuntimeKeccak256=keccak256(row.publicRuntimeBytecode);
    const bytes=JSON.stringify(report,null,2)+'\n';
    writeFileSync(join(dir,'runtime-public-comparison.json'),bytes);
    const immutable=JSON.parse(readFileSync(join(dir,'runtime-immutables.json')));immutable.comparisonSha256=sha(bytes);
    writeFileSync(join(dir,'runtime-immutables.json'),JSON.stringify(immutable,null,2)+'\n');
  }
  if(control==='changed-compiler-binding'){
    const data=JSON.parse(readFileSync(join(dir,'runtime-immutable-bindings.json')));
    data.bindings[0].variables[0].name='_unrecognized';
    writeFileSync(join(dir,'runtime-immutable-bindings.json'),JSON.stringify(data,null,2)+'\n');
  }
  const run=spawnSync(process.execPath,[join(dir,'verify-runtime-comparison.mjs'),runtime],{encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:128*1024});
  assert.equal(run.error,undefined);assert.equal(run.signal,null);
  if(control==='unaltered')assert.equal(run.status,0);else assert.notEqual(run.status,0);
  results.push({control,exitCode:run.status,expectedResult:control==='unaltered'?'accepted':'refused',
    stdout:run.stdout,stderr:run.stderr});
}
const receipt={schema:'threecore-runtime-evidence-controls-v1',observedAt:new Date().toISOString(),offline:true,
  originalFilesChanged:false,temporaryDirectory:dir,checkerSha256:sha(readFileSync(join(source,'verify-runtime-comparison.mjs'))),results};
writeFileSync('C:/Users/aseet/Downloads/ThreeCore-runtime-evidence-controls-20261102.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(results.map(({control,exitCode,expectedResult})=>({control,exitCode,expectedResult})),null,2));
