import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { allowanceFixture } from './helpers/proposal-allowance-fixture.js';
import { prepareProposalAllowanceReview } from '../src/proposal-allowance.js';
import { prepareProposalSimulationPlan } from '../src/proposal-simulation-plan.js';
import { PROPOSAL_FEE_SCHEMA, prepareProposalFeeReview, inspectProposalFeeReviewFile, validateProposalFeeObservation } from '../src/proposal-fee-review.js';
import { runProposalFeeReview } from '../scripts/proposal-fee-review.js';

async function fixture(options) {
  const source = await allowanceFixture(options), allowance = await prepareProposalAllowanceReview(source.files, source.options);
  const prepared = await prepareProposalSimulationPlan(allowance.text, source.options), p = prepared.plan;
  return { files: { simulationPlanFile: prepared.text, observation: { schema: PROPOSAL_FEE_SCHEMA,
    planSha256: createHash('sha256').update(prepared.text).digest('hex'), environment: 'synthetic-test', chainId: 8453,
    blockNumber: p.call.blockNumber, blockHash: p.call.blockHash, observedAtSeconds: p.evaluatedAtSeconds,
    estimatedGas: (BigInt(p.limits.gasLimit) / 2n).toString(), baseFeePerGasWei: p.limits.maxFeePerGasWei,
    priorityFeePerGasWei: '0', l1FeeUpperBoundWei: '0', operatorFeeUpperBoundWei: '0', readOnly: true } },
    options: { nowSeconds: p.evaluatedAtSeconds, maxObservationAgeSeconds: 10 }, plan: p };
}

test('fee review retains source caps for three buys, selling and shared-agent budgets', async () => {
  for (const setup of [{}, ...['DAT', 'EMA', 'CAWELON'].map(agent => ({ agent, buy: true, shared: true }))]) {
    const f = await fixture(setup), prepared = await prepareProposalFeeReview(f.files, f.options), r = prepared.result;
    assert.equal(r.checksSatisfied, true); assert.equal(r.completeFeeEstimate, true); assert.deepEqual(r.limits, f.plan.limits);
    assert.equal(r.l2FeeCeilingWei, (BigInt(f.files.observation.estimatedGas) * BigInt(f.plan.limits.maxFeePerGasWei)).toString());
    assert.equal(r.totalFeeUpperBoundWei, (BigInt(r.l2FeeCeilingWei) + BigInt(f.plan.limits.bufferWei)).toString());
    assert.equal(r.authorizesExecution, false); assert.equal(r.currentStateVerified, false); assert.equal(r.sourceAuthorAuthenticated, false);
    assert.deepEqual((await inspectProposalFeeReviewFile(prepared.text)).recordedResult, r);
  }
});
test('each component cap is enforced with exact integers, including the total policy ceiling', async () => {
  const f = await fixture(), p = f.plan.limits;
  for (const [patch, reason] of [
    [{ estimatedGas: (BigInt(p.gasLimit) + 1n).toString() }, 'FEE_GAS_LIMIT_EXCEEDED'],
    [{ priorityFeePerGasWei: '1' }, 'FEE_PRICE_CAP_EXCEEDED'],
    [{ l1FeeUpperBoundWei: (BigInt(p.l1FeeBudgetWei) + 1n).toString() }, 'FEE_L1_BUDGET_EXCEEDED'],
    [{ operatorFeeUpperBoundWei: '1' }, 'FEE_OPERATOR_BUDGET_EXCEEDED'],
    [{ l1FeeUpperBoundWei: p.policyMaxTotalFeeWei }, 'FEE_POLICY_TOTAL_EXCEEDED'],
    [{ estimatedGas: ((1n << 256n) - 1n).toString() }, 'FEE_GAS_LIMIT_EXCEEDED'],
  ]) {
    const r = (await prepareProposalFeeReview({ ...f.files, observation: { ...f.files.observation, ...patch } }, f.options)).result;
    assert.equal(r.checksSatisfied, false); assert(r.reasons.includes(reason), reason); assert.deepEqual(r.limits, p);
  }
});
test('unknown L1/operator fees stay unknown; zero is distinct and partial totals cannot pass', async () => {
  const f = await fixture();
  for (const patch of [{ l1FeeUpperBoundWei: null }, { operatorFeeUpperBoundWei: null }, { l1FeeUpperBoundWei: null, operatorFeeUpperBoundWei: null }]) {
    const r = (await prepareProposalFeeReview({ ...f.files, observation: { ...f.files.observation, environment: 'isolated-evm', ...patch } }, f.options)).result;
    assert.equal(r.checksSatisfied, false); assert.equal(r.totalFeeUpperBoundWei, null); assert.equal(r.completeFeeEstimate, false); assert(r.knownFeeSubtotalWei !== null);
  }
});
test('source hash, canonical block and observation time cannot be replaced or extended', async () => {
  const f = await fixture();
  for (const [patch, reason] of [
    [{ planSha256: '0'.repeat(64) }, 'FEE_PLAN_MISMATCH'], [{ blockNumber: '1' }, 'FEE_BLOCK_MISMATCH'],
    [{ blockHash: '0x' + '00'.repeat(32) }, 'FEE_BLOCK_MISMATCH'],
    [{ observedAtSeconds: f.options.nowSeconds - 1 }, 'FEE_OBSERVATION_BEFORE_PLAN'],
    [{ observedAtSeconds: f.options.nowSeconds + 1 }, 'FEE_OBSERVATION_FUTURE'],
  ]) assert((await prepareProposalFeeReview({ ...f.files, observation: { ...f.files.observation, ...patch } }, f.options)).result.reasons.includes(reason));
  const old = await prepareProposalFeeReview(f.files, f.options);
  assert.equal((await inspectProposalFeeReviewFile(old.text, { nowSeconds: f.options.nowSeconds + 1000 })).recordedResult.checksSatisfied, true);
  const aged = await prepareProposalFeeReview(f.files, { ...f.options, nowSeconds: f.options.nowSeconds + 10 });
  assert(aged.result.reasons.includes('FEE_OBSERVATION_EXPIRED'));
  const expired = await prepareProposalFeeReview(f.files, { ...f.options, nowSeconds: f.plan.deadlineSeconds });
  assert(expired.result.reasons.includes('FEE_PLAN_BLOCKED')); assert.equal(expired.result.checksSatisfied, false);
});
test('malformed, accessor, oversized, aborted and forged saved fee results are rejected', async () => {
  const f = await fixture(), saved = await prepareProposalFeeReview(f.files, f.options);
  for (const patch of [{ estimatedGas: '0' }, { estimatedGas: '01' }, { estimatedGas: 1 }, { l1FeeUpperBoundWei: '-1' }, { environment: 'mainnet-verified' }, { chainId: 1 }, { extra: true }]) assert.throws(() => validateProposalFeeObservation({ ...f.files.observation, ...patch }));
  const accessor = { ...f.files.observation }; Object.defineProperty(accessor, 'estimatedGas', { get() { throw Error('getter must not run'); } });
  assert.throws(() => validateProposalFeeObservation(accessor), { code: 'FEE_STRUCTURE' });
  await assert.rejects(prepareProposalFeeReview(f.files, { ...f.options, maxObservationAgeSeconds: 601 }));
  for (const change of [r => { r.result.totalFeeUpperBoundWei = '0'; }, r => { r.result.limits.gasLimit = '1'; }, r => { r.result.authorizesExecution = true; }, r => { r.observation.estimatedGas = '1'; }, r => { r.evaluatedAtSeconds = null; }]) {
    const raw = JSON.parse(saved.text); change(raw); await assert.rejects(inspectProposalFeeReviewFile(JSON.stringify(raw)));
  }
  const c = new AbortController(); c.abort(); await assert.rejects(prepareProposalFeeReview(f.files, { ...f.options, signal: c.signal }));
  await assert.rejects(inspectProposalFeeReviewFile(' '.repeat(16777217)));
});
test('offline command distinguishes complete, blocked, historical and invalid evidence', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'threecore-fee-'));
  try {
    const f = await fixture({ nowSeconds: Math.floor(Date.now() / 1000) }), plan = join(folder, 'plan.json'), observation = join(folder, 'fee.json'), archive = join(folder, 'review.json');
    await writeFile(plan, f.files.simulationPlanFile); await writeFile(observation, JSON.stringify(f.files.observation));
    let output = ''; const out = { write: s => { output += s; } }, errors = { write() {} };
    assert.equal(await runProposalFeeReview(['prepare', plan, observation], out, errors), 0); await writeFile(archive, output);
    assert.equal(await runProposalFeeReview(['verify', archive], { write() {} }, errors), 0);
    await writeFile(observation, JSON.stringify({ ...f.files.observation, l1FeeUpperBoundWei: null })); output = '';
    assert.equal(await runProposalFeeReview(['prepare', plan, observation], out, errors), 2); assert.equal(JSON.parse(output).result.completeFeeEstimate, false);
    for (const args of [[], ['send', plan], ['verify', archive, 'extra']]) assert.equal(await runProposalFeeReview(args, out, errors), 1);
    await writeFile(observation, '{'); assert.equal(await runProposalFeeReview(['prepare', plan, observation], out, errors), 1);
  } finally {
    const target = await realpath(folder), base = await realpath(tmpdir()); assert.equal(dirname(target), base); assert.match(basename(target), /^threecore-fee-[A-Za-z0-9]+$/); await rm(target, { recursive: true, force: true });
  }
});
