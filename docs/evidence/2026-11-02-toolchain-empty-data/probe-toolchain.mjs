import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Read-only, pure conversion probe. Does not import Hardhat configuration,
// create an EVM, connect a wallet, or dispatch an RPC request.
const root = resolve(process.argv[2]);
const requireRoot = createRequire(resolve(root, 'package.json'));
const hexPath = requireRoot.resolve('@nomicfoundation/hardhat-utils/hex');
const rpcPath = requireRoot.resolve('@nomicfoundation/hardhat-zod-utils/rpc');
const { hexStringToBytes, bytesToHexString } = await import(pathToFileURL(hexPath));
const { rpcData } = await import(pathToFileURL(rpcPath));
const samples = ['0x', '0x00', '0x0100'].map(input => {
  const bytes = rpcData.parse(input);
  return { input, directBytes: [...hexStringToBytes(input)], rpcBytes: [...bytes], roundTrip: bytesToHexString(bytes) };
});
const malformed = ['0x0', '0xgg', '00'].map(input => ({ input, accepted: rpcData.safeParse(input).success }));
assert.equal(samples[1].roundTrip, '0x00');
assert.equal(samples[2].roundTrip, '0x0100');
const versions = {};
for (const name of ['hardhat', '@nomicfoundation/hardhat-utils', '@nomicfoundation/hardhat-zod-utils', 'zod']) {
  versions[name] = JSON.parse(readFileSync(resolve(root, 'node_modules', name, 'package.json'), 'utf8')).version;
}
console.log(JSON.stringify({ node: process.version, versions, samples, malformed,
  emptyDataPreserved: samples[0].rpcBytes.length === 0 && samples[0].directBytes.length === 0 && samples[0].roundTrip === '0x',
  scope: 'Pure dependency conversion only; no configuration, wallet, EVM or RPC.' }, null, 2));
