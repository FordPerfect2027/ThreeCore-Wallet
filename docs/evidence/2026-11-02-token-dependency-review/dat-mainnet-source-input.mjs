// Offline provenance check for the DAT Mainnet compiler input retrieved from Sourcify.
// The returned Solidity is compiled as data, never executed or submitted.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function readDatMainnetSourceInput(read, localInput, compilerVersion) {
 const bytes=read('dat-mainnet-sourcify-response.json');
 const receipt=JSON.parse(read('dat-mainnet-sourcify-receipt.json'));
 assert.equal(receipt.url,'https://sourcify.dev/server/v2/contract/8453/0x6c83dd253f2f882b9884fd1ac3a7754ed6405de5?fields=all');
 assert.equal(receipt.method,'GET');assert.equal(receipt.status,200);
 assert.equal(receipt.credentialsUsed,false);assert.equal(receipt.submission,false);
 assert.equal(bytes.length,receipt.bytes);assert.equal(sha(bytes),receipt.sha256);
 const response=JSON.parse(bytes),input=response.stdJsonInput;
 assert.equal(String(response.chainId),'8453');
 assert.equal(response.address.toLowerCase(),'0x6c83dd253f2f882b9884fd1ac3a7754ed6405de5');
 assert.equal(response.deployment.transactionHash.toLowerCase(),'0x49cb417f0231eb149d60bcc471d0676a0643eb5cfc319741d8452c6e5d9cb589');
 assert.equal(String(response.deployment.blockNumber),'51281431');
 assert.equal(response.compilation.compilerVersion,compilerVersion.replace(/\.Emscripten\.clang$/,''));
 assert.equal(response.metadata.compiler.version,response.compilation.compilerVersion);
 assert.equal(response.compilation.fullyQualifiedName,'DATCore.sol:DATCore');
 assert.equal(input.language,'Solidity');assert.equal(localInput.language,'Solidity');
 assert.deepEqual(input.settings,{libraries:{},optimizer:{runs:200,enabled:false}});
 const mapped=Object.fromEntries(Object.entries(localInput.sources).map(([path,value])=>[
  path.replace('npm/@openzeppelin/contracts@5.6.1/','@openzeppelin/contracts/').replace(/^project\/contracts\//,''),value
 ]));
 assert.equal(Object.keys(mapped).length,22);
 assert.deepEqual(Object.keys(input.sources).sort(),Object.keys(mapped).sort());
 let unchanged=0;
 for(const [path,source]of Object.entries(input.sources)){
  assert.deepEqual(Object.keys(source),['content']);assert.equal(typeof source.content,'string');
  if(path==='DATCore.sol')assert.equal(mapped[path].content,source.content+'\n');
  else{assert.equal(mapped[path].content,source.content);unchanged++;}
 }
 assert.equal(unchanged,21);
 return {input:structuredClone(input),metadata:response.metadata,
  provenance:{service:'Sourcify',responseSha256:receipt.sha256,compilerVersion:response.compilation.compilerVersion,
   sourceFiles:22,unchangedDependencyFiles:21,localRootSourceHasOneAdditionalFinalLF:true,
   publishedRootPath:'DATCore.sol',localRootPath:'project/contracts/DATCore.sol',
   compiledAgainstIndependentRecordedRpc:true,serviceMatchClaimUsedAsProof:false}};
}
