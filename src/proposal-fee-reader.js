import { captureOptionalDataFields, sha256Hex } from './security-data.js';
import { inspectProposalSimulationPlanFile, prepareProposalSimulationPlan } from './proposal-simulation-plan.js';
import { PROPOSAL_FEE_SCHEMA, prepareProposalFeeReview } from './proposal-fee-review.js';
import { withBaseFeeReads, readFeeHeader, readFeeBoundsAtBlock, validateFeeBoundsRequest, feeQuantity, feeHex, failBaseFee as fail } from './base-fee-reader.js';

/** Conservative unsigned EIP-1559 size, empty access list, uint64 nonce ceiling.
 * No nonce is obtained and no transaction/signature is constructed. The oracle
 * adds its own signature allowance. Priority price is bounded by the source cap.
 */
export function proposalUnsignedSizeUpperBound(plan) {
  const integerSize = n => { n = BigInt(n); if (n < 128n) return 1; return 1 + Math.ceil(n.toString(16).length / 2); };
  const prefix = length => length <= 55 ? 1 : 1 + Math.ceil(length.toString(16).length / 2);
  const length = (plan.call.data.length - 2) / 2;
  const payload = integerSize(8453) + 9 + 2 * integerSize(plan.limits.maxFeePerGasWei) + integerSize(plan.limits.gasLimit) + 21 + 1 + prefix(length) + length + 1;
  return 1 + prefix(payload) + payload;
}

/** Recheck exact source inputs, then simulate and estimate only that fixed call. */
export async function readProposalFeeReview(simulationPlanFile, options = {}) {
  let s; try { s = captureOptionalDataFields(options, ['fetchImpl', 'signal', 'timeoutMs', 'requestTimeoutMs', 'subtle']); } catch { fail('FEE_READ_OPTIONS'); }
  const stored = await inspectProposalSimulationPlanFile(simulationPlanFile, { signal: s.signal, subtle: s.subtle });
  const current = await prepareProposalSimulationPlan(stored.allowanceReviewFile, { signal: s.signal, subtle: s.subtle });
  const p = current.plan;
  if (!p.eligibleForSimulation || !stored.recordedPlan.eligibleForSimulation) fail('FEE_PLAN_BLOCKED');
  const planSha256 = await sha256Hex(new TextEncoder().encode(simulationPlanFile), s.subtle, { signal: s.signal });
  const request = validateFeeBoundsRequest({ blockNumber: p.call.blockNumber, blockHash: p.call.blockHash, unsignedTransactionBytes: proposalUnsignedSizeUpperBound(p), gasLimit: p.limits.gasLimit });
  return withBaseFeeReads(s, async (read, guard) => {
    if (feeQuantity(await read('eth_chainId')) !== '8453') fail('FEE_NETWORK');
    const header = await readFeeHeader(read, request.blockNumber, request.blockHash), selector = { blockHash: header.hash, requireCanonical: true };
    if (header.timestampSeconds !== current.allowanceReview.observation.blockTimestampSeconds) fail('FEE_BLOCK_TIME_MISMATCH');
    const priorityFeePerGasWei = feeQuantity(await read('eth_maxPriorityFeePerGas'));
    if (BigInt(priorityFeePerGasWei) + BigInt(header.baseFeePerGasWei) > BigInt(p.limits.maxFeePerGasWei)) fail('FEE_PRICE_CAP_EXCEEDED');
    const tx = { from: p.call.from, to: p.call.to, data: p.call.data, value: '0x0', gas: feeHex(p.limits.gasLimit), maxFeePerGas: feeHex(p.limits.maxFeePerGasWei), maxPriorityFeePerGas: feeHex(priorityFeePerGasWei) };
    const output = await read('eth_call', [tx, selector]);
    if (typeof output !== 'string' || !/^0x[0-9a-fA-F]{256}$/.test(output)) fail('FEE_SIMULATION_RESULT');
    const words = output.slice(2).match(/.{64}/g).map(w => BigInt('0x' + w));
    if (words[0] !== 32n || words[1] !== 2n || words[2] !== BigInt(p.amountInBaseUnits) || words[3] !== BigInt(current.allowanceReview.quoteReview.quote.quote.routerOutputBaseUnits) || words[3] < BigInt(p.minimumOutputBaseUnits)) fail('FEE_SIMULATION_OUTPUT_MISMATCH');
    const estimatedGas = feeQuantity(await read('eth_estimateGas', [tx, selector]));
    if (estimatedGas === '0' || BigInt(estimatedGas) > BigInt(p.limits.gasLimit)) fail('FEE_GAS_LIMIT_EXCEEDED');
    const bounds = await readFeeBoundsAtBlock(read, request, header), final = await readFeeHeader(read, request.blockNumber, request.blockHash);
    if (JSON.stringify(final) !== JSON.stringify(header)) fail('FEE_BLOCK_CHANGED');
    if (feeQuantity(await read('eth_chainId')) !== '8453') fail('FEE_NETWORK_CHANGED');
    const now = Math.floor(Date.now() / 1000);
    const observation = { schema: PROPOSAL_FEE_SCHEMA, planSha256, environment: 'public-rpc', chainId: 8453, blockNumber: request.blockNumber, blockHash: request.blockHash,
      observedAtSeconds: now, estimatedGas, baseFeePerGasWei: header.baseFeePerGasWei, priorityFeePerGasWei,
      l1FeeUpperBoundWei: bounds.l1FeeUpperBoundWei, operatorFeeUpperBoundWei: bounds.operatorFeeUpperBoundWei, readOnly: true };
    const review = await prepareProposalFeeReview({ simulationPlanFile, observation }, { nowSeconds: now, signal: s.signal, subtle: s.subtle }); guard();
    return Object.freeze({ review, diagnostics: Object.freeze({ rpcUrl: 'https://mainnet.base.org', unsignedTransactionBytes: request.unsignedTransactionBytes,
      nonceRead: false, accessList: 'empty', priorityFeeSource: 'provider recommendation at observation time', operatorFeeGasBound: request.gasLimit,
      simulatedAtBlockHash: request.blockHash, simulatedOutputBaseUnits: words[3].toString(), canonicalBlockRechecked: true, oracleFailures: bounds.failures,
      currentStateVerified: false, signed: false, transactionBroadcast: false, authorizesExecution: false }) });
  });
}
