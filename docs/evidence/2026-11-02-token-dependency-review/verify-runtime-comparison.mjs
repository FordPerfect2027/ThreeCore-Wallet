#!/usr/bin/env node
// Offline reproduction of this recorded comparison; no RPC or wallet access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
if(process.argv.length!==3)throw Error('Usage: node verify-runtime-comparison.mjs <token-checkout-with-viem-installed>');
const dir=dirname(fileURLToPath(import.meta.url));
const {keccak256,stringToHex,encodeAbiParameters,toHex}=createRequire(join(resolve(process.argv[2]),'package.json'))('viem');
const sha=b=>createHash('sha256').update(b).digest('hex');
const read=name=>readFileSync(join(dir,name));
const publicBytes=read('runtime-public-comparison.json'), report=JSON.parse(publicBytes);
const immutable=JSON.parse(read('runtime-immutables.json'));
const bindings=JSON.parse(read('runtime-immutable-bindings.json')).bindings;
assert.equal(immutable.comparisonSha256,sha(publicBytes));
assert.equal(report.errors.length,0);assert.equal(report.observations.length,2);
const names={DAT:'DATCORE',EMA:'EMA CORE',CAWELON:'CAWELON CORE'};
const short=value=>{const b=Buffer.from(value);assert.ok(b.length<32);return '0x'+b.toString('hex').padEnd(62,'0')+b.length.toString(16).padStart(2,'0');};
const decodeMetadata=value=>{
  assert.match(value,/^0x(?:[0-9a-f]{2})+$/i);
  const size=parseInt(value.slice(-4),16)+2;
  assert.ok(size>2&&size<(value.length-2)/2);
  const metadata='0x'+value.slice(-size*2).toLowerCase();
  // Recognize exactly the recorded compiler's two-field trailer, including
  // the SHA-256 multihash marker and the explicit 51-byte CBOR length.
  assert.match(metadata,/^0xa2646970667358221220[0-9a-f]{64}64736f6c63430008220033$/);
  return {executable:value.slice(0,-size*2).toLowerCase(),metadata};
};
let checked=0,full=0,controls=0;
const seen=new Set();
for(const observation of report.observations){
  assert.ok([8453,84532].includes(observation.chainId));assert.equal(observation.rows.length,3);
  assert.match(observation.blockHash,/^0x[0-9a-f]{64}$/i);
  assert.ok(observation.canonicalHashRequired&&observation.canonicalHeaderRechecked&&observation.chainRechecked);
  assert.ok(observation.methods.every(x=>['eth_chainId','eth_getBlockByNumber','eth_getCode'].includes(x)));
  for(const row of observation.rows){
    const key=observation.chainId+':'+row.token;assert.ok(!seen.has(key));seen.add(key);
    const binding=bindings.find(x=>x.token===row.token);assert.ok(binding&&names[row.token]);
    const bytes=read(`source-${row.token}-artifact.json`);assert.equal(sha(bytes),row.artifactSha256);assert.equal(sha(bytes),binding.artifactSha256);
    const artifact=JSON.parse(bytes), snapshot=immutable.rows.find(x=>x.token===row.token&&x.chainId===observation.chainId);
    assert.ok(snapshot);assert.equal(snapshot.blockHash,observation.blockHash);assert.equal(snapshot.contract,row.contract);
    assert.equal(snapshot.compilerOutputSha256,binding.compilerOutputSha256);
    assert.equal(keccak256(row.publicRuntimeBytecode),row.onchainRuntimeKeccak256);
    const hname=keccak256(stringToHex(names[row.token])),hversion=keccak256(stringToHex('1'));
    const values={_cachedDomainSeparator:keccak256(encodeAbiParameters(
      [{type:'bytes32'},{type:'bytes32'},{type:'bytes32'},{type:'uint256'},{type:'address'}],
      [keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),hname,hversion,BigInt(observation.chainId),row.contract])),
      _cachedChainId:toHex(observation.chainId,{size:32}),_cachedThis:'0x'+row.contract.slice(2).padStart(64,'0'),
      _hashedName:hname,_hashedVersion:hversion,_name:short(names[row.token]),_version:short('1')};
    let expected=artifact.deployedBytecode.toLowerCase();const used=new Set(),ranges=[];
    const code=row.publicRuntimeBytecode.toLowerCase(), deployed=decodeMetadata(code),local=decodeMetadata(expected);
    assert.equal(row.localMetadata,local.metadata);assert.equal(row.onchainMetadata,deployed.metadata);
    for(const [id,slots]of Object.entries(artifact.immutableReferences)){
      const variable=binding.variables.find(x=>x.id===id);assert.ok(variable&&Object.hasOwn(values,variable.name));
      assert.equal(variable.mutability,'immutable');assert.ok(!used.has(variable.name));used.add(variable.name);
      for(const slot of slots){assert.equal(slot.length,32);assert.ok(Number.isSafeInteger(slot.start)&&slot.start>=0&&2+(slot.start+32)*2<=local.executable.length);
        ranges.push(slot);const start=2+slot.start*2,end=start+64;
        const value=values[variable.name].slice(2).toLowerCase();assert.equal(code.slice(start,end),value);
        expected=expected.slice(0,start)+value+expected.slice(end);
      }
    }
    assert.deepEqual([...used].sort(),Object.keys(values).sort());
    ranges.sort((a,b)=>a.start-b.start);for(let i=1;i<ranges.length;i++)assert.ok(ranges[i-1].start+32<=ranges[i].start);
    assert.equal(decodeMetadata(expected).executable,deployed.executable);
    assert.equal(snapshot.allSlotsMatch,true);assert.equal(snapshot.executableWithExpectedImmutablesMatches,true);
    assert.equal(snapshot.fullRuntimeWithExpectedImmutablesMatches,expected===code);
    assert.equal(row.metadataMatches,local.metadata===deployed.metadata);
    const masked=value=>{let next=value.toLowerCase();for(const slot of ranges){const p=2+slot.start*2;next=next.slice(0,p)+'0'.repeat(64)+next.slice(p+64);}return next;};
    assert.equal(row.localNormalizedRuntimeKeccak256,keccak256(masked(artifact.deployedBytecode)));
    assert.equal(row.onchainNormalizedRuntimeKeccak256,keccak256(masked(code)));
    assert.equal(row.immutableNormalizedRuntimeMatches,masked(artifact.deployedBytecode)===masked(code));
    assert.equal(row.immutableNormalizedExecutableMatches,decodeMetadata(masked(artifact.deployedBytecode)).executable===decodeMetadata(masked(code)).executable);
    for(const offset of [0,...ranges.map(r=>r.start)]){
      const p=2+offset*2,mutated=code.slice(0,p)+(parseInt(code.slice(p,p+2),16)^1).toString(16).padStart(2,'0')+code.slice(p+2);
      assert.notEqual(decodeMetadata(mutated).executable,decodeMetadata(expected).executable);controls++;
    }
    checked++;if(expected===code)full++;
  }
}
assert.equal(checked,6);assert.equal(immutable.rows.length,6);
console.log(JSON.stringify({offline:true,observationsChecked:checked,executableAndImmutableMatches:checked,
  completeRuntimeMatches:full,metadataDifferences:checked-full,mutationControls:controls,
  currentChainReverified:false,sourceMetadataAuthenticated:false,initialHolderOrStorageVerified:false,independentAudit:false},null,2));
