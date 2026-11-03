import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const output='C:/Users/aseet/Downloads/ThreeCore-metadata-path-reconstruction-20261102';
const repo='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-dependency-repair-DAT-20261102';
const solc=createRequire(repo+'/package.json')('solc');
const evidence='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/threecore-wallet-operation-rehearsal-20261029/docs/evidence/2026-11-02-token-dependency-review';
const observed=JSON.parse(await readFile(evidence+'/runtime-public-comparison.json','utf8'));
const results=[];
for(const variant of ['unversioned-import-paths','root-contract-path']){
 const input=JSON.parse(await readFile(output+'/DAT-'+variant+'-input.json','utf8'));
 const source=Object.keys(input.sources).find(p=>p.endsWith('/DATCore.sol')||p==='DATCore.sol');assert(source);
 const content=input.sources[source].content;assert(!content.includes('\r'));
 input.sources[source].content=content.replaceAll('\n','\r\n');
 const result=JSON.parse(solc.compile(JSON.stringify(input)));assert(!(result.errors||[]).some(e=>e.severity==='error'));
 const artifact=result.contracts[source].DATCore,code=Buffer.from(artifact.evm.deployedBytecode.object,'hex'),size=code.readUInt16BE(code.length-2),trailer='0x'+code.subarray(code.length-2-size).toString('hex');
 const row={variant:variant+'-project-crlf',sourceSha256:createHash('sha256').update(input.sources[source].content).digest('hex'),compiledMetadataTrailer:trailer,comparisons:observed.observations.map(o=>({chainId:o.chainId,metadataMatches:o.rows.find(r=>r.token==='DAT').onchainMetadata===trailer}))};
 results.push(row);console.log(JSON.stringify(row));
 await writeFile(output+'/DAT-'+row.variant+'-input.json',JSON.stringify(input),{flag:'wx'});
 await writeFile(output+'/DAT-'+row.variant+'-metadata.json',artifact.metadata,{flag:'wx'});
}
await writeFile(output+'/dat-crlf-results.json',JSON.stringify(results,null,2)+'\n',{flag:'wx'});
