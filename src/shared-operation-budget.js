import { captureDataRecord, captureDataArray } from "./security-data.js";
import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";
import { OperationBudgetError, USDC_OPERATION_BUDGET_SCHEMA, validateOperationBudget, evaluateOperationBudget } from "./operation-budget.js";

export const SHARED_BUDGET_SCHEMA = "threecore.shared-operation-budget.v1";
export const SHARED_BUDGET_LIMIT = 49152;
const MAX = (1n << 256n) - 1n;
const fail = code => { throw new OperationBudgetError(code); };
const checked = value => { if (value > MAX) fail("AMOUNT_OVERFLOW"); return value; };

/** The caller explicitly assumes one account. No account, balance or fee is verified here. */
export function validateSharedOperationBudget(input) {
  let data, captured;
  try {
    data = captureDataRecord(input, ["schema", "simulationOnly", "sameAccount", "budgets"]);
    captured = captureDataArray(data.budgets, 3, 2);
  } catch { fail("INVALID_SHARED_STRUCTURE"); }
  if (data.schema !== SHARED_BUDGET_SCHEMA || data.simulationOnly !== true || data.sameAccount !== true)
    fail("SHARED_ACCOUNT_ASSUMPTION_REQUIRED");
  const budgets = captured.map(validateOperationBudget), first = budgets[0];
  if (new Set(budgets.map(b => b.agent)).size !== budgets.length) fail("DUPLICATE_AGENT");
  if (budgets.some(b => b.chainId !== first.chainId)) fail("SHARED_NETWORK_MISMATCH");
  for (const key of ["balanceWei", "reservedWei", "reserveFloorWei"])
    if (budgets.some(b => b.native[key] !== first.native[key])) fail("SHARED_BALANCE_MISMATCH");
  const usdc = budgets.filter(b => b.schema === USDC_OPERATION_BUDGET_SCHEMA);
  if (usdc.length > 1) for (const key of ["balanceUnits", "reservedUnits", "reserveFloorUnits"])
    if (usdc.some(b => b.token[key] !== usdc[0].token[key])) fail("SHARED_USDC_BALANCE_MISMATCH");
  return Object.freeze({ schema: SHARED_BUDGET_SCHEMA, simulationOnly: true, sameAccount: true,
    budgets: Object.freeze(budgets) });
}

export function evaluateSharedOperationBudget(input) {
  const data = validateSharedOperationBudget(input), results = data.budgets.map(evaluateOperationBudget);
  const sum = field => checked(results.reduce((total, r) => total + BigInt(r[field]), 0n));
  const knownNativeCostWei = checked(results.reduce((total, r) => total + BigInt(r.input.native.valueWei) + BigInt(r.knownFeeBudgetWei), 0n));
  const first = data.budgets[0].native;
  const baseRequired = checked(BigInt(first.reservedWei) + BigInt(first.reserveFloorWei));
  const required = checked(baseRequired + knownNativeCostWei), balance = BigInt(first.balanceWei);
  const minimum = Object.freeze({ required: String(required), shortfall: String(required > balance ? required - balance : 0n),
    surplus: String(balance > required ? balance - required : 0n) });
  const unknown = results.flatMap(r => r.unknownComponents.map(component => Object.freeze({ agent: r.input.agent, component })));
  const reasons = [];
  if (results.some(r => r.reasons.includes("ZERO_TOKEN_SPEND"))) reasons.push("ZERO_TOKEN_SPEND");
  if (results.some(r => r.token.shortfall !== "0")) reasons.push("TOKEN_BUDGET_SHORTFALL");
  if (unknown.length) reasons.push("FEE_COMPONENT_UNKNOWN");
  if (minimum.shortfall !== "0") reasons.push("SHARED_ETH_SHORTFALL");
  const usdc = data.budgets.filter(b => b.schema === USDC_OPERATION_BUDGET_SCHEMA);
  let sharedUsdc = null;
  if (usdc.length) {
    const balance = BigInt(usdc[0].token.balanceUnits);
    const spend = checked(usdc.reduce((sum, b) => sum + BigInt(b.token.spendUnits), 0n));
    // Shared reserves are counted once, as with shared ETH. Each plan's spending is counted.
    const required = checked(BigInt(usdc[0].token.reservedUnits) + BigInt(usdc[0].token.reserveFloorUnits) + spend);
    sharedUsdc = Object.freeze({ asset: "USDC", decimals: 6, spendUnits: String(spend), required: String(required),
      shortfall: String(required > balance ? required - balance : 0n), surplus: String(balance > required ? balance - required : 0n) });
    if (sharedUsdc.shortfall !== "0") reasons.push("SHARED_USDC_SHORTFALL");
  }
  return Object.freeze({ schema: "threecore.shared-operation-budget-result.v1", input: data,
    simulationOnly: true, sourceVerified: false, authorizesExecution: false, onchainFeeCap: false,
    constraintsSatisfied: reasons.length === 0, reasons: Object.freeze(reasons),
    individuallySatisfied: results.every(r => r.constraintsSatisfied), results: Object.freeze(results),
    knownFeeBudgetWei: String(sum("knownFeeBudgetWei")), knownNativeCostWei: String(knownNativeCostWei),
    plannedNativeCostWei: unknown.length ? null : String(knownNativeCostWei),
    native: unknown.length ? null : minimum, knownNativeMinimum: minimum, unknownComponents: Object.freeze(unknown),
    ...(sharedUsdc ? { sharedUsdc } : {}) });
}

export function encodeSharedOperationBudget(input) {
  return JSON.stringify(validateSharedOperationBudget(input), null, 2) + "\n";
}
export function decodeSharedOperationBudget(text) {
  try { boundedUtf8Length(text, SHARED_BUDGET_LIMIT); } catch { fail("FILE_TOO_LARGE"); }
  let data;
  try { data = parseSecurityJson(text); } catch { fail("INVALID_JSON"); }
  return validateSharedOperationBudget(data);
}
