import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodPlan, validatePeriodPlan, describePeriodPlan, periodPlanKey, periodWindows,
  periodContextKey, PERIOD_MAX_WINDOWS } from "../src/period-plan.js";
import { plan, context, ACCOUNT, OTHER, clone, code } from "./helpers/period-fixtures.js";

for (const agent of ["DAT", "EMA", "CAWELON"]) for (const chainId of [8453, 84532]) {
  test(`period plan pins ${agent} on ${chainId}`, () => {
    const value = plan({}, context(agent, chainId));
    assert.equal(value.context.agent, agent);
    assert.equal(value.context.chainId, chainId);
    assert.equal(value.context.account, ACCOUNT);
    assert.deepEqual(validatePeriodPlan(value), value);
    assert.equal(Object.isFrozen(value.context), true);
    assert.equal(Object.isFrozen(value), true);
  });
}

test("period windows cover (A,B] with the short final window retained", () => {
  assert.deepEqual(periodWindows(plan()), [
    { index: 0, fromBlock: "31", toBlock: "35", blocks: "5" },
    { index: 1, fromBlock: "36", toBlock: "40", blocks: "5" },
    { index: 2, fromBlock: "41", toBlock: "42", blocks: "2" },
  ]);
});

test("one-block period does not query the earlier balance block", () => {
  assert.deepEqual(periodWindows(plan({ earlierBlock: "0", laterBlock: "1", windowSize: 2000 })),
    [{ index: 0, fromBlock: "1", toBlock: "1", blocks: "1" }]);
});

test("maximum twelve 2,000-block windows are bounded without iteration over every block", () => {
  const value = plan({ earlierBlock: "0", laterBlock: "24000", windowSize: 2000 });
  const result = describePeriodPlan(value);
  assert.equal(result.windows.length, PERIOD_MAX_WINDOWS);
  assert.equal(result.steps, 14);
  assert.equal(result.blocks, "24000");
  assert.equal(result.automaticRetry, false);
  assert.equal(result.readOnly, true);
  assert.equal(result.windows.at(-1).toBlock, "24000");
});

test("block numbers above JavaScript precision remain exact", () => {
  const start = 900719925474099300000000n;
  const value = plan({ earlierBlock: start.toString(), laterBlock: (start + 12n).toString() });
  assert.equal(periodWindows(value)[0].fromBlock, (start + 1n).toString());
  assert.equal(periodWindows(value).at(-1).toBlock, (start + 12n).toString());
});

test("upper uint256 boundary remains expressible without overflow", () => {
  const upper = (1n << 256n) - 1n;
  const value = plan({ earlierBlock: (upper - 1n).toString(), laterBlock: upper.toString() });
  assert.equal(periodWindows(value)[0].toBlock, upper.toString());
});

for (const value of [null, undefined, 30, 30n, "", " 30", "30 ", "030", "+30", "-1", "0x1e", "3e1", "30.0", "１", "1\n", "9".repeat(79)]) {
  test("rejects noncanonical block: " + String(value), () => {
    assert.throws(() => plan({ earlierBlock: value }), code("PERIOD_BLOCK"));
  });
}

for (const windowSize of [0, -1, 2001, 1.1, NaN, Infinity, "1000", null]) {
  test("rejects unsafe window size: " + String(windowSize), () => {
    assert.throws(() => plan({ windowSize }), code("PERIOD_WINDOW_SIZE"));
  });
}

for (const [earlierBlock, laterBlock] of [["42", "42"], ["43", "42"], ["0", "0"]]) {
  test(`rejects reversed or empty period ${earlierBlock} ${laterBlock}`, () => {
    assert.throws(() => plan({ earlierBlock, laterBlock }), code("PERIOD_ORDER"));
  });
}

test("window limit is enforced after rounding up", () => {
  assert.throws(() => plan({ earlierBlock: "0", laterBlock: "24001", windowSize: 2000 }), code("PERIOD_WINDOW_LIMIT"));
  assert.throws(() => plan({ earlierBlock: "0", laterBlock: "13", windowSize: 1 }), code("PERIOD_WINDOW_LIMIT"));
});

for (const patch of [{ agent: "DOT" }, { chainId: 1 }, { account: "0x123" }, { account: "0x" + "0".repeat(40) }]) {
  test("invalid context rejected before planning: " + JSON.stringify(patch), () => {
    assert.throws(() => plan({}, { ...context(), ...patch }), code("PERIOD_CONTEXT"));
  });
}

test("unknown fields and getters cannot smuggle an alternate request", () => {
  assert.throws(() => createPeriodPlan({ ...plan(), malicious: true }), code("PERIOD_SHAPE"));
  const input = clone(plan());
  Object.defineProperty(input, "laterBlock", { get() { throw Error("must not run"); } });
  assert.throws(() => validatePeriodPlan(input), code("PERIOD_SHAPE"));
});

test("validating schema cannot silently migrate a future file", () => {
  assert.throws(() => validatePeriodPlan({ ...plan(), schema: "v2" }), code("PERIOD_PLAN_SCHEMA"));
  assert.throws(() => validatePeriodPlan([]), code("PERIOD_SHAPE"));
  assert.throws(() => validatePeriodPlan(null), code("PERIOD_SHAPE"));
});

test("context/plan fingerprints include every selection and range field", () => {
  const original = periodPlanKey(plan());
  for (const value of [plan({ earlierBlock: "31" }), plan({ laterBlock: "43" }), plan({ windowSize: 6 }),
    plan({}, context("EMA")), plan({}, context("DAT", 84532)), plan({}, context("DAT", 8453, OTHER))]) {
    assert.notEqual(periodPlanKey(value), original);
  }
  assert.notEqual(periodContextKey(context()), periodContextKey(context("EMA")));
});

test("planner matches an independent small-range partition oracle", () => {
  for (let start = 0; start < 20; start++) for (let size = 1; size <= 10; size++) {
    const end = start + size * 3 - 1;
    const windows = periodWindows(plan({ earlierBlock: String(start), laterBlock: String(end), windowSize: size }));
    const actual = windows.flatMap(row => Array.from({ length: Number(row.blocks) }, (_, index) => Number(row.fromBlock) + index));
    assert.deepEqual(actual, Array.from({ length: end - start }, (_, index) => start + index + 1));
    assert.equal(new Set(actual).size, actual.length);
  }
});

test("validated plans are detached from caller mutation", () => {
  const source = clone(plan());
  const value = validatePeriodPlan(source);
  source.context.account = OTHER;
  source.earlierBlock = "0";
  assert.equal(value.context.account, ACCOUNT);
  assert.equal(value.earlierBlock, "30");
  assert.equal(Object.isFrozen(periodWindows(value)[0]), true);
});
