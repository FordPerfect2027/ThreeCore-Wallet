import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root='C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work/token-dependency-repair-DAT-20261102';
const out='C:/Users/aseet/Downloads/ThreeCore-sepolia-artifact-diagnosis-20261102';mkdirSync(out,{recursive:true});
const require=createRequire(root+'/package.json'),solc=require('solc');
const {keccak256}=await import(pathToFileURL(root+'/node_modules/viem/_esm/index.js'));
const {verifySepoliaDeployment}=await import(pathToFileURL(root+'/src/sepolia-deployment-verifier.js'));
const artifact=JSON.parse(readFileSync(root+'/artifacts/contracts/DATCore.sol/DATCore.json'));
const deployment=JSON.parse(readFileSync(root+'/deployments/base-sepolia.json'));
const buildPath=root+'/artifacts/build-info/'+artifact.buildInfoId+'.json',buildBytes=readFileSync(buildPath),build=JSON.parse(buildBytes);
const sha=b=>createHash('sha256').update(b).digest('hex');
function normalized(bytecode,references){const hex=bytecode.slice(2).split('');for(const ranges of Object.values(references))for(const{start,length}of ranges)hex.fill('0',start*2,(start+length)*2);return '0x'+hex.join('');}
let calls=0,preflight;
try{await verifySepoliaDeployment({request(){calls++;throw Error('Unexpected network');}},deployment,artifact);preflight='UNEXPECTED_PASS';}catch(e){preflight=e.code??e.message;}
const contract=readFileSync(root+'/contracts/DATCore.sol');
const input=structuredClone(build.input);input.sources['project/contracts/DATCore.sol'].content=input.sources['project/contracts/DATCore.sol'].content.replaceAll('\r\n','\n');
writeFileSync(out+'/lf-only-input.json',JSON.stringify(input));
const compiled=JSON.parse(solc.compile(JSON.stringify(input)));
const errors=(compiled.errors??[]).filter(e=>e.severity==='error');if(errors.length)throw Error('LF compilation failed');
const c=compiled.contracts['project/contracts/DATCore.sol'].DATCore;
const lfArtifact={abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,deployedBytecode:'0x'+c.evm.deployedBytecode.object,immutableReferences:c.evm.deployedBytecode.immutableReferences};
writeFileSync(out+'/lf-only-artifact.json',JSON.stringify(lfArtifact,null,2)+'\n');
const result={recordedAt:new Date().toISOString(),solc:solc.version(),buildInfoSha256:sha(buildBytes),recordedContractSourceSha256:deployment.contractSourceSha256,workingSourceSha256:sha(contract),lfSourceSha256:sha(contract.toString().replaceAll('\r\n','\n')),
recordedCreationHash:deployment.creationBytecodeKeccak256,recordedNormalizedRuntimeHash:deployment.immutableNormalizedRuntimeBytecodeKeccak256,
currentCreationHash:keccak256(artifact.bytecode),currentNormalizedRuntimeHash:keccak256(normalized(artifact.deployedBytecode,artifact.immutableReferences)),
lfOnlyCreationHash:keccak256(lfArtifact.bytecode),lfOnlyNormalizedRuntimeHash:keccak256(normalized(lfArtifact.deployedBytecode,lfArtifact.immutableReferences)),preflight,networkRequests:calls,
scope:'One isolated solc standard-JSON compilation changing only project source CRLF to LF; existing outputs and source files unchanged; no wallet or RPC'};
result.lfOnlyMatchesRecord=result.lfOnlyCreationHash===result.recordedCreationHash&&result.lfOnlyNormalizedRuntimeHash===result.recordedNormalizedRuntimeHash;
writeFileSync(out+'/result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
