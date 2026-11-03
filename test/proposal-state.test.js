import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stateFixture, stateRpcFixture } from './helpers/proposal-state-rpc-fixture.js';
import { readProposalStateReview } from '../src/proposal-state-reader.js';
import { prepareProposalStateReview, inspectProposalStateReviewFile } from '../src/proposal-state-review.js';
import { BASE_GAS_ORACLE } from '../src/base-fee-reader.js';
const word = n => BigInt(n).toString(16).padStart(64, '0');
const swap = c => c.request.method === 'eth_call' && c.request.params[0].data.startsWith('0xcac88ea9');
const skippedSwap = rpc => assert(!rpc.calls.some(c => c.method === 'eth_estimateGas' || (c.method === 'eth_call' && c.params[0].data.startsWith('0xcac88ea9'))));

test('new block checks preserve fixed calldata, budgets, source bytes and all three token routes', async () => {
  for (const options of [{}, ...['DAT', 'EMA', 'CAWELON'].map(agent => ({ buy: true, agent }))]) {
    const f = await stateFixture(options), rpc = stateRpcFixture(f), { review } = await readProposalStateReview(f.prepared.text, rpc);
    assert.deepEqual(review.result.reasons, []); assert.equal(review.result.checksSatisfied, true); assert.equal(review.result.observation.blockNumber, rpc.height);
    assert.equal(review.result.authorizesExecution, false); assert.equal(review.result.currentStateGuaranteed, false);
    assert.equal((await inspectProposalStateReviewFile(review.text)).files.simulationPlanFile, f.prepared.text);
    for (const c of rpc.calls.filter(c => ['eth_call', 'eth_getCode', 'eth_getBalance', 'eth_estimateGas'].includes(c.method))) assert.deepEqual(c.params[1], { blockHash: rpc.hash, requireCanonical: true });
    for (const c of rpc.calls.filter(c => c.method === 'eth_estimateGas' || (c.method === 'eth_call' && c.params[0].data.startsWith('0xcac88ea9')))) {
      assert.equal(c.params[0].data, f.prepared.plan.call.data); assert.equal(c.params[0].from, f.prepared.plan.recipient); assert.equal(c.params[0].value, '0x0'); assert(!('nonce' in c.params[0]));
    }
    assert(rpc.calls.every(c => !/send|sign|accounts|transactionCount|permissions/i.test(c.method)));
    assert(BigInt(review.result.feeCeilingWei) >= BigInt(f.prepared.plan.limits.gasLimit) * BigInt(f.prepared.plan.limits.maxFeePerGasWei));
  }
});

test('shared USDC and ETH reservations remain required when checking a single proposal', async () => {
  const f = await stateFixture({ buy: true, shared: true });
  for (const [reason, modify] of [
    ['STATE_TOKEN_RESERVATION_SHORTFALL', c => { if (c.request.method === 'eth_call' && c.request.params[0].data.startsWith('0x70a08231')) c.response.result = '0x' + word(4000000); }],
    ['STATE_NATIVE_RESERVATION_SHORTFALL', c => { if (c.request.method === 'eth_getBalance') c.response.result = '0x' + BigInt('3040000000000000').toString(16); }],
  ]) {
    const rpc = stateRpcFixture(f, modify), r = (await readProposalStateReview(f.prepared.text, rpc)).review.result;
    assert(r.reasons.includes(reason), JSON.stringify(r)); assert.equal(r.tokenRequiredBaseUnits, '5000000'); skippedSwap(rpc);
  }
});

test('insufficiency, missing code, fee caps, oracle unknown and source reorg produce saveable blocked diagnostics before swap', async () => {
  const f = await stateFixture({ buy: true });
  const scenarios = [
    ['STATE_ALLOWANCE_SHORTFALL', c => { if (c.request.method === 'eth_call' && c.request.params[0].data.startsWith('0xdd62ed3e')) c.response.result = '0x' + word(0); }],
    ['STATE_TOKEN_MISSING', c => { if (c.request.method === 'eth_getCode' && c.request.params[0] === f.quote.inputToken) c.response.result = '0x'; }],
    ['STATE_ROUTER_MISSING', c => { if (c.request.method === 'eth_getCode' && c.request.params[0] === f.quote.routerAddress) c.response.result = '0x'; }],
    ['STATE_PRICE_CAP', c => { if (c.request.method === 'eth_maxPriorityFeePerGas') c.response.result = '0xffffffffff'; }],
    ['STATE_L1_BUDGET', c => { if (c.request.method === 'eth_call' && c.request.params[0].to === BASE_GAS_ORACLE) c.response.result = '0x' + word(10n ** 20n); }],
    ['STATE_FEES_UNKNOWN', c => { if (c.request.method === 'eth_call' && c.request.params[0].to === BASE_GAS_ORACLE) { delete c.response.result; c.response.error = { code: -32000 }; } }],
    ['STATE_SOURCE_REORG', c => { if (c.request.method === 'eth_getBlockByNumber' && BigInt(c.request.params[0]) === BigInt(f.request.blockNumber)) c.response.result.hash = '0x' + 'b'.repeat(64); }],
  ];
  for (const [reason, modify] of scenarios) { const rpc = stateRpcFixture(f, modify), { review } = await readProposalStateReview(f.prepared.text, rpc); assert(review.result.reasons.includes(reason), reason); skippedSwap(rpc); await inspectProposalStateReviewFile(review.text); }
});

test('expired/blocked original source is readable but never repaired, extended or simulated', async () => {
  const f = await stateFixture({ nowSeconds: Math.floor(Date.now() / 1000) - 1000 }), rpc = stateRpcFixture(f);
  const { review } = await readProposalStateReview(f.prepared.text, rpc); assert(review.result.reasons.includes('STATE_WINDOW_CLOSED')); skippedSwap(rpc);
  assert.equal(review.result.deadlineSeconds, f.prepared.plan.deadlineSeconds);
  const text = await readFile(new URL('../docs/evidence/2026-11-03-proposal-simulation-plan/account2-blocked-plan.json', import.meta.url), 'utf8');
  const saved = JSON.parse(text); assert.equal(saved.plan.call, null);
  const observed = await prepareProposalStateReview({ simulationPlanFile: text, observation: review.result.observation });
  assert(observed.result.reasons.includes('STATE_SOURCE_BLOCKED')); assert(observed.result.reasons.includes('STATE_SOURCE_MISMATCH'));
});

test('changed output is acceptable only above the original minimum; rejection and excessive gas are saved', async () => {
  const f = await stateFixture({ buy: true });
  for (const [output, reason] of [[BigInt(f.prepared.plan.minimumOutputBaseUnits), null], [BigInt(f.prepared.plan.minimumOutputBaseUnits) - 1n, 'STATE_MINIMUM_OUTPUT']]) {
    const { review } = await readProposalStateReview(f.prepared.text, stateRpcFixture(f, c => { if (swap(c)) c.response.result = '0x' + [32, 2, f.quote.inputBaseUnits, output].map(word).join(''); }));
    assert.equal(review.result.checksSatisfied, reason === null); if (reason) assert(review.result.reasons.includes(reason));
  }
  for (const [reason, modify] of [
    ['STATE_SIMULATION_REJECTED', c => { if (swap(c)) { delete c.response.result; c.response.error = { code: 3, message: 'untrusted provider text' }; } }],
    ['STATE_GAS_LIMIT', c => { if (c.request.method === 'eth_estimateGas') c.response.result = '0xffffff'; }],
  ]) { const { review } = await readProposalStateReview(f.prepared.text, stateRpcFixture(f, modify)); assert(review.result.reasons.includes(reason)); assert(!review.text.includes('untrusted provider text')); }
});

test('chain changes, new-block reorg, malformed results and source forgery cannot create successful archives', async () => {
  const f = await stateFixture();
  for (const modify of [
    c => { if (c.request.method === 'eth_chainId') c.response.result = '0x1'; },
    c => { if (c.request.method === 'eth_chainId' && c.chains === 2) c.response.result = '0x1'; },
    c => { if (c.request.method === 'eth_getBlockByNumber' && c.headers === 3) c.response.result.hash = '0x' + 'b'.repeat(64); },
    c => { if (swap(c)) c.response.result = '0x'; },
    c => { if (c.request.method === 'eth_getBalance') c.response.result = '0x01'; },
  ]) await assert.rejects(readProposalStateReview(f.prepared.text, stateRpcFixture(f, modify)));
  const forged = JSON.parse(f.prepared.text); forged.plan.minimumOutputBaseUnits = '1'; const rpc = stateRpcFixture(f); await assert.rejects(readProposalStateReview(JSON.stringify(forged), rpc)); assert.equal(rpc.calls.length, 0);
});

test('saved result, source hash, time, and simulation claims are replayed and checked', async () => {
  const f = await stateFixture(), valid = (await readProposalStateReview(f.prepared.text, stateRpcFixture(f))).review;
  const raw = JSON.parse(valid.text); raw.result.checksSatisfied = false; await assert.rejects(inspectProposalStateReviewFile(JSON.stringify(raw)));
  for (const [patch, reason] of [
    [{ planSha256: '0'.repeat(64) }, 'STATE_SOURCE_MISMATCH'], [{ observedAtSeconds: Math.floor(Date.now() / 1000) + 1000 }, 'STATE_TIME_ORDER'],
    [{ observedAtSeconds: Math.floor(Date.now() / 1000) - 61 }, 'STATE_STALE'],
  ]) { const next = await prepareProposalStateReview({ simulationPlanFile: f.prepared.text, observation: { ...valid.result.observation, ...patch } }); assert(next.result.reasons.includes(reason)); }
  const late = await prepareProposalStateReview({ simulationPlanFile: f.prepared.text, observation: valid.result.observation }, { nowSeconds: f.prepared.plan.deadlineSeconds }); assert(late.result.reasons.includes('STATE_WINDOW_CLOSED'));
  await assert.rejects(prepareProposalStateReview({ simulationPlanFile: f.prepared.text, observation: { ...valid.result.observation, simulation: { status: 'skipped', outputBaseUnits: '1', estimatedGas: null } } }));
});

test('caller cancellation and noncooperating RPC timeouts terminate without any signed operation', async () => {
  const f = await stateFixture(), c = new AbortController(); c.abort(); const rpc = stateRpcFixture(f); await assert.rejects(readProposalStateReview(f.prepared.text, { ...rpc, signal: c.signal })); assert.equal(rpc.calls.length, 0);
  await assert.rejects(readProposalStateReview(f.prepared.text, { fetchImpl: () => new Promise(() => {}), requestTimeoutMs: 100 }));
});

test('source expiry during RPC is checked again before a result can pass', async t => {
  const now = Math.floor(Date.now() / 1000); t.mock.timers.enable({ apis: ['Date'], now: now * 1000 });
  const f = await stateFixture({ nowSeconds: now }), rpc = stateRpcFixture(f, c => { if (c.request.method === 'eth_getBlockByNumber' && c.headers === 3) t.mock.timers.tick(61000); });
  const { review } = await readProposalStateReview(f.prepared.text, rpc);
  assert.equal(review.result.observation.simulation.status, 'succeeded'); assert.equal(review.result.checksSatisfied, false);
  assert(review.result.reasons.includes('STATE_WINDOW_CLOSED')); assert.equal(review.result.deadlineSeconds, f.prepared.plan.deadlineSeconds);
});
