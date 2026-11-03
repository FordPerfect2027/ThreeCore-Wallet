import test from "node:test";
import assert from "node:assert/strict";
import { operationBudgetExample } from "../src/operation-budget.js";
import { SHARED_BUDGET_SCHEMA, SHARED_BUDGET_LIMIT, validateSharedOperationBudget, evaluateSharedOperationBudget,
  encodeSharedOperationBudget, decodeSharedOperationBudget } from "../src/shared-operation-budget.js";
const input = () => ({ schema: SHARED_BUDGET_SCHEMA, simulationOnly: true, sameAccount: true,
  budgets: ["DAT", "EMA", "CAWELON"].map(agent => {
    const b = structuredClone(operationBudgetExample()); b.agent = agent; b.fees.operatorFeeBudgetWei = "0";
    b.native.balanceWei = "3060000000000000"; return b;
  }) });

test("three individually sufficient plans cannot each reuse the same ETH balance", () => {
  const data = input(), r = evaluateSharedOperationBudget(data);
  assert.equal(r.individuallySatisfied, true); assert.equal(r.constraintsSatisfied, false);
  assert.equal(r.native.required, "3120000000000000"); assert.equal(r.native.shortfall, "60000000000000");
  assert.deepEqual(r.reasons, ["SHARED_ETH_SHORTFALL"]);
  assert.equal(r.sourceVerified, false); assert.equal(r.authorizesExecution, false); assert.equal(r.onchainFeeCap, false);
  assert.equal(r.input.budgets[0].native.balanceWei, "3060000000000000");
});
test("shared reserves are counted once and each operation's native value and fees are counted", () => {
  const data = input(); data.budgets[0].native.valueWei = "13"; data.budgets[1].native.valueWei = "7";
  data.budgets.forEach(b => { b.native.balanceWei = "3120000000000020"; });
  const r = evaluateSharedOperationBudget(data);
  assert.equal(r.constraintsSatisfied, true); assert.equal(r.native.surplus, "0");
  assert.equal(r.plannedNativeCostWei, "120000000000020");
  data.budgets.forEach(b => { b.native.balanceWei = "3120000000000019"; });
  assert.equal(evaluateSharedOperationBudget(data).native.shortfall, "1");
});
test("tokens retain separate balances, decimals and shortfalls", () => {
  const data = input(); data.budgets.forEach(b => { b.native.balanceWei = "10000000000000000"; });
  data.budgets[1].token = { decimals: 6, balanceUnits: "10", reservedUnits: "0", reserveFloorUnits: "0", spendUnits: "11" };
  const r = evaluateSharedOperationBudget(data);
  assert.deepEqual(r.reasons, ["TOKEN_BUDGET_SHORTFALL"]); assert.equal(r.results[1].token.shortfall, "1");
  assert.equal(r.results[0].token.shortfall, "0"); assert.equal(r.results[2].token.shortfall, "0");
  data.budgets[1].token.spendUnits = "0";
  assert.deepEqual(evaluateSharedOperationBudget(data).reasons, ["ZERO_TOKEN_SPEND"]);
});
test("one unknown component makes the whole shared requirement unknown while preserving known insufficiency", () => {
  const data = input(); data.budgets[1].fees.operatorFeeBudgetWei = null;
  const r = evaluateSharedOperationBudget(data);
  assert.equal(r.native, null); assert.equal(r.plannedNativeCostWei, null); assert.equal(r.constraintsSatisfied, false);
  assert.deepEqual(r.unknownComponents, [{ agent: "EMA", component: "operatorFeeBudgetWei" }]);
  assert.ok(r.reasons.includes("SHARED_ETH_SHORTFALL")); assert.ok(BigInt(r.knownNativeMinimum.shortfall) > 0n);
});
test("mixed networks, duplicate tokens and inconsistent shared account assumptions are rejected", () => {
  for (const [change, code] of [
    [d => { d.budgets[1].chainId = 8453; }, "SHARED_NETWORK_MISMATCH"],
    [d => { d.budgets[1].agent = "DAT"; }, "DUPLICATE_AGENT"],
    ...["balanceWei", "reservedWei", "reserveFloorWei"].map(key => [d => { d.budgets[1].native[key] = "1"; }, "SHARED_BALANCE_MISMATCH"]),
    [d => { d.sameAccount = false; }, "SHARED_ACCOUNT_ASSUMPTION_REQUIRED"]]) {
    const data = input(); change(data); assert.throws(() => evaluateSharedOperationBudget(data), { code });
  }
});
test("combined totals reject uint256 overflow even when each separate operation fits", () => {
  const data = input(), half = (1n << 255n).toString();
  data.budgets.forEach(b => { b.native.valueWei = half; });
  assert.throws(() => evaluateSharedOperationBudget(data), { code: "AMOUNT_OVERFLOW" });
});
test("two plans are supported, one or four plans and sparse arrays are not", () => {
  const data = input(); data.budgets.pop(); assert.equal(evaluateSharedOperationBudget(data).results.length, 2);
  for (const change of [d => { d.budgets.length = 1; }, d => { d.budgets.push(d.budgets[0]); }, d => { delete d.budgets[1]; },
    d => { d.extra = true; }, d => { d.budgets.extra = true; }]) {
    const invalid = input(); change(invalid); assert.throws(() => validateSharedOperationBudget(invalid), { code: "INVALID_SHARED_STRUCTURE" });
  }
});
test("captures immutable data without invoking accessors, and round trips only inputs", () => {
  const data = input(), r = evaluateSharedOperationBudget(data); data.budgets[0].native.balanceWei = "0";
  assert.equal(r.input.budgets[0].native.balanceWei, "3060000000000000"); assert.ok(Object.isFrozen(r.input.budgets));
  let calls = 0; Object.defineProperty(data.budgets, "1", { get() { calls++; return null; } });
  assert.throws(() => validateSharedOperationBudget(data)); assert.equal(calls, 0);
  const text = encodeSharedOperationBudget(input()); assert.equal(encodeSharedOperationBudget(decodeSharedOperationBudget(text)), text);
  assert.throws(() => decodeSharedOperationBudget('{"sameAccount":true,"sameAccount":false}'), { code: "INVALID_JSON" });
  assert.throws(() => decodeSharedOperationBudget("\ufeff" + text), { code: "INVALID_JSON" });
  assert.throws(() => decodeSharedOperationBudget(" ".repeat(SHARED_BUDGET_LIMIT + 1)), { code: "FILE_TOO_LARGE" });
});
