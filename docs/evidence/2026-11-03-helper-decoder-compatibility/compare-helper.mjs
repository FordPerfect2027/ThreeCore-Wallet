import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [baselineRoot, candidateRoot, outputPath] = process.argv.slice(2);
assert(baselineRoot && candidateRoot && outputPath, 'Expected baseline, candidate, and output paths');
const address = '0x' + '11'.repeat(20);
const hash = '0x' + '22'.repeat(32);
let functionCalls = 0;
const unusedFunction = () => { functionCalls++; throw new Error('Schema validation must not invoke configuration functions'); };
const variable = { _type: 'ConfigurationVariable', name: 'FICTIONAL_NAME', default: 'fictional', format: '{variable}' };
const resolvedVariable = { _type: 'ResolvedConfigurationVariable', get: unusedFunction, getUrl: unusedFunction, getBigInt: unusedFunction, getHexString: unusedFunction };
const fixtures = [];
function add(name, area, schema, value, valid) { fixtures.push({ name, area, schema, value, valid }); }
for (const [name, value, valid] of [
  ['empty', '0x', true], ['zero byte', '0x00', true], ['mixed-case bytes', '0xaBcD', true],
  ['buffer', Buffer.from([0, 255]), true], ['odd length', '0x0', false],
  ['non-hex', '0xzz', false], ['number', 0, false], ['null', null, false],
]) add('data / ' + name, 'rpc', 'rpcData', value, valid);
for (const [name, value, valid] of [
  ['zero', '0x0', true], ['one', '0x1', true], ['large exact integer', '0x20000000000001', true],
  ['bigint', 9007199254740993n, true], ['empty', '0x', false], ['leading zero', '0x01', false],
  ['negative hex', '-0x1', false], ['decimal number', 1, false], ['null', null, false],
]) add('quantity / ' + name, 'rpc', 'rpcQuantity', value, valid);
for (const [name, value, valid] of [
  ['hex', address, true], ['buffer', Buffer.alloc(20, 17), true],
  ['short string', '0x' + '11'.repeat(19), false], ['long string', '0x' + '11'.repeat(21), false],
  ['short buffer', Buffer.alloc(19), false], ['null', null, false],
]) add('address / ' + name, 'rpc', 'rpcAddress', value, valid);
add('nullable address / null', 'rpc', 'nullableRpcAddress', null, true);
add('nullable address / absent', 'rpc', 'nullableRpcAddress', undefined, false);
for (const [name, value, valid] of [
  ['hex', hash, true], ['buffer', Buffer.alloc(32, 34), true],
  ['short', '0x' + '22'.repeat(31), false], ['long', '0x' + '22'.repeat(33), false],
]) add('hash / ' + name, 'rpc', 'rpcHash', value, valid);
for (const [name, value, valid] of [
  ['zero', '0x0', true], ['one', '0x1', true], ['two-character one', '0x01', true], ['invalid hex', '0xgg', false],
]) add('parity encoding / ' + name, 'rpc', 'rpcParity', value, valid);
add('access list / empty', 'rpc', 'rpcAccessList', [], true);
add('access list / encoded values', 'rpc', 'rpcAccessList', [{ address, storageKeys: [hash] }], true);
add('access list / nullable keys', 'rpc', 'rpcAccessList', [{ address, storageKeys: null }], true);
add('access list / invalid nested bytes', 'rpc', 'rpcAccessList', [{ address, storageKeys: ['0xz0'] }], false);
add('access list / missing address', 'rpc', 'rpcAccessList', [{ storageKeys: [] }], false);
// These are inert data objects. No provider, signer, transaction executor, or key store is imported.
add('request schema / minimal', 'rpc', 'rpcTransactionRequest', { from: address }, true);
add('request schema / empty data and exact quantity', 'rpc', 'rpcTransactionRequest', { from: address, to: null, data: '0x', value: '0x20000000000001' }, true);
add('request schema / nested values', 'rpc', 'rpcTransactionRequest', { from: address, to: address, gas: '0x5208', accessList: [{ address, storageKeys: [hash] }], blobVersionedHashes: [hash] }, true);
add('request schema / missing sender', 'rpc', 'rpcTransactionRequest', { to: address }, false);
add('request schema / malformed amount', 'rpc', 'rpcTransactionRequest', { from: address, value: '0x01' }, false);
add('request schema / invalid nested hash', 'rpc', 'rpcTransactionRequest', { from: address, blobVersionedHashes: ['0x22'] }, false);
add('configuration variable / valid', 'helper', 'configurationVariableSchema', variable, true);
add('configuration variable / invalid name', 'helper', 'configurationVariableSchema', { ...variable, name: 1 }, false);
add('configuration variable / invalid marker', 'helper', 'configurationVariableSchema', { ...variable, _type: 'fictional' }, false);
add('resolved variable / functions remain uncalled', 'helper', 'resolvedConfigurationVariableSchema', resolvedVariable, true);
add('resolved variable / nonfunction rejected', 'helper', 'resolvedConfigurationVariableSchema', { ...resolvedVariable, get: false }, false);
add('sensitive string / literal', 'helper', 'sensitiveStringSchema', 'fictional', true);
add('sensitive string / variable', 'helper', 'sensitiveStringSchema', variable, true);
add('sensitive string / wrong type', 'helper', 'sensitiveStringSchema', 42, false);
add('sensitive URL / literal', 'helper', 'sensitiveUrlSchema', 'https://example.invalid/path', true);
add('sensitive URL / variable', 'helper', 'sensitiveUrlSchema', variable, true);
add('sensitive URL / malformed', 'helper', 'sensitiveUrlSchema', 'not a URL', false);

function normalized(value) {
  if (typeof value === 'bigint') return { bigint: String(value) };
  if (typeof value === 'function') return { function: true };
  if (value === undefined) return { undefined: true };
  if (value instanceof Uint8Array) return { bytes: Buffer.from(value).toString('hex') };
  if (Array.isArray(value)) return value.map(normalized);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])]));
  return value;
}
async function observe(root) {
  const require = createRequire(join(resolve(root), 'package.json'));
  const helperPath = require.resolve('@nomicfoundation/hardhat-zod-utils');
  const helper = await import(pathToFileURL(helperPath));
  const rpc = await import(pathToFileURL(require.resolve('@nomicfoundation/hardhat-zod-utils/rpc')));
  const fromHelper = createRequire(helperPath);
  const { z } = await import(pathToFileURL(fromHelper.resolve('zod')));
  const observations = fixtures.map(fixture => {
    try {
      const result = (fixture.area === 'rpc' ? rpc : helper)[fixture.schema].safeParse(fixture.value);
      return result.success ? { name: fixture.name, success: true, value: normalized(result.data) } : {
        name: fixture.name, success: false, paths: result.error.issues.map(issue => issue.path.map(String)),
        messages: result.error.issues.map(issue => issue.message),
      };
    } catch (error) { return { name: fixture.name, threw: { name: error.name, message: error.message } }; }
  });
  const parameterFixtures = [
    { name: 'parameter arity / exact', input: [address, '0x0'], types: [rpc.rpcAddress, rpc.rpcQuantity], valid: true },
    { name: 'parameter arity / too few', input: [address], types: [rpc.rpcAddress, rpc.rpcQuantity], valid: false },
    { name: 'parameter arity / too many', input: [address, '0x0', '0x1'], types: [rpc.rpcAddress, rpc.rpcQuantity], valid: false },
    { name: 'parameter arity / omitted optional', input: [address], types: [rpc.rpcAddress, rpc.rpcQuantity.optional()], valid: true },
    { name: 'parameter arity / explicit optional', input: [address, '0x1'], types: [rpc.rpcAddress, rpc.rpcQuantity.optional()], valid: true },
    { name: 'parameter arity / no arguments', input: [], types: [], valid: true },
    { name: 'parameter arity / unexpected argument', input: [1], types: [], valid: false },
    { name: 'parameter value / wrong type', input: ['0xzz'], types: [rpc.rpcAddress], valid: false },
  ];
  for (const fixture of parameterFixtures) {
    try { observations.push({ name: fixture.name, success: true, value: normalized(rpc.validateParams(fixture.input, ...fixture.types)), expected: fixture.valid }); }
    catch(error) { observations.push({ name: fixture.name, success: false, paths: error.issues?.map(issue => issue.path.map(String)) ?? [], messages: [error.message], expected: fixture.valid }); }
  }
  // Exercise the public custom-message API directly, with no Hardhat configuration loaded.
  for (const value of [undefined, null, 0, false, 'fictional']) {
    const schema = z.object({ field: helper.incompatibleFieldType('Mutually exclusive field') });
    const errors = helper.validateUserConfigZodType({ field: value }, schema);
    observations.push({ name: 'incompatible field / ' + String(value), success: errors.length === 0,
      paths: errors.map(error => error.path.map(String)), messages: errors.map(error => error.message), expected: value === undefined });
  }
  return {
    helperVersion: require('@nomicfoundation/hardhat-zod-utils/package.json').version,
    zodVersion: fromHelper('zod/package.json').version,
    helperSha256: createHash('sha256').update(await readFile(helperPath)).digest('hex'), observations,
  };
}
const baseline = await observe(baselineRoot);
const candidate = await observe(candidateRoot);
assert.equal(baseline.helperVersion, '3.0.8');
assert.equal(baseline.zodVersion, '3.25.76');
assert.equal(candidate.helperVersion, '3.0.8-threecore-zod4.1');
assert.equal(candidate.zodVersion, '4.6.6');
assert.equal(functionCalls, 0);
const comparisons = baseline.observations.map((before, index) => {
  const after = candidate.observations[index];
  const expected = fixtures[index]?.valid ?? before.expected;
  const same = key => JSON.stringify(before[key]) === JSON.stringify(after[key]);
  return { name: before.name, expected, bothMatchExpected: !before.threw && !after.threw && before.success === expected && after.success === expected,
    sameDecodedValue: same('value'), sameErrorPaths: same('paths'), sameMessages: same('messages') };
});
const result = { recordedAt: new Date().toISOString(), baseline, candidate, comparisons,
  cases: comparisons.length, passed: comparisons.every(item => item.bothMatchExpected && item.sameDecodedValue && item.sameErrorPaths),
  messageDifferences: comparisons.filter(item => !item.sameMessages).map(item => item.name),
  configurationFunctionCalls: functionCalls, scope: 'Pure schema and parameter decoding only; no provider, wallet, signature, transaction execution, keystore, or external RPC.' };
await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ cases: result.cases, passed: result.passed, messageDifferences: result.messageDifferences,
  failures: comparisons.filter(item => !item.bothMatchExpected || !item.sameDecodedValue || !item.sameErrorPaths) }, null, 2));
process.exitCode = result.passed ? 0 : 1;
