import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodPlan, validatePeriodPlan, periodShape } from "../src/period-plan.js";
import { validatePeriodDraft, periodDraftProgress } from "../src/period-draft.js";
import { checkpoint, plan, context } from "./helpers/period-fixtures.js";
const ownOnly = value => new Proxy(value, { get() { throw Error("Unexpected live period read"); } });

test("period shape returns the captured immutable fields", () => {
  const value = { earlierBlock: "30", laterBlock: "42" };
  const result = periodShape(value, Object.keys(value));
  value.laterBlock = "100";
  assert.equal(result.laterBlock, "42"); assert(Object.isFrozen(result));
});
test("period plan endpoints and window size are captured before validation", () => {
  const input = { context: context(), earlierBlock: "30", laterBlock: "42", windowSize: 5 };
  assert.deepEqual(createPeriodPlan(ownOnly(input)), plan());
  assert.deepEqual(validatePeriodPlan(ownOnly(plan())), plan());
});
test("period draft captures its envelope and bounded completed prefix", () => {
  const input = checkpoint(3);
  assert.deepEqual(validatePeriodDraft(ownOnly({ ...input, plan: ownOnly(input.plan), records: ownOnly([...input.records]) })), input);
});
test("a custom map cannot silently remove a completed period window", () => {
  const input = checkpoint(3); let invoked = false;
  const records = [...input.records];
  records.map = () => { invoked = true; return []; };
  assert.throws(() => validatePeriodDraft({ ...input, records }), { code: "PERIOD_RECORDS" });
  assert.equal(invoked, false);
});
test("sparse period arrays cannot count absent windows as completed", () => {
  const input = checkpoint(5), records = [...input.records];
  delete records[1];
  assert.throws(() => periodDraftProgress({ ...input, records }), { code: "PERIOD_RECORDS" });
});
test("period record accessors are rejected without evaluating them", () => {
  const input = checkpoint(3), records = []; let invoked = false;
  Object.defineProperty(records, "0", { get() { invoked = true; return input.records[0]; }, enumerable: true });
  assert.throws(() => validatePeriodDraft({ ...input, records }), { code: "PERIOD_RECORDS" });
  assert.equal(invoked, false);
});
test("period records use own length instead of a later shrinking length", () => {
  const input = checkpoint(3); let reads = 0;
  const records = new Proxy([...input.records], { get(target, key, receiver) {
    return key === "length" ? ++reads <= 1 ? 1 : 0 : Reflect.get(target, key, receiver);
  } });
  assert.equal(periodDraftProgress({ ...input, records }).windowsCompleted, 1);
  assert.equal(reads, 0);
});
test("revoked period arrays produce a stable records error", () => {
  const input = checkpoint(3), { proxy, revoke } = Proxy.revocable([...input.records], {}); revoke();
  assert.throws(() => validatePeriodDraft({ ...input, records: proxy }), { code: "PERIOD_RECORDS" });
});
