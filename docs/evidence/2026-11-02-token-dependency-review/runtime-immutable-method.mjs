import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const root = 'C:/Users/aseet/Documents/Codex/2026-10-26/test-4/work';
const downloads = 'C:/Users/aseet/Downloads';
const { keccak256, encodeAbiParameters, stringToHex, toHex } = createRequire(join(root, 'token-dependency-repair-DAT-20261102/package.json'))('viem');
const sha = value => createHash('sha256').update(value).digest('hex');
const rawComparison = readFileSync(join(downloads, 'ThreeCore-runtime-source-comparison-20261102.json'));
const comparison = JSON.parse(rawComparison);
assert.equal(comparison.errors.length, 0);
const builds = JSON.parse(readFileSync(join(downloads, 'ThreeCore-source-portability-comparison-20261102.json'))).comparisons;
const names = { DAT: 'DATCORE', EMA: 'EMA CORE', CAWELON: 'CAWELON CORE' };
const shortString = value => {
  const bytes = Buffer.from(value, 'utf8'); assert.ok(bytes.length < 32);
  return '0x' + bytes.toString('hex').padEnd(62, '0') + bytes.length.toString(16).padStart(2, '0');
};
const domainType = keccak256(stringToHex('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
const versionHash = keccak256(stringToHex('1'));
const result = { schema: 'threecore-runtime-immutable-comparison-v1', observedAt: new Date().toISOString(),
  comparisonSha256: sha(rawComparison), offline: true, signingPerformed: false, networkRequests: 0,
  rows: [], provesInitialHolderOrStorage: false, authenticatesCompilerSource: false, independentAudit: false };
for (const observation of comparison.observations) for (const row of observation.rows) {
  const build = builds.find(item => item.token === row.token);
  const repo = join(root, `token-dependency-repair-${row.token}-20261102`);
  const artifactBytes = readFileSync(join(repo, `artifacts/contracts/${build.contract}.sol/${build.contract}.json`));
  assert.equal(sha(artifactBytes), build.artifactSha256);
  const artifact = JSON.parse(artifactBytes);
  const buildBytes = readFileSync(join(repo, `artifacts/build-info/${artifact.buildInfoId}.json`));
  assert.equal(sha(buildBytes), build.buildInfoSha256);
  const outputBytes = readFileSync(join(repo, `artifacts/build-info/${artifact.buildInfoId}.output.json`));
  const output = JSON.parse(outputBytes).output;
  const compiled = output.contracts[artifact.inputSourceName][artifact.contractName];
  assert.equal('0x' + compiled.evm.deployedBytecode.object, artifact.deployedBytecode);
  assert.deepEqual(compiled.evm.deployedBytecode.immutableReferences, artifact.immutableReferences);
  const eip712Path = Object.keys(output.sources).filter(key => key.endsWith('/utils/cryptography/EIP712.sol'));
  assert.equal(eip712Path.length, 1);
  const ast = output.sources[eip712Path[0]].ast;
  const variables = new Map();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.nodeType === 'VariableDeclaration' && value.mutability === 'immutable') variables.set(String(value.id), value.name);
    for (const child of Object.values(value)) if (typeof child === 'object') visit(child);
  }
  visit(ast);
  const nameHash = keccak256(stringToHex(names[row.token]));
  const domain = keccak256(encodeAbiParameters(
    [{type:'bytes32'},{type:'bytes32'},{type:'bytes32'},{type:'uint256'},{type:'address'}],
    [domainType,nameHash,versionHash,BigInt(observation.chainId),row.contract]));
  const expected = {
    _cachedDomainSeparator: domain, _cachedChainId: toHex(observation.chainId, {size:32}),
    _cachedThis: '0x' + row.contract.slice(2).padStart(64,'0'), _hashedName: nameHash,
    _hashedVersion: versionHash, _name: shortString(names[row.token]), _version: shortString('1'),
  };
  const seen = new Set(), slots = [];
  let expectedRuntime = artifact.deployedBytecode.toLowerCase();
  for (const [id, ranges] of Object.entries(artifact.immutableReferences)) {
    const name = variables.get(id); assert.ok(Object.hasOwn(expected, name)); seen.add(name);
    for (const range of ranges) {
      assert.equal(range.length,32);
      const start = 2 + range.start * 2, end = start + 64;
      const actual = row.publicRuntimeBytecode.slice(start,end).toLowerCase();
      const wanted = expected[name].slice(2).toLowerCase();
      slots.push({astId:id,name,start:range.start,length:range.length,expected:expected[name],actual:'0x'+actual,matches:actual===wanted});
      expectedRuntime = expectedRuntime.slice(0,start) + wanted + expectedRuntime.slice(end);
    }
  }
  assert.deepEqual([...seen].sort(),Object.keys(expected).sort());
  const code = row.publicRuntimeBytecode.toLowerCase();
  const metadataLength = value => parseInt(value.slice(-4),16) + 2;
  const exec = value => value.slice(0,value.length - metadataLength(value) * 2);
  const allSlotsMatch = slots.every(slot=>slot.matches);
  const executableWithExpectedImmutablesMatches = exec(expectedRuntime) === exec(code);
  // Controls retain all original bytes. Mutate copies only; a failed comparison
  // must stay failed even when metadata is deliberately excluded from this view.
  const mutate = (value, byte) => {
    const offset=2+byte*2, replacement=(parseInt(value.slice(offset,offset+2),16)^1).toString(16).padStart(2,'0');
    return value.slice(0,offset)+replacement+value.slice(offset+2);
  };
  for (const slot of slots) assert.notEqual(exec(mutate(code,slot.start)),exec(expectedRuntime));
  assert.notEqual(exec(mutate(code,0)),exec(expectedRuntime));
  const metadataOffset=(code.length-2)/2-metadataLength(code);
  const alteredMetadata=mutate(code,metadataOffset+1);
  assert.equal(exec(alteredMetadata),exec(code)); assert.notEqual(alteredMetadata,code);
  result.rows.push({token:row.token,chainId:observation.chainId,blockNumber:observation.blockNumber,
    blockHash:observation.blockHash,contract:row.contract,artifactSha256:sha(artifactBytes),
    buildInfoSha256:sha(buildBytes),compilerOutputSha256:sha(outputBytes),eip712AstSource:eip712Path[0],
    slots,allSlotsMatch,executableWithExpectedImmutablesMatches,
    fullRuntimeWithExpectedImmutablesMatches:expectedRuntime===code,
    negativeImmutableAndExecutableControls:slots.length+1,metadataExclusionControl:true,
    limits:['Compiler metadata remains compared separately.','No constructor transaction or storage/initial-holder proof.','No signature, transaction or private wallet material was used.']});
}
writeFileSync(join(downloads,'ThreeCore-runtime-immutables-20261102.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result.rows.map(({token,chainId,allSlotsMatch,executableWithExpectedImmutablesMatches,fullRuntimeWithExpectedImmutablesMatches,negativeImmutableAndExecutableControls})=>({token,chainId,allSlotsMatch,executableWithExpectedImmutablesMatches,fullRuntimeWithExpectedImmutablesMatches,negativeImmutableAndExecutableControls})),null,2));
