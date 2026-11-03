import test from 'node:test';
import assert from 'node:assert/strict';
import { feeReaderFixture, feeRpcFixture } from './helpers/proposal-fee-rpc-fixture.js';
import { readProposalFeeReview, proposalUnsignedSizeUpperBound } from '../src/proposal-fee-reader.js';
import { readBaseFeeBounds, BASE_GAS_ORACLE, BASE_FEE_SELECTORS } from '../src/base-fee-reader.js';
import { inspectProposalFeeReviewFile } from '../src/proposal-fee-review.js';
const rejects = code => e => e.code === code;
test('public fee path binds all buys and selling to exact source calls, canonical block, caps and saved review', async () => {
  for (const setup of [{}, ...['DAT', 'EMA', 'CAWELON'].map(agent => ({ agent, buy: true }))]) {
    const f = await feeReaderFixture(setup), mock = feeRpcFixture(f), result = await readProposalFeeReview(f.prepared.text, mock), plan = f.prepared.plan;
    assert.equal(result.review.result.checksSatisfied, true); assert.equal(result.review.result.environment, 'public-rpc'); assert.equal(result.diagnostics.authorizesExecution, false);
    assert.equal((await inspectProposalFeeReviewFile(result.review.text)).files.simulationPlanFile, f.prepared.text);
    const calls = mock.calls.filter(c => c.method === 'eth_call' || c.method === 'eth_estimateGas' || c.method === 'eth_getCode');
    assert(calls.every(c => c.params.length === 2 && c.params[1].blockHash === plan.call.blockHash && c.params[1].requireCanonical === true));
    for (const call of calls.filter(c => c.params[0]?.to === plan.call.to)) {
      assert.equal(call.params[0].from, plan.call.from); assert.equal(call.params[0].data, plan.call.data); assert.equal(call.params[0].value, '0x0'); assert.equal(BigInt(call.params[0].gas), BigInt(plan.limits.gasLimit));
      assert(!Object.hasOwn(call.params[0], 'nonce')); assert(!Object.hasOwn(call.params[0], 'accessList'));
    }
    const operator = calls.find(c => c.params[0]?.data?.startsWith(BASE_FEE_SELECTORS.operator)); assert.equal(BigInt('0x' + operator.params[0].data.slice(10)), BigInt(plan.limits.gasLimit));
    assert(mock.calls.every(c => !/send|sign|accounts|nonce|Permissions/i.test(c.method))); assert(result.diagnostics.unsignedTransactionBytes > 324);
  }
});
test('wrong chain/header/time, failed simulation, changed output, excessive gas and price are blocked', async () => {
  const f = await feeReaderFixture();
  const scenarios = [
    ['FEE_NETWORK', c => { if (c.request.method === 'eth_chainId') c.response.result = '0x1'; }],
    ['FEE_NETWORK_CHANGED', c => { if (c.chains === 2) c.response.result = '0x1'; }],
    ['FEE_BLOCK_CHANGED', c => { if (c.request.method === 'eth_getBlockByNumber' && c.headers === 2) c.response.result.hash = '0x' + '1'.repeat(64); }],
    ['FEE_BLOCK_TIME_MISMATCH', c => { if (c.request.method === 'eth_getBlockByNumber') c.response.result.timestamp = '0x1'; }],
    ['FEE_RPC_QUANTITY', c => { if (c.request.method === 'eth_getBlockByNumber') c.response.result.baseFeePerGas = '0x01'; }],
    ['FEE_RPC_REJECTED', c => { if (c.request.method === 'eth_call' && c.request.params[0].to !== BASE_GAS_ORACLE) { delete c.response.result; c.response.error = { code: 3, message: 'execution reverted' }; } }],
    ['FEE_SIMULATION_OUTPUT_MISMATCH', c => { if (c.request.method === 'eth_call' && c.request.params[0].to !== BASE_GAS_ORACLE) c.response.result = '0x' + '0'.repeat(256); }],
    ['FEE_GAS_LIMIT_EXCEEDED', c => { if (c.request.method === 'eth_estimateGas') c.response.result = '0xffffff'; }],
    ['FEE_PRICE_CAP_EXCEEDED', c => { if (c.request.method === 'eth_maxPriorityFeePerGas') c.response.result = '0xffffffffff'; }],
  ];
  for (const [code, modify] of scenarios) await assert.rejects(readProposalFeeReview(f.prepared.text, feeRpcFixture(f, modify)), rejects(code));
});
test('unsupported oracle functions remain unknown; malformed oracle output is never treated as zero', async () => {
  const f = await feeReaderFixture();
  const unavailable = feeRpcFixture(f, c => { if (c.request.method === 'eth_call' && c.request.params[0].to === BASE_GAS_ORACLE) { delete c.response.result; c.response.error = { code: -32000, message: 'unsupported' }; } });
  const read = await readProposalFeeReview(f.prepared.text, unavailable);
  assert.equal(read.review.result.totalFeeUpperBoundWei, null); assert.equal(read.review.result.checksSatisfied, false); assert.deepEqual(read.diagnostics.oracleFailures, ['FEE_L1_UNAVAILABLE', 'FEE_OPERATOR_UNAVAILABLE']);
  await assert.rejects(readProposalFeeReview(f.prepared.text, feeRpcFixture(f, c => { if (c.request.method === 'eth_call' && c.request.params[0].to === BASE_GAS_ORACLE) c.response.result = '0x'; })), rejects('FEE_RPC_WORD'));
});
test('expired/forged inputs and cancelled requests do not reach transport', async () => {
  const old = await feeReaderFixture({ nowSeconds: Math.floor(Date.now() / 1000) - 1000 }), mock = feeRpcFixture(old);
  await assert.rejects(readProposalFeeReview(old.prepared.text, mock), rejects('FEE_PLAN_BLOCKED')); assert.equal(mock.calls.length, 0);
  const fresh = await feeReaderFixture(), altered = JSON.parse(fresh.prepared.text); altered.plan.call.from = '0x' + '2'.repeat(40);
  await assert.rejects(readProposalFeeReview(JSON.stringify(altered), mock)); assert.equal(mock.calls.length, 0);
  const controller = new AbortController(); controller.abort(); await assert.rejects(readProposalFeeReview(fresh.prepared.text, { ...mock, signal: controller.signal })); assert.equal(mock.calls.length, 0);
});
test('non-cooperating transport is interrupted by request deadline, whole deadline and caller cancellation', async () => {
  const request = { blockNumber: null, blockHash: null, unsignedTransactionBytes: 400, gasLimit: '500000' };
  await assert.rejects(readBaseFeeBounds(request, { fetchImpl: () => new Promise(() => {}), requestTimeoutMs: 100 }), rejects('FEE_REQUEST_TIMEOUT'));
  await assert.rejects(readBaseFeeBounds(request, { fetchImpl: () => new Promise(() => {}), timeoutMs: 100, requestTimeoutMs: 1000 }), rejects('FEE_READ_TIMEOUT'));
  const c = new AbortController(); const pending = readBaseFeeBounds(request, { signal: c.signal, fetchImpl: () => { c.abort(); return new Promise(() => {}); } }); await assert.rejects(pending, rejects('FEE_READ_CANCELLED'));
});
test('generic public fee bounds do not claim swap execution and validate caller size, gas and block selection', async () => {
  const f = await feeReaderFixture(), mock = feeRpcFixture(f), input = { blockNumber: null, blockHash: null, unsignedTransactionBytes: 400, gasLimit: '500000' };
  const value = await readBaseFeeBounds(input, mock); assert.equal(value.transactionSimulated, false); assert.equal(value.canonicalBlockRechecked, true); assert.equal(value.l1FeeUpperBoundWei, '1000'); assert.equal(value.operatorFeeUpperBoundWei, '0');
  assert(mock.calls.every(c => c.method !== 'eth_estimateGas')); assert.equal(mock.calls.filter(c => c.method === 'eth_call').length, 2);
  for (const patch of [{ unsignedTransactionBytes: 0 }, { unsignedTransactionBytes: 16385 }, { gasLimit: '1' }, { blockHash: f.request.blockHash }, { blockNumber: '01' }]) await assert.rejects(readBaseFeeBounds({ ...input, ...patch }, mock));
  const small = proposalUnsignedSizeUpperBound(f.prepared.plan), large = proposalUnsignedSizeUpperBound({ ...f.prepared.plan, limits: { ...f.prepared.plan.limits, maxFeePerGasWei: ((1n << 256n) - 1n).toString() } }); assert(large > small);
});
