import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { feeReaderFixture } from '../../../test/helpers/proposal-fee-rpc-fixture.js';
import { proposalUnsignedSizeUpperBound } from '../../../src/proposal-fee-reader.js';
const here = dirname(fileURLToPath(import.meta.url)), root = resolve(process.argv[2]), require = createRequire(resolve(root, 'package.json'));
const { serializeTransaction } = require('viem'), packageBytes = await readFile(require.resolve('viem/package.json'));
const f = await feeReaderFixture(), p = f.prepared.plan, cases = [];
for (const gas of [21000n, 500000n, 30000000n]) for (const price of [0n, 127n, 128n, 1000000000n, (1n << 256n) - 1n]) for (const nonce of [0n, 127n, 128n, (1n << 64n) - 1n]) {
  const plan = { ...p, limits: { ...p.limits, gasLimit: gas.toString(), maxFeePerGasWei: price.toString() } };
  const bytes = serializeTransaction({ type: 'eip1559', chainId: 8453, nonce, gas, maxFeePerGas: price, maxPriorityFeePerGas: price, to: p.call.to, data: p.call.data, value: 0n, accessList: [] });
  const actual = (bytes.length - 2) / 2, bound = proposalUnsignedSizeUpperBound(plan); assert(actual <= bound);
  if (nonce === (1n << 64n) - 1n) assert.equal(actual, bound);
  cases.push({ gas: gas.toString(), price: price.toString(), nonce: nonce.toString(), independentlySerializedBytes: actual, upperBoundBytes: bound });
}
await writeFile(resolve(here, 'independent-size.json'), JSON.stringify({ encoder: 'viem', version: JSON.parse(packageBytes).version, packageSha256: createHash('sha256').update(packageBytes).digest('hex'), syntheticTransaction: true, signed: false, broadcast: false, cases }, null, 2) + '\n');
console.log(JSON.stringify({ independentEncoder: 'viem', cases: cases.length, passed: true }));
