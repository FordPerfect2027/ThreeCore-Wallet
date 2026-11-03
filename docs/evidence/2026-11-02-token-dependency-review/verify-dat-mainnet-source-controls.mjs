#!/usr/bin/env node
// Verify that retrieved compiler inputs stay bound to the recorded DAT source.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readDatMainnetSourceInput} from './dat-mainnet-source-input.mjs';
const dir=dirname(fileURLToPath(import.meta.url)),read=name=>readFileSync(join(dir,name));
const compiler='0.8.34+commit.80d5c536.Emscripten.clang';
const local=JSON.parse(read('source-reconstruction-DAT-input.json'));
const response=JSON.parse(read('dat-mainnet-sourcify-response.json'));
const receipt=JSON.parse(read('dat-mainnet-sourcify-receipt.json'));
function readerFor(mutated,updateDigest=true){
 const bytes=Buffer.from(JSON.stringify(mutated)),copy=structuredClone(receipt);
 if(updateDigest){copy.bytes=bytes.length;copy.sha256=createHash('sha256').update(bytes).digest('hex');}
 return name=>name==='dat-mainnet-sourcify-response.json'?bytes:Buffer.from(JSON.stringify(copy));
}
assert.equal(readDatMainnetSourceInput(read,local,compiler).provenance.unchangedDependencyFiles,21);
const mutations={
 wrongChain:a=>{a.chainId='84532';},
 wrongContract:a=>{a.address='0x'+'11'.repeat(20);},
 wrongDeployment:a=>{a.deployment.transactionHash='0x'+'11'.repeat(32);},
 wrongCompiler:a=>{a.compilation.compilerVersion='0.8.33+commit.64118f21';},
 changedDependency:a=>{a.stdJsonInput.sources['@openzeppelin/contracts/utils/Context.sol'].content+='\n';},
 changedFinalNewline:a=>{a.stdJsonInput.sources['DATCore.sol'].content+='\n';},
 renamedRoot:a=>{a.stdJsonInput.sources['contracts/DATCore.sol']=a.stdJsonInput.sources['DATCore.sol'];delete a.stdJsonInput.sources['DATCore.sol'];},
 changedOptimizer:a=>{a.stdJsonInput.settings.optimizer.enabled=true;}
};
const rejected=[];
for(const[name,mutate]of Object.entries(mutations)){
 const changed=structuredClone(response);mutate(changed);
 // Rehash each changed input so source/context checks, not checksum alone, must reject it.
 assert.throws(()=>readDatMainnetSourceInput(readerFor(changed),local,compiler),undefined,name);
 rejected.push(name);
}
const altered=structuredClone(response);altered.verifiedAt='not-the-original-record';
assert.throws(()=>readDatMainnetSourceInput(readerFor(altered,false),local,compiler));rejected.push('unchangedDigestForModifiedResponse');
const noClaim=structuredClone(response);
delete noClaim.match;delete noClaim.runtimeMatch;delete noClaim.creationMatch;
assert.equal(readDatMainnetSourceInput(readerFor(noClaim),local,compiler).provenance.serviceMatchClaimUsedAsProof,false);
console.log(JSON.stringify({offline:true,untouchedInputAccepted:true,rejectedControls:rejected,
 mutatedSemanticControlsUseUpdatedDigest:true,serviceMatchClaimNotRequired:true,
 sourceOrDependencyExecuted:false,walletUsed:false,rpcUsed:false},null,2));
