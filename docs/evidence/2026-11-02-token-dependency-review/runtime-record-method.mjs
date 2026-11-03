import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const root='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work';
const dir=join(root,'threecore-wallet-operation-rehearsal-20261029/docs/evidence/2026-11-02-token-dependency-review');
const sha=b=>createHash('sha256').update(b).digest('hex');
const rows=JSON.parse(readFileSync(join(dir,'source-comparison.json'))).comparisons;
const bindings=[];
for(const row of rows){
  const repo=join(root,`token-dependency-repair-${row.token}-20261102`);
  const bytes=readFileSync(join(dir,`source-${row.token}-artifact.json`));
  if(sha(bytes)!==row.artifactSha256)throw Error('Artifact mismatch');
  const artifact=JSON.parse(bytes);
  const buildBytes=readFileSync(join(repo,`artifacts/build-info/${artifact.buildInfoId}.json`));
  if(sha(buildBytes)!==row.buildInfoSha256)throw Error('Build mismatch');
  const outputBytes=readFileSync(join(repo,`artifacts/build-info/${artifact.buildInfoId}.output.json`));
  const output=JSON.parse(outputBytes).output;
  const entries=Object.entries(output.sources).filter(([key])=>key.endsWith('/utils/cryptography/EIP712.sol'));
  if(entries.length!==1)throw Error('AST source');
  const variables=[];
  function visit(value){if(!value||typeof value!=='object')return;
    if(value.nodeType==='VariableDeclaration'&&value.mutability==='immutable')variables.push({id:String(value.id),name:value.name,nodeType:value.nodeType,mutability:value.mutability,type:value.typeDescriptions.typeString});
    for(const child of Object.values(value))if(typeof child==='object')visit(child);
  }
  visit(entries[0][1].ast);
  bindings.push({token:row.token,artifactSha256:sha(bytes),buildInfoSha256:sha(buildBytes),compilerOutputSha256:sha(outputBytes),astSource:entries[0][0],variables});
}
const copies=[
 ['C:/Users/aseet/Downloads/ThreeCore-runtime-source-comparison-20261102.json','runtime-public-comparison.json'],
 ['C:/Users/aseet/Downloads/ThreeCore-runtime-immutables-20261102.json','runtime-immutables.json'],
 ['C:/Users/aseet/AppData/Local/Temp/threecore-compare-deployed-runtime-20261102.mjs','runtime-public-method.mjs'],
 ['C:/Users/aseet/AppData/Local/Temp/threecore-check-runtime-immutables-20261102.mjs','runtime-immutable-method.mjs'],
];
for(const [source,target]of copies)writeFileSync(join(dir,target),readFileSync(source),{flag:'wx'});
writeFileSync(join(dir,'runtime-immutable-bindings.json'),JSON.stringify({schema:'threecore-immutable-ast-bindings-v1',bindings},null,2)+'\n',{flag:'wx'});
copyFileSync(new URL(import.meta.url),join(dir,'runtime-record-method.mjs'));
const files=[...copies.map(x=>x[1]),'runtime-immutable-bindings.json','runtime-record-method.mjs','verify-runtime-comparison.mjs'];
let manifest=readFileSync(join(dir,'SHA256SUMS.txt'),'utf8');
for(const file of files){if(manifest.includes('  '+file+'\n'))throw Error('Duplicate manifest');manifest+=sha(readFileSync(join(dir,file)))+'  '+file+'\n';}
writeFileSync(join(dir,'SHA256SUMS.txt'),manifest);
console.log(JSON.stringify({recorded:files.length,bindings:bindings.map(x=>({token:x.token,variables:x.variables.length}))}));
