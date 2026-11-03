import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const work='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work';
const dat=join(work,'token-dependency-repair-DAT-20261102');
const req=createRequire(join(dat,'package.json')),solc=req('solc');
const output='C:/Users/aseet/Downloads/ThreeCore-metadata-path-reconstruction-20261102';
const evidence=join(work,'threecore-wallet-operation-rehearsal-20261029/docs/evidence/2026-11-02-token-dependency-review');
const publicBytes=await readFile(join(evidence,'runtime-public-comparison.json'));
const publicRecord=JSON.parse(publicBytes),sha=b=>createHash('sha256').update(b).digest('hex');
assert.match(solc.version(),/^0\.8\.34\+commit\.80d5c536/);
await mkdir(output);
const report={startedAt:new Date().toISOString(),compiler:solc.version(),publicRecordSha256:sha(publicBytes),scope:'bounded source-path-only reconstruction using saved compiler inputs; no dependency, Solidity text or optimizer changes',rows:[]};
function normalize(code,ranges){const bytes=Buffer.from(code.replace(/^0x/,''),'hex');for(const {start,length}of ranges)bytes.fill(0,start,start+length);return bytes;}
function metadata(code){const bytes=Buffer.from(code,'hex'),length=bytes.readUInt16BE(bytes.length-2);return '0x'+bytes.subarray(bytes.length-length-2).toString('hex');}
for(const token of ['DAT','EMA','CAWELON']){
 const repo=join(work,'token-dependency-repair-'+token+'-20261102');
 const builds=await readdir(join(repo,'artifacts/build-info')),name=builds.find(n=>n.endsWith('.json')&&!n.endsWith('.output.json'));assert(name);
 const buildBytes=await readFile(join(repo,'artifacts/build-info',name)),build=JSON.parse(buildBytes),source=Object.keys(build.input.sources).find(p=>p.startsWith('project/contracts/'));assert(source);
 const contract=source.split('/').pop().replace(/\.sol$/,'');
 for(const variant of ['hardhat-saved-paths','unversioned-import-paths','root-contract-path']){
  const input=structuredClone(build.input);
  let target=source;
  if(variant!=='hardhat-saved-paths'){
   input.sources=Object.fromEntries(Object.entries(input.sources).map(([path,value])=>{
    const mapped=path.startsWith('npm/@openzeppelin/contracts@5.6.1/')?path.replace('npm/@openzeppelin/contracts@5.6.1/','@openzeppelin/contracts/'):path===source?(variant==='root-contract-path'?source.split('/').pop():source.replace('project/','')):path;
    if(path===source)target=mapped;return [mapped,value];
   }));
   delete input.settings.remappings;
  }
  input.settings.outputSelection={'*':{'*':['metadata','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}};
  const inputBytes=Buffer.from(JSON.stringify(input));
  const result=JSON.parse(solc.compile(inputBytes.toString()));
  const errors=(result.errors||[]).filter(e=>e.severity==='error');assert.equal(errors.length,0,JSON.stringify(errors));
  const artifact=result.contracts[target][contract],runtime=artifact.evm.deployedBytecode.object;
  const ranges=Object.values(artifact.evm.deployedBytecode.immutableReferences).flat().sort((a,b)=>a.start-b.start);
  const comparisons=publicRecord.observations.map(obs=>{const row=obs.rows.find(r=>r.token===token);assert.deepEqual(ranges,row.immutableRanges);return {chainId:obs.chainId,contract:row.contract,metadataMatches:metadata(runtime)===row.onchainMetadata,immutableNormalizedFullRuntimeMatches:normalize(runtime,ranges).equals(normalize(row.publicRuntimeBytecode,ranges))};});
  const file=token+'-'+variant;
  await writeFile(join(output,file+'-input.json'),inputBytes,{flag:'wx'});
  await writeFile(join(output,file+'-metadata.json'),artifact.metadata,{flag:'wx'});
  await writeFile(join(output,file+'-runtime.txt'),'0x'+runtime+'\n',{flag:'wx'});
  report.rows.push({token,variant,compilerInputFile:file+'-input.json',compilerInputSha256:sha(inputBytes),savedBuildInputSha256:sha(buildBytes),metadataSha256:sha(artifact.metadata),compiledMetadataTrailer:metadata(runtime),comparisons});
  console.log(JSON.stringify({token,variant,comparisons}));
 }
}
report.finishedAt=new Date().toISOString();
await writeFile(join(output,'results.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
