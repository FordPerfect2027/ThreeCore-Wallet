import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readBaseFeeBounds, withBaseFeeReads, BASE_GAS_ORACLE, BASE_FEE_SELECTORS, feeQuantity } from '../../../src/base-fee-reader.js';
import { readProposalFeeReview } from '../../../src/proposal-fee-reader.js';

const here = dirname(fileURLToPath(import.meta.url)), trace = [];
const fetchImpl = async (url, options) => {
  const request = JSON.parse(options.body), response = await fetch(url, options);
  const raw = await response.clone().text();
  trace.push({ url, request, status: response.status, response: JSON.parse(raw) }); return response;
};
const bounds = await readBaseFeeBounds({ blockNumber: null, blockHash: null, unsignedTransactionBytes: 400, gasLimit: '500000' }, { fetchImpl });
assert.deepEqual(bounds.failures, []); assert.equal(bounds.transactionSimulated, false);
const oracleCallGas = await withBaseFeeReads({ fetchImpl }, async read => {
  assert.equal(feeQuantity(await read('eth_chainId')), '8453');
  return feeQuantity(await read('eth_estimateGas', [{ to: BASE_GAS_ORACLE, data: BASE_FEE_SELECTORS.l1UpperBound + (400n).toString(16).padStart(64, '0') }, { blockHash: bounds.blockHash, requireCanonical: true }]));
});
const blocked = [];
for (const path of ['../2026-11-03-proposal-simulation-plan/account2-blocked-plan.json', '../2026-11-03-isolated-aerodrome/DAT-buy-plan.json']) {
  const source = await readFile(resolve(here, path), 'utf8'); let requests = 0;
  await assert.rejects(readProposalFeeReview(source, { fetchImpl: () => { requests++; throw Error('UNEXPECTED_RPC'); } }), { code: 'FEE_PLAN_BLOCKED' });
  assert.equal(requests, 0); blocked.push({ source: path, sha256: createHash('sha256').update(source).digest('hex'), result: 'FEE_PLAN_BLOCKED', publicRpcRequests: requests });
}
const save = (name, value) => writeFile(resolve(here, name), JSON.stringify(value, null, 2) + '\n');
await save('public-bounds.json', bounds); await save('public-rpc-trace.json', trace);
await save('public-scope.json', { recordedAt: new Date().toISOString(), bounds, oracleCallGas, oracleEstimateSupportsCanonicalHash: true, oracleViewCallOnly: true, threeCoreSwapSimulatedPublicly: false, walletUsed: false, signed: false, transactionBroadcast: false, blocked });
console.log(JSON.stringify({ blockNumber: bounds.blockNumber, l1FeeUpperBoundWei: bounds.l1FeeUpperBoundWei, operatorFeeUpperBoundWei: bounds.operatorFeeUpperBoundWei, oracleCallGas, blockedSources: blocked.length }));
