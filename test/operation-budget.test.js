import test from "node:test";
import assert from "node:assert/strict";
import { operationBudgetExample, evaluateOperationBudget, validateOperationBudget,
  decodeOperationBudget, encodeOperationBudget, OPERATION_BUDGET_LIMIT } from "../src/operation-budget.js";
const input = () => { const data = structuredClone(operationBudgetExample()); data.fees.operatorFeeBudgetWei = "0"; return data; };
const unit = 10n ** 18n;

test("token capital and ETH fees remain separate, with existing reservations preserved", () => {
  const data = input(), before = structuredClone(data), r = evaluateOperationBudget(data);
  assert.equal(r.constraintsSatisfied, true);
  assert.equal(r.token.required, String(350n * unit)); assert.equal(r.token.surplus, String(650n * unit));
  assert.equal(r.executionBudgetWei, "20000000000000"); assert.equal(r.plannedFeeBudgetWei, "40000000000000");
  assert.equal(r.native.required, "3040000000000000"); assert.equal(r.native.surplus, "6960000000000000");
  assert.equal(r.authorizesExecution, false); assert.equal(r.sourceVerified, false); assert.equal(r.onchainFeeCap, false);
  assert.deepEqual(data, before); assert.ok(Object.isFrozen(r.input.fees));
});
test("abundant tokens never pay for missing ETH, and abundant ETH never pays for missing tokens", () => {
  const noEth = input(); noEth.native.balanceWei = "0";
  assert.deepEqual(evaluateOperationBudget(noEth).reasons, ["NATIVE_BUDGET_SHORTFALL"]);
  const noTokens = input(); noTokens.token.balanceUnits = "0";
  assert.deepEqual(evaluateOperationBudget(noTokens).reasons, ["TOKEN_BUDGET_SHORTFALL"]);
});
test("exactly sufficient budgets pass, a one-wei or one-token-unit shortage fails", () => {
  const data = input(), r = evaluateOperationBudget(data);
  data.native.balanceWei = r.native.required; data.token.balanceUnits = r.token.required;
  assert.equal(evaluateOperationBudget(data).constraintsSatisfied, true);
  data.native.balanceWei = (BigInt(data.native.balanceWei) - 1n).toString();
  data.token.balanceUnits = (BigInt(data.token.balanceUnits) - 1n).toString();
  const result = evaluateOperationBudget(data);
  assert.equal(result.native.shortfall, "1"); assert.equal(result.token.shortfall, "1");
  assert.equal(result.native.surplus, "0"); assert.equal(result.token.surplus, "0");
});
test("unknown fee components keep total and affordability unknown rather than filling zero", () => {
  const data = structuredClone(operationBudgetExample()), r = evaluateOperationBudget(data);
  assert.equal(r.constraintsSatisfied, false); assert.equal(r.plannedFeeBudgetWei, null);
  assert.equal(r.plannedNativeCostWei, null); assert.equal(r.native, null);
  assert.deepEqual(r.unknownComponents, ["operatorFeeBudgetWei"]);
  data.fees.l1FeeBudgetWei = null; data.native.balanceWei = "1";
  const unknown = evaluateOperationBudget(data);
  assert.deepEqual(unknown.unknownComponents, ["l1FeeBudgetWei", "operatorFeeBudgetWei"]);
  assert.ok(unknown.reasons.includes("NATIVE_BUDGET_SHORTFALL"));
  assert.ok(BigInt(unknown.knownNativeMinimum.shortfall) > 0n);
});
test("explicit extra fee, native value and buffer all consume ETH only", () => {
  const data = input(), before = evaluateOperationBudget(data);
  data.fees.operatorFeeBudgetWei = "13"; data.native.valueWei = "17"; data.fees.bufferWei = "10000000000019";
  const after = evaluateOperationBudget(data);
  assert.deepEqual(after.token, before.token);
  assert.equal(BigInt(after.native.required) - BigInt(before.native.required), 49n);
});
test("existing reservations and floors cannot be double-counted as spendable balance", () => {
  const data = input(); data.native.reservedWei = data.native.balanceWei;
  data.token.reservedUnits = data.token.balanceUnits;
  const r = evaluateOperationBudget(data);
  assert.equal(r.constraintsSatisfied, false); assert.ok(BigInt(r.token.shortfall) > BigInt(data.token.spendUnits));
  assert.ok(BigInt(r.native.shortfall) > BigInt(r.plannedFeeBudgetWei));
});
test("large exact integers never go through floating point", () => {
  const data = input(); data.token.balanceUnits = "9007199254740993000000000000000001";
  data.token.reservedUnits = "0"; data.token.reserveFloorUnits = "0"; data.token.spendUnits = "9007199254740993000000000000000000";
  assert.equal(evaluateOperationBudget(data).token.surplus, "1");
});
test("all three agents and supported chains keep their own identity in a stable round trip", () => {
  for (const agent of ["DAT", "EMA", "CAWELON"]) for (const chainId of [8453, 84532]) {
    const data = input(); Object.assign(data, { agent, chainId });
    const text = encodeOperationBudget(data), decoded = decodeOperationBudget(text);
    assert.equal(encodeOperationBudget(decoded), text); assert.equal(evaluateOperationBudget(decoded).input.agent, agent);
    assert.equal(decoded.chainId, chainId);
  }
});
test("zero token spend is not an accepted operation budget", () => {
  const data = input(); data.token.spendUnits = "0";
  assert.deepEqual(evaluateOperationBudget(data).reasons, ["ZERO_TOKEN_SPEND"]);
});
test("rejects uint256 multiplication and addition overflow", () => {
  const max = ((1n << 256n) - 1n).toString();
  for (const mutate of [d => { d.fees.gasLimit = max; }, d => { d.token.reserveFloorUnits = max; },
    d => { d.native.valueWei = max; }, d => { d.fees.l1FeeBudgetWei = max; }]) {
    const data = input(); mutate(data); assert.throws(() => evaluateOperationBudget(data), { code: "AMOUNT_OVERFLOW" });
  }
});
test("rejects ambiguous amounts, absent fields and inappropriate contexts", () => {
  for (const value of [0, 0n, "", "01", "-1", "1e2", "0x10", " 1", "1.1", "9".repeat(79), (1n << 256n).toString()]) {
    const data = input(); data.token.spendUnits = value;
    assert.throws(() => evaluateOperationBudget(data), { code: "INVALID_AMOUNT" });
  }
  for (const mutate of [d => { delete d.fees.operatorFeeBudgetWei; }, d => { d.fees.extra = "1"; },
    d => { d.native = []; }, d => { d.simulationOnly = false; }, d => { d.chainId = 1; }, d => { d.agent = "CAW"; },
    d => { d.token.decimals = 19; }, d => { d.fees.gasLimit = "0"; }, d => { d.fees.maxFeePerGasWei = "0"; }]) {
    const data = input(); mutate(data); assert.throws(() => evaluateOperationBudget(data));
  }
});
test("input accessors are not invoked and later mutations cannot change a captured result", () => {
  let calls = 0; const data = input();
  Object.defineProperty(data.fees, "gasLimit", { get() { calls++; return "200000"; }, enumerable: true });
  assert.throws(() => evaluateOperationBudget(data), { code: "INVALID_STRUCTURE" }); assert.equal(calls, 0);
  const mutable = input(), report = evaluateOperationBudget(mutable); mutable.native.balanceWei = "0";
  assert.equal(report.input.native.balanceWei, "10000000000000000");
});
test("JSON rejects duplicate keys, BOM, extra data and oversized documents", () => {
  const text = encodeOperationBudget(input());
  for (const invalid of ['{"schema":"a","schema":"b"}', "\ufeff" + text, text + "{}", "{", '{"__proto__":{}}'])
    assert.throws(() => decodeOperationBudget(invalid), { code: "INVALID_JSON" });
  assert.throws(() => decodeOperationBudget(" ".repeat(OPERATION_BUDGET_LIMIT + 1)), { code: "FILE_TOO_LARGE" });
  const extra = input(); extra.result = { constraintsSatisfied: true };
  assert.throws(() => validateOperationBudget(extra), { code: "INVALID_STRUCTURE" });
});
