import { captureDataRecord, captureOptionalDataFields, sha256Hex } from './security-data.js';
import { boundedUtf8Length, parseSecurityJson } from './security-json.js';
import { quoteUnits, quoteTime } from './aerodrome-quote-model.js';
import { inspectProposalSimulationPlanFile, prepareProposalSimulationPlan, SIMULATION_PLAN_FILE_LIMIT } from './proposal-simulation-plan.js';
import { operationBudgetAssetSymbol } from './operation-budget.js';

export const PROPOSAL_STATE_SCHEMA = 'threecore.proposal-state-observation.v1';
export const PROPOSAL_STATE_FILE_SCHEMA = 'threecore.proposal-state-review-file.v1';
export const PROPOSAL_STATE_FILE_LIMIT = 16777216;
export class ProposalStateError extends Error { constructor(code) { super(code); this.code = code; this.name = 'ProposalStateError'; } }
const fail = code => { throw new ProposalStateError(code); };
const record = (v, keys) => { try { return captureDataRecord(v, keys); } catch { fail('STATE_STRUCTURE'); } };
const bound = (s, n) => { try { boundedUtf8Length(s, n); } catch { fail('STATE_FILE_SIZE'); } };
const opts = v => { try { return captureOptionalDataFields(v, ['nowSeconds', 'subtle', 'signal', 'timeoutMs']); } catch { fail('STATE_OPTIONS'); } };
const checksum = (s, o) => sha256Hex(new TextEncoder().encode(s), o.subtle, o);

export async function inspectProposalStateSource(text, options = {}) {
  bound(text, SIMULATION_PLAN_FILE_LIMIT); const o = opts(options);
  const stored = await inspectProposalSimulationPlanFile(text, o);
  const current = await prepareProposalSimulationPlan(stored.allowanceReviewFile, o);
  return { plan: stored.recordedPlan, currentPlan: current.plan, allowance: current.allowanceReview,
    planSha256: await checksum(text, o) };
}

export function validateProposalStateObservation(input) {
  const o = record(input, ['schema', 'planSha256', 'environment', 'chainId', 'blockNumber', 'blockHash', 'blockTimestampSeconds', 'observedAtSeconds',
    'sourceBlockCanonical', 'tokenHasCode', 'spenderHasCode', 'tokenBalanceBaseUnits', 'allowanceBaseUnits', 'nativeBalanceWei',
    'baseFeePerGasWei', 'priorityFeePerGasWei', 'l1FeeUpperBoundWei', 'operatorFeeUpperBoundWei', 'simulation', 'canonicalBlockRechecked', 'readOnly', 'walletConnected']);
  if (o.schema !== PROPOSAL_STATE_SCHEMA || o.chainId !== 8453 || o.readOnly !== true || o.walletConnected !== false || o.canonicalBlockRechecked !== true ||
      !['public-rpc', 'isolated-evm', 'synthetic-test'].includes(o.environment)) fail('STATE_CONTEXT');
  if (typeof o.planSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.planSha256) || typeof o.blockHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(o.blockHash)) fail('STATE_HASH');
  for (const k of ['sourceBlockCanonical', 'tokenHasCode', 'spenderHasCode']) if (typeof o[k] !== 'boolean') fail('STATE_BOOLEAN');
  for (const k of ['blockTimestampSeconds', 'observedAtSeconds']) quoteTime(o[k]);
  for (const k of ['blockNumber', 'nativeBalanceWei', 'baseFeePerGasWei', 'priorityFeePerGasWei']) quoteUnits(o[k]);
  for (const k of ['l1FeeUpperBoundWei', 'operatorFeeUpperBoundWei']) if (o[k] !== null) quoteUnits(o[k]);
  for (const k of ['tokenBalanceBaseUnits', 'allowanceBaseUnits']) {
    if (o.tokenHasCode) quoteUnits(o[k]); else if (o[k] !== null) fail('STATE_UNKNOWN_AMOUNT');
  }
  const simulation = record(o.simulation, ['status', 'outputBaseUnits', 'estimatedGas']);
  if (!['skipped', 'succeeded', 'rejected'].includes(simulation.status)) fail('STATE_SIMULATION');
  if (simulation.status === 'succeeded') { quoteUnits(simulation.outputBaseUnits); quoteUnits(simulation.estimatedGas); if (simulation.estimatedGas === '0') fail('STATE_SIMULATION'); }
  else if (simulation.outputBaseUnits !== null || simulation.estimatedGas !== null) fail('STATE_SIMULATION');
  return Object.freeze({ ...o, simulation: Object.freeze(simulation) });
}

/** Check only this proposal while preserving every source ETH/USDC reservation.
 * No source file, allowance, deadline or spending cap is rewritten.
 */
export async function prepareProposalStateReview(input, options = {}) {
  const files = record(input, ['simulationPlanFile', 'observation']), s = opts(options);
  const now = quoteTime(s.nowSeconds ?? Math.floor(Date.now() / 1000));
  const o = validateProposalStateObservation(files.observation);
  const source = await inspectProposalStateSource(files.simulationPlanFile, { ...s, nowSeconds: now });
  const p = source.plan, q = source.allowance.quoteReview.quote.quote, reasons = [];
  const add = (condition, reason) => { if (condition) reasons.push(reason); };
  add(!p.eligibleForSimulation || !source.currentPlan.eligibleForSimulation, 'STATE_SOURCE_BLOCKED');
  add(now >= p.deadlineSeconds || o.blockTimestampSeconds >= p.deadlineSeconds, 'STATE_WINDOW_CLOSED');
  add(o.planSha256 !== source.planSha256, 'STATE_SOURCE_MISMATCH');
  add(!o.sourceBlockCanonical, 'STATE_SOURCE_REORG');
  add(BigInt(o.blockNumber) < BigInt(q.blockNumber) || (o.blockNumber === q.blockNumber && o.blockHash !== q.blockHash), 'STATE_BLOCK_ORDER');
  add(o.observedAtSeconds < p.evaluatedAtSeconds || o.blockTimestampSeconds < q.blockTimestampSeconds || o.blockTimestampSeconds > o.observedAtSeconds || o.observedAtSeconds > now, 'STATE_TIME_ORDER');
  add(now - o.observedAtSeconds >= 60 || now - o.blockTimestampSeconds >= 60, 'STATE_STALE');
  add(!o.tokenHasCode, 'STATE_TOKEN_MISSING'); add(!o.spenderHasCode, 'STATE_ROUTER_MISSING');
  add(o.allowanceBaseUnits === null || BigInt(o.allowanceBaseUnits) < BigInt(p.amountInBaseUnits), 'STATE_ALLOWANCE_SHORTFALL');

  const inputBudget = source.allowance.quoteReview.proposalReview.evidence.budgetResult.input;
  const budgets = inputBudget.budgets ?? [inputBudget], own = budgets.find(b => b.agent === p.agent);
  let tokenRequiredBaseUnits = null, nativeRequiredWei = null, feeCeilingWei = null;
  if (!own || !p.limits) reasons.push('STATE_BUDGET_MISSING');
  else {
    const sameAsset = budgets.filter(b => operationBudgetAssetSymbol(b) === operationBudgetAssetSymbol(own));
    const tokenRequired = BigInt(own.token.reservedUnits) + BigInt(own.token.reserveFloorUnits) + sameAsset.reduce((n, b) => n + BigInt(b.token.spendUnits), 0n);
    tokenRequiredBaseUnits = String(tokenRequired);
    add(o.tokenBalanceBaseUnits === null || BigInt(o.tokenBalanceBaseUnits) < tokenRequired, 'STATE_TOKEN_RESERVATION_SHORTFALL');
    const l = p.limits;
    add(BigInt(o.baseFeePerGasWei) + BigInt(o.priorityFeePerGasWei) > BigInt(l.maxFeePerGasWei), 'STATE_PRICE_CAP');
    add(o.l1FeeUpperBoundWei === null || o.operatorFeeUpperBoundWei === null, 'STATE_FEES_UNKNOWN');
    for (const [key, budget] of [['l1FeeUpperBoundWei', 'l1FeeBudgetWei'], ['operatorFeeUpperBoundWei', 'operatorFeeBudgetWei']])
      add(o[key] !== null && (l[budget] === null || BigInt(o[key]) > BigInt(l[budget])), 'STATE_' + (key.startsWith('l1') ? 'L1' : 'OPERATOR') + '_BUDGET');
    const cost = b => BigInt(b.fees.gasLimit) * BigInt(b.fees.maxFeePerGasWei) + BigInt(b.fees.bufferWei) + BigInt(b.fees.l1FeeBudgetWei ?? '0') + BigInt(b.fees.operatorFeeBudgetWei ?? '0');
    let ownFee = cost(own);
    if (o.l1FeeUpperBoundWei !== null && o.operatorFeeUpperBoundWei !== null) {
      // Reserve the full gas limit, not only a lower estimate.
      const fresh = BigInt(l.gasLimit) * BigInt(l.maxFeePerGasWei) + BigInt(l.bufferWei) + BigInt(o.l1FeeUpperBoundWei) + BigInt(o.operatorFeeUpperBoundWei);
      feeCeilingWei = String(fresh); if (fresh > ownFee) ownFee = fresh;
      add(fresh > BigInt(l.policyMaxTotalFeeWei), 'STATE_TOTAL_CAP');
    }
    add(budgets.some(b => b.fees.l1FeeBudgetWei === null || b.fees.operatorFeeBudgetWei === null), 'STATE_RESERVED_FEES_UNKNOWN');
    const nativeRequired = BigInt(own.native.reservedWei) + BigInt(own.native.reserveFloorWei) + budgets.reduce((n, b) => n + BigInt(b.native.valueWei) + (b.agent === p.agent ? ownFee : cost(b)), 0n);
    nativeRequiredWei = String(nativeRequired);
    add(BigInt(o.nativeBalanceWei) < nativeRequired, 'STATE_NATIVE_RESERVATION_SHORTFALL');
    add(nativeRequired > (1n << 256n) - 1n || tokenRequired > (1n << 256n) - 1n, 'STATE_AMOUNT_OVERFLOW');
    if (o.simulation.status === 'succeeded') {
      add(BigInt(o.simulation.estimatedGas) > BigInt(l.gasLimit), 'STATE_GAS_LIMIT');
      add(BigInt(o.simulation.outputBaseUnits) < BigInt(p.minimumOutputBaseUnits), 'STATE_MINIMUM_OUTPUT');
    }
  }
  add(o.simulation.status !== 'succeeded', o.simulation.status === 'rejected' ? 'STATE_SIMULATION_REJECTED' : 'STATE_SIMULATION_MISSING');
  const result = Object.freeze({ planSha256: source.planSha256, agent: p.agent, account: p.recipient, evaluatedAtSeconds: now, deadlineSeconds: p.deadlineSeconds,
    environment: o.environment, observation: o, tokenRequiredBaseUnits, nativeRequiredWei, feeCeilingWei,
    checksSatisfied: reasons.length === 0, reasons: Object.freeze(reasons), scope: 'one proposal with source ETH and same-token reservations',
    observedAtPinnedBlockOnly: true, currentStateGuaranteed: false, sourceAuthorAuthenticated: false,
    signed: false, transactionBroadcast: false, authorizesExecution: false });
  const text = JSON.stringify({ schema: PROPOSAL_STATE_FILE_SCHEMA, reviewOnly: true, simulationPlanFile: files.simulationPlanFile,
    observation: o, evaluatedAtSeconds: now, result }, null, 2) + '\n';
  bound(text, PROPOSAL_STATE_FILE_LIMIT); return Object.freeze({ text, result });
}

export async function inspectProposalStateReviewFile(text, options = {}) {
  bound(text, PROPOSAL_STATE_FILE_LIMIT); let d;
  try { d = record(parseSecurityJson(text), ['schema', 'reviewOnly', 'simulationPlanFile', 'observation', 'evaluatedAtSeconds', 'result']); } catch { fail('STATE_FILE_FORMAT'); }
  if (d.schema !== PROPOSAL_STATE_FILE_SCHEMA || d.reviewOnly !== true) fail('STATE_FILE_FORMAT');
  quoteTime(d.evaluatedAtSeconds);
  const checked = await prepareProposalStateReview({ simulationPlanFile: d.simulationPlanFile, observation: d.observation }, { ...opts(options), nowSeconds: d.evaluatedAtSeconds });
  const equal = (a, b) => { if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
    if (Array.isArray(a) !== Array.isArray(b)) return false; const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k])); };
  if (!equal(d.result, checked.result)) fail('STATE_RECORDED_RESULT');
  return Object.freeze({ files: Object.freeze({ simulationPlanFile: d.simulationPlanFile, observation: checked.result.observation }), recordedResult: checked.result, historicalOnly: true, timestampAuthenticated: false, authorizesExecution: false });
}
