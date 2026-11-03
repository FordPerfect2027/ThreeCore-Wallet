#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { inspectProposalSimulationPlanFile } from '../src/proposal-simulation-plan.js';
import { inspectProposalFeeReviewFile } from '../src/proposal-fee-review.js';
const [directory, ...extra] = process.argv.slice(2);
if (!directory || extra.length) throw Error('Expected a saved local simulation directory');
const folder = resolve(directory), sha = b => createHash('sha256').update(b).digest('hex');
const bytes = name => readFile(resolve(folder, name)), json = async name => JSON.parse(await bytes(name));
const summary = await json('execution-summary.json'), run = await json('execution-run.json'), manifest = await json('source-manifest.json');
assert.equal(run.exitCode, 0); assert.equal(run.networkAttempts, 0); assert.equal(run.filteredEnvironment, true);
assert.equal(summary.publicChainWrites, false); assert.equal(summary.userKeysRead, false); assert.equal(summary.outcomes.length, 6);
assert.equal(manifest.aerodromeRevision, '1ba30815bba620f7e9faa34769ffd00c214c9b82');
assert.equal(manifest.openzeppelinRevision, '7b3e7b7055d6e1226d4920ca7d7c446c0c0bfff5');
assert.equal(manifest.compiler.sha256, 'e0b74e0a16e783a35169f74d1a615ecb48d07c30f97346b83cd587949268681e');
const inputBytes = await bytes('compiler-input.json'), input = JSON.parse(inputBytes), compiledBytes = await bytes('compiled-artifacts.json'), compiled = JSON.parse(compiledBytes);
assert.equal(sha(inputBytes), manifest.inputSha256); assert.equal(compiled.sourceInputSha256, manifest.inputSha256);
assert.equal(sha(compiledBytes), summary.compilerArtifactSha256); assert.match(compiled.compiler, /^0\.8\.19\+commit\.7dd6d404/);
for (const ref of manifest.references) {
  const source = Buffer.from(input.sources[ref.key].content);
  assert.equal(source.length, ref.bytes); assert.equal(sha(source), ref.sha256);
}
for (const license of manifest.licenses) assert.equal(sha(license.text), license.sha256);
const counts = { isolatedSwaps: 0, rejectedControls: 0, savedPlansReplayed: 0, feeReviewsReplayed: 0, feeBreakdownsMatched: 0 };
for (const agent of ['DAT', 'EMA', 'CAWELON']) for (const direction of ['buy', 'sell']) {
  const prefix = agent + '-' + direction, result = await json(prefix + '-result.json'), planText = (await bytes(prefix + '-plan.json')).toString('utf8');
  assert.deepEqual(result, summary.outcomes.find(r => r.agent === agent && r.direction === direction));
  const { recordedPlan: plan } = await inspectProposalSimulationPlanFile(planText); counts.savedPlansReplayed++;
  assert.equal(result.planSha256, sha(planText)); assert.equal(plan.eligibleForSimulation, true); assert.equal(plan.authorizesExecution, false);
  assert.equal(result.environment, 'isolated-hardhat-op-no-fork'); assert.equal(result.publicChainObserved, false); assert.equal(result.userWalletUsed, false);
  assert.equal(result.localExecutionReceiptStatus, 'success'); assert.equal(result.rawReceipt.status, '0x1'); assert.equal(result.rawReceipt.transactionHash, result.receiptHash);
  const before = result.before, after = result.after;
  assert.equal(BigInt(before.input) - BigInt(after.input), BigInt(plan.amountInBaseUnits));
  assert.equal(BigInt(after.output) - BigInt(before.output), BigInt(result.outputBaseUnits));
  assert.equal(BigInt(before.allowance) - BigInt(after.allowance), BigInt(plan.amountInBaseUnits));
  assert.equal(after.inputSupply, before.inputSupply); assert.equal(after.outputSupply, before.outputSupply);
  assert.equal(after.nonce, before.nonce + 1); assert(BigInt(result.outputBaseUnits) >= BigInt(plan.minimumOutputBaseUnits));
  assert.equal(result.readOnlySimulationPreservedState, true); assert(BigInt(result.gasUsed) <= BigInt(result.gasEstimate));
  assert.equal(BigInt(result.gasUsed), BigInt(result.rawReceipt.gasUsed)); assert.equal(BigInt(result.effectiveGasPrice), BigInt(result.rawReceipt.effectiveGasPrice));
  assert.equal(BigInt(result.l2ExecutionFeeWei), BigInt(result.gasUsed) * BigInt(result.effectiveGasPrice));
  assert.equal(BigInt(result.l1FeeWei), BigInt(result.rawReceipt.l1Fee)); assert.equal(BigInt(result.rawReceipt.operatorFeeScalar), 0n); assert.equal(BigInt(result.rawReceipt.operatorFeeConstant), 0n);
  assert.equal(result.operatorFeeWei, '0'); assert.equal(BigInt(before.native) - BigInt(after.native), BigInt(result.nativeFeePaidWei));
  assert.equal(BigInt(result.nativeFeePaidWei), BigInt(result.l2ExecutionFeeWei) + BigInt(result.l1FeeWei));
  assert.equal(result.localFeeBreakdownVerified, true); assert.equal(result.totalBaseFeeVerified, false); counts.feeBreakdownsMatched++;
  assert.deepEqual(result.negatives.map(n => n.scenario), ['minimum-too-high', 'expired', 'allowance-revoked', 'factory-paused']);
  for (const n of result.negatives) { assert.equal(n.evmRevertObserved, true); assert.equal(n.stateUnchanged, true); counts.rejectedControls++; }
  const feeText = (await bytes(prefix + '-fee-review.json')).toString('utf8'), fee = await inspectProposalFeeReviewFile(feeText);
  assert.equal(fee.files.simulationPlanFile, planText); assert.equal(fee.recordedResult.environment, 'isolated-evm');
  assert.deepEqual(fee.recordedResult.reasons, ['FEE_L1_UNKNOWN', 'FEE_OPERATOR_UNKNOWN']);
  assert.equal(fee.recordedResult.totalFeeUpperBoundWei, null); assert.equal(fee.recordedResult.checksSatisfied, false);
  assert.equal(fee.recordedResult.observation.estimatedGas, result.gasEstimate);
  assert(BigInt(result.l2ExecutionFeeWei) <= BigInt(fee.recordedResult.l2FeeCeilingWei));
  counts.feeReviewsReplayed++; counts.isolatedSwaps++;
}
console.log(JSON.stringify({ ...counts, upstreamSourcesHashed: manifest.references.length, sourceAndArtifactsMatch: true, networkAttempts: run.networkAttempts,
  scope: 'Saved local evidence replay only; not a fresh simulation, public observation or authenticated attestation' }, null, 2));
