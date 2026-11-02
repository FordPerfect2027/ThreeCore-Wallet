import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const work = resolve(process.argv[2]), output = resolve(process.argv[3]);
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const rows = [];
for (const [token, contract, parent] of [
  ['DAT', 'DATCore', '502944c94ffed408356b487abc9a710807697ee2'],
  ['EMA', 'EMACore', '9cad39a196e8afc37abb5b99c260e00327c55d1c'],
  ['CAWELON', 'CAWELONCore', 'e3a5fbb966008319b7b7204ddbfb705a3e9ab12c'],
]) {
  const baseline = resolve(work, `token-dependency-repair-${token}-20261102`);
  const candidate = resolve(work, `token-toolchain-empty-data-${token}-20261102`);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: baseline, encoding: 'utf8', windowsHide: true }).trim(), parent);
  const artifact = `artifacts/contracts/${contract}.sol/${contract}.json`, source = `contracts/${contract}.sol`;
  const beforeBytes = readFileSync(resolve(baseline, artifact)), afterBytes = readFileSync(resolve(candidate, artifact));
  const before = JSON.parse(beforeBytes), after = JSON.parse(afterBytes);
  const changedFields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  assert.deepEqual(changedFields, ['buildInfoId'], `${token} unexpected artifact change`);
  assert.deepEqual(after.abi, before.abi);
  assert.equal(after.bytecode, before.bytecode);
  assert.equal(after.deployedBytecode, before.deployedBytecode);
  assert.deepEqual(readFileSync(resolve(candidate, source)), readFileSync(resolve(baseline, source)));
  const beforePackage = JSON.parse(readFileSync(resolve(baseline, 'package.json')));
  const afterPackage = JSON.parse(readFileSync(resolve(candidate, 'package.json')));
  assert.deepEqual(afterPackage.dependencies, beforePackage.dependencies);
  assert.equal(afterPackage.devDependencies.solc, beforePackage.devDependencies.solc);
  rows.push({ token, parent, artifact, changedFields, abiEqual: true, creationBytecodeEqual: true,
    runtimeBytecodeEqual: true, contractSourceEqual: true, runtimeDependenciesEqual: true,
    compilerVersion: afterPackage.devDependencies.solc, sourceSha256: hash(readFileSync(resolve(candidate, source))),
    beforeArtifactSha256: hash(beforeBytes), afterArtifactSha256: hash(afterBytes),
    beforeBuildInfoId: before.buildInfoId, afterBuildInfoId: after.buildInfoId });
}
writeFileSync(output, JSON.stringify({ schema: 'threecore.toolchain-artifact-comparison.v1', tokens: rows }, null, 2) + '\n');
console.log(JSON.stringify({ tokens: rows.length, allBytecodesEqual: true, changedFields: ['buildInfoId'] }));
