import { captureDataRecord, captureOptionalDataFields, sha256Hex } from './security-data.js';
import { boundedUtf8Length, parseSecurityJson } from './security-json.js';
import { quoteUnits, quoteTime } from './aerodrome-quote-model.js';
import { SIMULATION_PLAN_FILE_LIMIT, inspectProposalSimulationPlanFile, prepareProposalSimulationPlan } from './proposal-simulation-plan.js';

export const PROPOSAL_FEE_SCHEMA = 'threecore.proposal-fee-observation.v1';
export const PROPOSAL_FEE_FILE_SCHEMA = 'threecore.proposal-fee-review-file.v1';
export const PROPOSAL_FEE_FILE_LIMIT = 16777216;
export class ProposalFeeError extends Error {
  constructor(code) { super(code); this.name = 'ProposalFeeError'; this.code = code; }
}
const fail = code => { throw new ProposalFeeError(code); };
function record(input, names) { try { return captureDataRecord(input, names); } catch { fail('FEE_STRUCTURE'); } }
function bound(text, limit) { try { boundedUtf8Length(text, limit); } catch { fail('FEE_FILE_SIZE'); } return text; }
function options(input) {
  try { return captureOptionalDataFields(input, ['nowSeconds', 'maxObservationAgeSeconds', 'subtle', 'signal', 'timeoutMs']); }
  catch { fail('FEE_OPTIONS'); }
}
const hash = (text, s) => sha256Hex(new TextEncoder().encode(text), s.subtle, s);

/** A supplied observation is evidence to compare, never authenticated authority. */
export function validateProposalFeeObservation(input) {
  const o = record(input, ['schema', 'planSha256', 'environment', 'chainId', 'blockNumber', 'blockHash', 'observedAtSeconds', 'estimatedGas', 'baseFeePerGasWei', 'priorityFeePerGasWei', 'l1FeeUpperBoundWei', 'operatorFeeUpperBoundWei', 'readOnly']);
  if (o.schema !== PROPOSAL_FEE_SCHEMA || o.chainId !== 8453 || o.readOnly !== true ||
      !['isolated-evm', 'public-rpc', 'synthetic-test'].includes(o.environment)) fail('FEE_CONTEXT');
  if (typeof o.planSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.planSha256) ||
      typeof o.blockHash !== 'string' || !/^0x[0-9a-f]{64}$/.test(o.blockHash)) fail('FEE_HASH');
  quoteTime(o.observedAtSeconds);
  for (const key of ['blockNumber', 'estimatedGas', 'baseFeePerGasWei', 'priorityFeePerGasWei']) quoteUnits(o[key]);
  if (o.estimatedGas === '0') fail('FEE_EMPTY_GAS');
  for (const key of ['l1FeeUpperBoundWei', 'operatorFeeUpperBoundWei']) if (o[key] !== null) quoteUnits(o[key]);
  return Object.freeze({ ...o });
}

/** Compare transaction-specific estimates with the original budgets; never raise a cap. */
export async function prepareProposalFeeReview(input, settings = {}) {
  const files = record(input, ['simulationPlanFile', 'observation']), s = options(settings);
  bound(files.simulationPlanFile, SIMULATION_PLAN_FILE_LIMIT);
  const observation = validateProposalFeeObservation(files.observation);
  const now = quoteTime(s.nowSeconds ?? Math.floor(Date.now() / 1000)), age = s.maxObservationAgeSeconds ?? 60;
  if (!Number.isSafeInteger(age) || age < 1 || age > 600) fail('FEE_AGE_LIMIT');
  const stored = await inspectProposalSimulationPlanFile(files.simulationPlanFile, s);
  const current = await prepareProposalSimulationPlan(stored.allowanceReviewFile, { ...s, nowSeconds: now });
  const plan = current.plan, planSha256 = await hash(files.simulationPlanFile, s), o = observation;
  const reasons = [];
  if (!plan.eligibleForSimulation || !stored.recordedPlan.eligibleForSimulation) reasons.push('FEE_PLAN_BLOCKED');
  if (o.planSha256 !== planSha256) reasons.push('FEE_PLAN_MISMATCH');
  const call = stored.recordedPlan.call;
  if (!call || call.chainId !== o.chainId || call.blockNumber !== o.blockNumber || call.blockHash !== o.blockHash) reasons.push('FEE_BLOCK_MISMATCH');
  if (o.observedAtSeconds < stored.recordedPlan.evaluatedAtSeconds) reasons.push('FEE_OBSERVATION_BEFORE_PLAN');
  if (o.observedAtSeconds > now) reasons.push('FEE_OBSERVATION_FUTURE');
  if (now - o.observedAtSeconds >= age) reasons.push('FEE_OBSERVATION_EXPIRED');
  if (o.l1FeeUpperBoundWei === null) reasons.push('FEE_L1_UNKNOWN');
  if (o.operatorFeeUpperBoundWei === null) reasons.push('FEE_OPERATOR_UNKNOWN');
  let l2FeeCeilingWei = null, totalFeeUpperBoundWei = null, knownFeeSubtotalWei = null;
  const limits = plan.limits;
  if (limits) {
    const gas = BigInt(o.estimatedGas), price = BigInt(limits.maxFeePerGasWei);
    if (gas > BigInt(limits.gasLimit)) reasons.push('FEE_GAS_LIMIT_EXCEEDED');
    if (BigInt(o.baseFeePerGasWei) + BigInt(o.priorityFeePerGasWei) > price) reasons.push('FEE_PRICE_CAP_EXCEEDED');
    l2FeeCeilingWei = (gas * price).toString();
    let subtotal = BigInt(l2FeeCeilingWei) + BigInt(limits.bufferWei);
    for (const [observed, budget, reason] of [
      ['l1FeeUpperBoundWei', 'l1FeeBudgetWei', 'FEE_L1_BUDGET_EXCEEDED'],
      ['operatorFeeUpperBoundWei', 'operatorFeeBudgetWei', 'FEE_OPERATOR_BUDGET_EXCEEDED'],
    ]) {
      if (o[observed] !== null) {
        subtotal += BigInt(o[observed]);
        if (limits[budget] === null || BigInt(o[observed]) > BigInt(limits[budget])) reasons.push(reason);
      }
    }
    knownFeeSubtotalWei = subtotal.toString();
    if (o.l1FeeUpperBoundWei !== null && o.operatorFeeUpperBoundWei !== null) totalFeeUpperBoundWei = knownFeeSubtotalWei;
    if (subtotal > BigInt(limits.policyMaxTotalFeeWei)) reasons.push('FEE_POLICY_TOTAL_EXCEEDED');
  }
  const result = Object.freeze({ planSha256, agent: plan.agent, evaluatedAtSeconds: now, maxObservationAgeSeconds: age,
    environment: o.environment, observation, limits, l2FeeCeilingWei, knownFeeSubtotalWei, totalFeeUpperBoundWei,
    completeFeeEstimate: totalFeeUpperBoundWei !== null, checksSatisfied: reasons.length === 0, reasons: Object.freeze(reasons),
    historicalOnly: true, currentStateVerified: false, sourceAuthorAuthenticated: false,
    userWalletUsed: false, signed: false, transactionBroadcast: false, authorizesExecution: false });
  const text = bound(JSON.stringify({ schema: PROPOSAL_FEE_FILE_SCHEMA, reviewOnly: true,
    simulationPlanFile: files.simulationPlanFile, observation, evaluatedAtSeconds: now, maxObservationAgeSeconds: age, result }, null, 2) + '\n', PROPOSAL_FEE_FILE_LIMIT);
  return Object.freeze({ text, result });
}

export async function inspectProposalFeeReviewFile(text, settings = {}) {
  bound(text, PROPOSAL_FEE_FILE_LIMIT); let data;
  try { data = record(parseSecurityJson(text), ['schema', 'reviewOnly', 'simulationPlanFile', 'observation', 'evaluatedAtSeconds', 'maxObservationAgeSeconds', 'result']); }
  catch { fail('FEE_FILE_FORMAT'); }
  if (data.schema !== PROPOSAL_FEE_FILE_SCHEMA || data.reviewOnly !== true) fail('FEE_FILE_FORMAT');
  quoteTime(data.evaluatedAtSeconds);
  const checked = await prepareProposalFeeReview({ simulationPlanFile: data.simulationPlanFile, observation: data.observation },
    { ...options(settings), nowSeconds: data.evaluatedAtSeconds, maxObservationAgeSeconds: data.maxObservationAgeSeconds });
  const equal = (a, b) => {
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
  };
  if (!equal(data.result, checked.result)) fail('FEE_RECORDED_RESULT');
  return Object.freeze({ files: Object.freeze({ simulationPlanFile: data.simulationPlanFile, observation: checked.result.observation }),
    recordedResult: checked.result, historicalOnly: true, timestampAuthenticated: false, authorizesExecution: false });
}
