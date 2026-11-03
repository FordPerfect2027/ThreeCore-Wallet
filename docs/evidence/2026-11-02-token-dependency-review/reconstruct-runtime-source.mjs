#!/usr/bin/env node
// Recompile recorded inputs offline. Never connects to RPC or a wallet.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readDatMainnetSourceInput} from './dat-mainnet-source-input.mjs';
if(process.argv.length!==3)throw Error('Usage: node reconstruct-runtime-source.mjs <token-checkout-with-solc-and-viem>');
const dir=dirname(fileURLToPath(import.meta.url));
const require=createRequire(join(resolve(process.argv[2]),'package.json'));
const solc=require('solc'),{keccak256,stringToHex,encodeAbiParameters,toHex}=require('viem');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=name=>readFileSync(join(dir,name));
const manifest=JSON.parse(read('source-reconstruction-inputs.json'));
assert.equal(solc.version(),manifest.compilerVersion);
assert.equal(sha(readFileSync(require.resolve('solc/soljson.js'))),manifest.soljsonSha256);
const publicBytes=read('runtime-public-comparison.json');
assert.equal(sha(publicBytes),manifest.publicRecordSha256);
const observed=JSON.parse(publicBytes);assert.equal(observed.errors.length,0);
const names={DAT:'DATCORE',EMA:'EMA CORE',CAWELON:'CAWELON CORE'};
const short=value=>{const bytes=Buffer.from(value);assert(bytes.length<32);return '0x'+bytes.toString('hex').padEnd(62,'0')+bytes.length.toString(16).padStart(2,'0');};
function split(code){assert.match(code,/^0x(?:[a-f0-9]{2})+$/);const n=parseInt(code.slice(-4),16)+2;assert(n>2&&n<(code.length-2)/2);const metadata='0x'+code.slice(-n*2);assert.match(metadata,/^0xa2646970667358221220[0-9a-f]{64}64736f6c63430008220033$/);return {executable:code.slice(0,-n*2),metadata};}
function transformed(original){
 const input=structuredClone(original);
 input.sources=Object.fromEntries(Object.entries(original.sources).map(([path,value])=>[
  path.startsWith('npm/@openzeppelin/contracts@5.6.1/')?path.replace('npm/@openzeppelin/contracts@5.6.1/','@openzeppelin/contracts/'):path.replace(/^project\//,''),value]));
 assert.equal(Object.keys(input.sources).length,Object.keys(original.sources).length);
 const oldContents=Object.values(original.sources).map(v=>sha(v.content)).sort();
 assert.deepEqual(Object.values(input.sources).map(v=>sha(v.content)).sort(),oldContents);
 delete input.settings.remappings;
 return input;
}
function compile(input,token){
 input=structuredClone(input);
 input.settings.outputSelection={'*':{'':['ast'],'*':['metadata','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences']}};
 const result=JSON.parse(solc.compile(JSON.stringify(input)));
 assert.deepEqual((result.errors||[]).filter(e=>e.severity==='error'),[]);
 const target=Object.keys(input.sources).find(p=>p===token+'Core.sol'||p.endsWith('/'+token+'Core.sol'));assert(target);
 const contract=result.contracts[target][token+'Core'];assert(contract);
 const eip=Object.keys(result.sources).find(p=>p.endsWith('/utils/cryptography/EIP712.sol'));assert(eip);
 const bindings=new Map(),pending=[result.sources[eip].ast];
 while(pending.length){const node=pending.pop();if(!node||typeof node!=='object')continue;
  if(node.nodeType==='VariableDeclaration'&&node.mutability==='immutable'){assert(!bindings.has(String(node.id)));bindings.set(String(node.id),node.name);}
  for(const value of Object.values(node))if(value&&typeof value==='object')Array.isArray(value)?pending.push(...value):pending.push(value);
 }
 const runtime='0x'+contract.evm.deployedBytecode.object.toLowerCase();split(runtime);
 return {runtime,refs:contract.evm.deployedBytecode.immutableReferences,bindings,metadata:contract.metadata};
}
function expectedRuntime(compiled,token,chainId,contract){
 const nameHash=keccak256(stringToHex(names[token])),versionHash=keccak256(stringToHex('1'));
 const values={_cachedDomainSeparator:keccak256(encodeAbiParameters([{type:'bytes32'},{type:'bytes32'},{type:'bytes32'},{type:'uint256'},{type:'address'}],
  [keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),nameHash,versionHash,BigInt(chainId),contract])),
  _cachedChainId:toHex(chainId,{size:32}),_cachedThis:'0x'+contract.slice(2).padStart(64,'0'),_hashedName:nameHash,_hashedVersion:versionHash,_name:short(names[token]),_version:short('1')};
 let expected=compiled.runtime;const used=new Set(),ranges=[];
 for(const[id,slots]of Object.entries(compiled.refs)){
  const name=compiled.bindings.get(id);assert(Object.hasOwn(values,name));assert(!used.has(name));used.add(name);
  for(const {start,length}of slots){assert(Number.isSafeInteger(start)&&start>=0&&length===32);const from=2+start*2,end=from+64;assert(end<=split(expected).executable.length);
   ranges.push({start,length});assert.equal(expected.slice(from,end),'0'.repeat(64));expected=expected.slice(0,from)+values[name].slice(2).toLowerCase()+expected.slice(end);}
 }
 assert.deepEqual([...used].sort(),Object.keys(values).sort());ranges.sort((a,b)=>a.start-b.start);for(let i=1;i<ranges.length;i++)assert(ranges[i-1].start+32<=ranges[i].start);
 return {expected,ranges};
}
const rows=[];let commentControl=false,datProvenance=null;
for(const entry of manifest.inputs){
 const bytes=read(entry.file);assert.equal(sha(bytes),entry.sha256);
 const input=JSON.parse(bytes),source=Object.keys(input.sources).find(p=>p==='project/contracts/'+entry.token+'Core.sol');assert(source);
 assert.equal(sha(input.sources[source].content),entry.projectSourceSha256);
 const candidate=transformed(input),baselineBuild=compile(input,entry.token),candidateBuild=compile(candidate,entry.token);
 const recovered=entry.token==='DAT'?readDatMainnetSourceInput(read,input,solc.version()):null;
 const recoveredBuild=recovered?compile(recovered.input,entry.token):null;
 if(recovered){assert.deepEqual(JSON.parse(recoveredBuild.metadata),recovered.metadata);datProvenance=recovered.provenance;}
 for(const observation of observed.observations){
  assert([8453,84532].includes(observation.chainId));const row=observation.rows.find(r=>r.token===entry.token);assert(row);
  const chainCode=row.publicRuntimeBytecode.toLowerCase();assert.equal(keccak256(chainCode),row.onchainRuntimeKeccak256);
  const baseline=expectedRuntime(baselineBuild,entry.token,observation.chainId,row.contract);
  const restored=expectedRuntime(candidateBuild,entry.token,observation.chainId,row.contract);
  assert.equal(split(baseline.expected).executable,split(chainCode).executable);
  assert.equal(split(restored.expected).executable,split(chainCode).executable);
  const matchBaseline=baseline.expected===chainCode,matchCandidate=restored.expected===chainCode;
  assert.equal(matchBaseline,entry.token==='DAT'&&observation.chainId===84532);
  assert.equal(matchCandidate,entry.token!=='DAT');
  const exactRecovered=recoveredBuild?expectedRuntime(recoveredBuild,entry.token,observation.chainId,row.contract):null;
  const recoveredMatches=exactRecovered?.expected===chainCode;
  assert.equal(recoveredMatches,entry.token==='DAT'&&observation.chainId===8453);
  const chosen=recoveredMatches?exactRecovered:matchCandidate?restored:baseline;
  if(matchBaseline||matchCandidate||recoveredMatches){for(const offset of [0,chosen.ranges[0].start,(chainCode.length-2)/2-12]){
   const p=2+offset*2,mutated=chainCode.slice(0,p)+(parseInt(chainCode.slice(p,p+2),16)^1).toString(16).padStart(2,'0')+chainCode.slice(p+2);assert.notEqual(chosen.expected,mutated);
  }}
  rows.push({token:entry.token,chainId:observation.chainId,blockNumber:observation.blockNumber,blockHash:observation.blockHash,contract:row.contract,
   unchangedInputFullMatch:matchBaseline,unversionedPathFullMatch:matchCandidate,recoveredPublishedInputFullMatch:recoveredMatches,completeRuntimeMatch:matchBaseline||matchCandidate||recoveredMatches,
   expectedImmutablesIncluded:true,metadataIncluded:true,sourceContentsUnchanged:!recoveredMatches,
   sourceAdjustment:recoveredMatches?'published root path and removal of one final LF, authenticated against retrieved source':'paths only or original input'});
 }
 if(entry.token==='EMA'){
  const changed=structuredClone(candidate);changed.sources['contracts/EMACore.sol'].content+='\n// Reconstruction negative control.\n';
  const changedBuild=compile(changed,entry.token),o=observed.observations.find(x=>x.chainId===8453),row=o.rows.find(x=>x.token===entry.token);
  const original=expectedRuntime(candidateBuild,entry.token,o.chainId,row.contract).expected,mutated=expectedRuntime(changedBuild,entry.token,o.chainId,row.contract).expected;
  assert.equal(split(original).executable,split(mutated).executable);assert.notEqual(original,mutated);assert.notEqual(split(original).metadata,split(mutated).metadata);commentControl=true;
 }
}
assert.equal(rows.length,6);assert.equal(rows.filter(r=>r.completeRuntimeMatch).length,6);assert(commentControl);
console.log(JSON.stringify({offline:true,compiler:solc.version(),rows,completeRuntimeMatches:6,remainingMetadataMismatches:[],datMainnetSourceProvenance:datProvenance,
 controls:{changedExecutableRejected:true,changedImmutableRejected:true,changedMetadataRejected:true,sourceCommentOnlyChangeRejected:commentControl},
 currentChainReverified:false,initialHolderOrStorageVerified:false,independentAudit:false},null,2));
