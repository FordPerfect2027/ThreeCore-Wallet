import { captureOptionalDataFields } from './security-data.js';
import { PROPOSAL_STATE_SCHEMA, inspectProposalStateSource, prepareProposalStateReview } from './proposal-state-review.js';
import { proposalUnsignedSizeUpperBound } from './proposal-fee-reader.js';
import { BaseFeeReadError, withBaseFeeReads, readFeeHeader, readFeeBoundsAtBlock, validateFeeBoundsRequest, feeQuantity, feeWord, feeHex, failBaseFee as fail } from './base-fee-reader.js';
const word = address => address.slice(2).padStart(64, '0');

/** Fresh head selected once; all state/simulation/oracle reads use its canonical hash. */
export async function readProposalStateReview(simulationPlanFile, options = {}) {
  let s; try { s = captureOptionalDataFields(options, ['fetchImpl', 'signal', 'timeoutMs', 'requestTimeoutMs', 'subtle']); } catch { fail('STATE_READ_OPTIONS'); }
  const source = await inspectProposalStateSource(simulationPlanFile, { signal: s.signal, subtle: s.subtle });
  const p = source.plan, q = source.allowance.quoteReview.quote.quote;
  return withBaseFeeReads(s, async (read, guard) => {
    if (feeQuantity(await read('eth_chainId')) !== '8453') fail('FEE_NETWORK');
    const height = feeQuantity(await read('eth_blockNumber')), header = await readFeeHeader(read, height);
    const original = await readFeeHeader(read, q.blockNumber);
    const sourceBlockCanonical = original.hash === q.blockHash && original.timestampSeconds === q.blockTimestampSeconds;
    const selector = { blockHash: header.hash, requireCanonical: true };
    const hasCode = async address => { const code = await read('eth_getCode', [address, selector]); if (typeof code !== 'string' || !/^0x(?:[0-9a-fA-F]{2}){0,32768}$/.test(code)) fail('STATE_CODE'); return code !== '0x'; };
    const tokenHasCode = await hasCode(q.inputToken), spenderHasCode = await hasCode(q.routerAddress);
    const nativeBalanceWei = feeQuantity(await read('eth_getBalance', [p.recipient, selector]));
    const tokenRead = async data => tokenHasCode ? feeWord(await read('eth_call', [{ to: q.inputToken, data }, selector])) : null;
    const tokenBalanceBaseUnits = await tokenRead('0x70a08231' + word(p.recipient));
    const allowanceBaseUnits = await tokenRead('0xdd62ed3e' + word(p.recipient) + word(q.routerAddress));
    const priorityFeePerGasWei = feeQuantity(await read('eth_maxPriorityFeePerGas'));
    let bounds = { l1FeeUpperBoundWei: null, operatorFeeUpperBoundWei: null, failures: ['STATE_BUDGET_MISSING'] };
    if (p.limits) {
      // The fixed route has 324 calldata bytes even when blocked (no call exists).
      const size = proposalUnsignedSizeUpperBound({ ...p, call: p.call ?? { data: '0x' + '0'.repeat(648) } });
      bounds = await readFeeBoundsAtBlock(read, validateFeeBoundsRequest({ blockNumber: height, blockHash: header.hash, unsignedTransactionBytes: size, gasLimit: p.limits.gasLimit }), header);
    }
    const observation = { schema: PROPOSAL_STATE_SCHEMA, planSha256: source.planSha256, environment: 'public-rpc', chainId: 8453,
      blockNumber: height, blockHash: header.hash, blockTimestampSeconds: header.timestampSeconds, observedAtSeconds: Math.floor(Date.now() / 1000), sourceBlockCanonical,
      tokenHasCode, spenderHasCode, tokenBalanceBaseUnits, allowanceBaseUnits, nativeBalanceWei, baseFeePerGasWei: header.baseFeePerGasWei, priorityFeePerGasWei,
      l1FeeUpperBoundWei: bounds.l1FeeUpperBoundWei, operatorFeeUpperBoundWei: bounds.operatorFeeUpperBoundWei,
      simulation: { status: 'skipped', outputBaseUnits: null, estimatedGas: null }, canonicalBlockRechecked: true, readOnly: true, walletConnected: false };
    const before = await prepareProposalStateReview({ simulationPlanFile, observation }, { signal: s.signal, subtle: s.subtle });
    if (p.call && before.result.reasons.every(r => r === 'STATE_SIMULATION_MISSING')) {
      const tx = { from: p.call.from, to: p.call.to, data: p.call.data, value: '0x0', gas: feeHex(p.limits.gasLimit), maxFeePerGas: feeHex(p.limits.maxFeePerGasWei), maxPriorityFeePerGas: feeHex(priorityFeePerGasWei) };
      try {
        const raw = await read('eth_call', [tx, selector]);
        if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]{256}$/.test(raw)) fail('STATE_SIMULATION_RESULT');
        const words = raw.slice(2).match(/.{64}/g).map(w => BigInt('0x' + w));
        if (words[0] !== 32n || words[1] !== 2n || words[2] !== BigInt(p.amountInBaseUnits)) fail('STATE_SIMULATION_RESULT');
        observation.simulation = { status: 'succeeded', outputBaseUnits: String(words[3]), estimatedGas: feeQuantity(await read('eth_estimateGas', [tx, selector])) };
      } catch (e) {
        if (!(e instanceof BaseFeeReadError) || e.code !== 'FEE_RPC_REJECTED') throw e;
        observation.simulation = { status: 'rejected', outputBaseUnits: null, estimatedGas: null };
      }
    }
    const final = await readFeeHeader(read, height, header.hash), finalSource = await readFeeHeader(read, q.blockNumber);
    if (JSON.stringify(final) !== JSON.stringify(header) || JSON.stringify(finalSource) !== JSON.stringify(original)) fail('FEE_BLOCK_CHANGED');
    if (feeQuantity(await read('eth_chainId')) !== '8453') fail('FEE_NETWORK_CHANGED');
    observation.observedAtSeconds = Math.floor(Date.now() / 1000);
    const review = await prepareProposalStateReview({ simulationPlanFile, observation }, { signal: s.signal, subtle: s.subtle }); guard();
    return Object.freeze({ review, diagnostics: Object.freeze({ rpcUrl: 'https://mainnet.base.org', headSelectedAtStart: height, canonicalBlockRechecked: true,
      oracleFailures: bounds.failures, originalCallUnchanged: true, nonceRead: false, signed: false, transactionBroadcast: false, authorizesExecution: false }) });
  });
}
