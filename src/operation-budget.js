import { captureDataRecord } from "./security-data.js";
import { parseSecurityJson, boundedUtf8Length } from "./security-json.js";

export const OPERATION_BUDGET_SCHEMA = "threecore.operation-budget.v1";
// A distinct schema keeps historical DAT/EMA/CAWELON budgets from changing currency.
export const USDC_OPERATION_BUDGET_SCHEMA = "threecore.usdc-operation-budget.v1";
export const OPERATION_BUDGET_LIMIT = 16384;
const MAX = (1n << 256n) - 1n;
const TOKEN_FIELDS = ["decimals", "balanceUnits", "reservedUnits", "reserveFloorUnits", "spendUnits"];
const NATIVE_FIELDS = ["balanceWei", "reservedWei", "reserveFloorWei", "valueWei"];
const FEE_FIELDS = ["gasLimit", "maxFeePerGasWei", "l1FeeBudgetWei", "operatorFeeBudgetWei", "bufferWei"];

export class OperationBudgetError extends Error {
  constructor(code) { super(code); this.name = "OperationBudgetError"; this.code = code; }
}
const fail = code => { throw new OperationBudgetError(code); };
function record(input, keys) {
  try { return captureDataRecord(input, keys); } catch { fail("INVALID_STRUCTURE"); }
}
function amount(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > MAX)
    fail("INVALID_AMOUNT");
  return value;
}
function checked(value) {
  if (value > MAX) fail("AMOUNT_OVERFLOW");
  return value;
}
export function validateOperationBudget(input) {
  const data = record(input, ["schema", "simulationOnly", "agent", "chainId", "token", "native", "fees"]);
  if (![OPERATION_BUDGET_SCHEMA, USDC_OPERATION_BUDGET_SCHEMA].includes(data.schema) || data.simulationOnly !== true) fail("SIMULATION_REQUIRED");
  if (!["DAT", "EMA", "CAWELON"].includes(data.agent) || ![8453, 84532].includes(data.chainId)) fail("INVALID_CONTEXT");
  const token = record(data.token, TOKEN_FIELDS), native = record(data.native, NATIVE_FIELDS), fees = record(data.fees, FEE_FIELDS);
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 18) fail("INVALID_DECIMALS");
  if (data.schema === USDC_OPERATION_BUDGET_SCHEMA && (data.chainId !== 8453 || token.decimals !== 6)) fail("USDC_BUDGET_CONTEXT");
  const capturedToken = Object.freeze({ decimals: token.decimals,
    ...Object.fromEntries(TOKEN_FIELDS.slice(1).map(key => [key, amount(token[key])])) });
  const capturedNative = Object.freeze(Object.fromEntries(NATIVE_FIELDS.map(key => [key, amount(native[key])])));
  const capturedFees = Object.freeze(Object.fromEntries(FEE_FIELDS.map(key => [key,
    ["l1FeeBudgetWei", "operatorFeeBudgetWei"].includes(key) && fees[key] === null ? null : amount(fees[key])])));
  if (capturedFees.gasLimit === "0" || capturedFees.maxFeePerGasWei === "0") fail("ZERO_EXECUTION_BUDGET");
  return Object.freeze({ schema: data.schema, simulationOnly: true,
    agent: data.agent, chainId: data.chainId, token: capturedToken, native: capturedNative, fees: capturedFees });
}

export function operationBudgetAssetSymbol(input) {
  const data = validateOperationBudget(input);
  return data.schema === USDC_OPERATION_BUDGET_SCHEMA ? "USDC" : data.agent;
}

function balanceCheck(balance, reserved, floor, spend) {
  const required = checked(reserved + floor + spend);
  return Object.freeze({ required: required.toString(),
    shortfall: (required > balance ? required - balance : 0n).toString(),
    surplus: (balance > required ? balance - required : 0n).toString() });
}

/** Independent token/ETH arithmetic from manual assumptions. No transaction or RPC object. */
export function evaluateOperationBudget(input) {
  const data = validateOperationBudget(input), { token, native, fees } = data;
  const tokenCheck = balanceCheck(BigInt(token.balanceUnits), BigInt(token.reservedUnits),
    BigInt(token.reserveFloorUnits), BigInt(token.spendUnits));
  const executionBudgetWei = checked(BigInt(fees.gasLimit) * BigInt(fees.maxFeePerGasWei));
  const unknownComponents = ["l1FeeBudgetWei", "operatorFeeBudgetWei"].filter(key => fees[key] === null);
  const knownFeeBudgetWei = checked(executionBudgetWei + BigInt(fees.bufferWei) +
    BigInt(fees.l1FeeBudgetWei ?? "0") + BigInt(fees.operatorFeeBudgetWei ?? "0"));
  const knownNativeCostWei = checked(BigInt(native.valueWei) + knownFeeBudgetWei);
  const minimumNativeCheck = balanceCheck(BigInt(native.balanceWei), BigInt(native.reservedWei),
    BigInt(native.reserveFloorWei), knownNativeCostWei);
  const reasons = [];
  if (token.spendUnits === "0") reasons.push("ZERO_TOKEN_SPEND");
  if (tokenCheck.shortfall !== "0") reasons.push("TOKEN_BUDGET_SHORTFALL");
  if (unknownComponents.length) reasons.push("FEE_COMPONENT_UNKNOWN");
  if (minimumNativeCheck.shortfall !== "0") reasons.push("NATIVE_BUDGET_SHORTFALL");
  return Object.freeze({ schema: "threecore.operation-budget-result.v1", input: data,
    simulationOnly: true, sourceVerified: false, authorizesExecution: false, onchainFeeCap: false,
    constraintsSatisfied: reasons.length === 0, reasons: Object.freeze(reasons),
    token: tokenCheck, executionBudgetWei: executionBudgetWei.toString(),
    knownFeeBudgetWei: knownFeeBudgetWei.toString(), unknownComponents: Object.freeze(unknownComponents),
    plannedFeeBudgetWei: unknownComponents.length ? null : knownFeeBudgetWei.toString(),
    plannedNativeCostWei: unknownComponents.length ? null : knownNativeCostWei.toString(),
    native: unknownComponents.length ? null : minimumNativeCheck,
    knownNativeMinimum: minimumNativeCheck });
}

export function decodeOperationBudget(text) {
  try { boundedUtf8Length(text, OPERATION_BUDGET_LIMIT); } catch { fail("FILE_TOO_LARGE"); }
  let input;
  try { input = parseSecurityJson(text); } catch { fail("INVALID_JSON"); }
  return validateOperationBudget(input);
}
export function encodeOperationBudget(input) {
  return JSON.stringify(validateOperationBudget(input), null, 2) + "\n";
}

/** Illustrative values only; this is not a live gas quote or an operating policy. */
export function operationBudgetExample() {
  return validateOperationBudget({ schema: OPERATION_BUDGET_SCHEMA, simulationOnly: true, agent: "DAT", chainId: 84532,
    token: { decimals: 18, balanceUnits: "1000000000000000000000", reservedUnits: "100000000000000000000",
      reserveFloorUnits: "200000000000000000000", spendUnits: "50000000000000000000" },
    native: { balanceWei: "10000000000000000", reservedWei: "1000000000000000", reserveFloorWei: "2000000000000000", valueWei: "0" },
    fees: { gasLimit: "200000", maxFeePerGasWei: "100000000", l1FeeBudgetWei: "10000000000000",
      operatorFeeBudgetWei: null, bufferWei: "10000000000000" } });
}
