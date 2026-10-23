import test from "node:test";
import assert from "node:assert/strict";
import { analyzePeriodReport } from "../src/period-report-engine.js";
import { reportInput, changedSlot, forkedInput, clone, context, plan, checkpoint,
  UNIT, ACCOUNT, OTHER, THIRD, AGENTS, ACCOUNTS, hash, record, event } from "./helpers/period-report-fixtures.js";

test("three exact historical balances agree independently", () => {
  const result = analyzePeriodReport(reportInput());
  assert.equal(result.status, "arithmetic-agreement");
  assert.equal(result.allArithmeticAgreement, true);
  assert.equal(result.sameChainAndPeriod, true);
  assert.equal(result.chainId, 84532);
  assert.equal(result.earlierBlock, "30");
  assert.equal(result.laterBlock, "42");
  assert.equal(result.eventCount, 6);
  assert.equal(result.combinesTokenValues, false);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.warnings, []);
  for (const slot of result.slots) {
    assert.equal(slot.arithmetic.totals.observedDeltaBaseUnits, (7n * UNIT).toString());
    assert.equal(slot.arithmetic.totals.residualBaseUnits, "0");
    assert.equal(slot.arithmetic.coverage.coveredBlocks, "12");
  }
});

test("agreement is not current-chain, completeness, profit or audit certification", () => {
  const result = analyzePeriodReport(reportInput());
  for (const key of ["liveChainRechecked", "completeHistory", "securityAudit", "provesProfit", "independentlyVerified"]) {
    assert.equal(result[key], false, key);
  }
  assert.equal(result.historicalOnly, true);
  assert.equal(result.eventCountsArePerToken, true);
  assert.ok(Object.isFrozen(result.slots[0].arithmetic.totals));
  assert.ok(Object.isFrozen(result.anchors.conflicts));
});

for (const chainId of [8453, 84532]) {
  for (const agent of AGENTS) {
    test(agent + " on chain " + chainId + " is not combined with another asset", () => {
      const result = analyzePeriodReport(reportInput({ chainId }));
      const slot = result.slots.find(row => row.agent === agent);
      assert.equal(slot.plan.context.chainId, chainId);
      assert.equal(slot.arithmetic.laterBalanceBaseUnits, (107n * UNIT).toString());
      assert.equal(slot.arithmetic.totals.symbol, agent);
    });
  }
}

for (const agent of AGENTS) {
  test(agent + " blocked evidence cannot become an agreement", () => {
    const result = analyzePeriodReport(reportInput({ changes: { [agent]: { requiresNewPlan: true } } }));
    assert.equal(result.slots.find(row => row.agent === agent).status, "requires-new-plan");
    assert.equal(result.status, "attention");
    assert.equal(result.allArithmeticAgreement, false);
    assert.ok(result.issues.includes("QUARANTINED_SOURCE"));
  });
  test(agent + " changed ending balance produces an exact residual", () => {
    const source = changedSlot(reportInput(), agent, entry => { entry.draft.later.balanceBaseUnits = (109n * UNIT).toString(); });
    const result = analyzePeriodReport(source), slot = result.slots.find(row => row.agent === agent);
    assert.equal(slot.status, "unexplained-difference");
    assert.equal(slot.arithmetic.totals.residualBaseUnits, (2n * UNIT).toString());
    assert.equal(result.status, "attention");
    assert.ok(result.issues.includes("UNEXPLAINED_DIFFERENCE"));
  });
  for (const count of [0, 1, 2, 3, 4]) {
    test(agent + " completed prefix " + count + " is explicitly partial", () => {
      const counts = AGENTS.map(value => value === agent ? count : 5);
      const result = analyzePeriodReport(reportInput({ counts }));
      const slot = result.slots.find(row => row.agent === agent);
      assert.equal(slot.status, "partial");
      assert.equal(slot.progress.completed, count);
      assert.equal(result.allArithmeticAgreement, false);
      assert.ok(result.issues.includes("INCOMPLETE_ACQUISITION"));
      if (count < 2) assert.equal(slot.arithmetic.totals, null);
    });
  }
}

test("missing records have unknown balances, never invented zeroes", () => {
  const result = analyzePeriodReport(reportInput({ selection: { DAT: null, EMA: null, CAWELON: "12345678-1234-4234-8234-000000000003" } }));
  assert.equal(result.selectedCount, 1);
  assert.equal(result.slots[0].status, "missing");
  assert.equal(result.slots[0].arithmetic.earlierBalanceBaseUnits, null);
  assert.equal(result.slots[0].arithmetic.totals, null);
  assert.equal(result.status, "incomplete");
});

test("different accounts are supported and reported independently", () => {
  const result = analyzePeriodReport(reportInput());
  assert.deepEqual(result.slots.map(row => row.plan.context.account), [ACCOUNT, OTHER, THIRD]);
  assert.deepEqual(result.sharedAccounts, []);
});

test("shared account is explicit without inventing distinct custody", () => {
  const draft = checkpoint(5, plan({}, context("EMA", 84532, ACCOUNT)));
  const result = analyzePeriodReport(reportInput({ changes: { EMA: { draft } } }));
  assert.equal(result.status, "arithmetic-agreement");
  assert.deepEqual(result.sharedAccounts, [{ agents: ["DAT", "EMA"], chainId: 84532, account: ACCOUNT }]);
  assert.ok(result.warnings.includes("SHARED_ACCOUNT"));
});

test("same address across chains does not imply one onchain account context", () => {
  const draft = checkpoint(5, plan({}, context("EMA", 8453, ACCOUNT)));
  const result = analyzePeriodReport(reportInput({ changes: { EMA: { draft } } }));
  assert.equal(result.sameChainAndPeriod, false);
  assert.equal(result.chainId, null);
  assert.deepEqual(result.sharedAccounts, []);
  assert.ok(result.issues.includes("DIFFERENT_CHAINS"));
});

test("identical block numbers on different chains are not hash conflicts", () => {
  const draft = checkpoint(5, plan({}, context("EMA", 8453, OTHER)));
  const source = forkedInput("EMA", reportInput({ changes: { EMA: { draft } } }));
  const result = analyzePeriodReport(source);
  assert.deepEqual(result.anchors.conflicts, []);
  assert.ok(!result.issues.includes("BLOCK_HASH_CONFLICT"));
  assert.ok(result.issues.includes("DIFFERENT_CHAINS"));
});

test("same chain hash conflicts invalidate all affected agents", () => {
  const result = analyzePeriodReport(forkedInput());
  assert.equal(result.status, "attention");
  assert.ok(result.anchors.conflicts.length > 0);
  assert.ok(result.anchors.comparedBlocks >= result.anchors.conflicts.length);
  assert.ok(result.slots.every(row => row.status === "anchor-conflict"));
  assert.ok(result.issues.includes("BLOCK_HASH_CONFLICT"));
  assert.equal(result.allArithmeticAgreement, false);
  assert.ok(result.slots.every(row => row.arithmetic.totals.residualBaseUnits === "0"));
});

test("matching intermediate event block hashes are also compared", () => {
  const result = analyzePeriodReport(reportInput());
  assert.ok(result.anchors.comparedBlocks >= 7);
  assert.deepEqual(result.anchors.conflicts, []);
});

test("a single intermediate fork is visible even if endpoints agree", () => {
  const source = changedSlot(reportInput(), "EMA", entry => {
    const row = entry.draft.records[1];
    row.events[0].blockHash = hash(999);
    row.toBlockHash = hash(999);
  });
  const result = analyzePeriodReport(source);
  assert.equal(result.anchors.conflicts.length, 1);
  assert.equal(result.anchors.conflicts[0].number, "40");
  assert.equal(result.status, "attention");
});

test("different ranges remain separate even when all per-token arithmetic agrees", () => {
  const draft = checkpoint(5, plan({ laterBlock: "43" }, context("EMA", 84532, OTHER)));
  const result = analyzePeriodReport(reportInput({ changes: { EMA: { draft } } }));
  assert.ok(result.slots.every(row => row.status === "arithmetic-agreement"));
  assert.equal(result.status, "incomplete");
  assert.equal(result.sameChainAndPeriod, false);
  assert.equal(result.laterBlock, null);
  assert.ok(result.issues.includes("DIFFERENT_PERIODS"));
});

test("different collection window sizes do not change the economic interval", () => {
  const draft = checkpoint(3, plan({ windowSize: 12 }, context("EMA", 84532, OTHER)));
  const result = analyzePeriodReport(reportInput({ changes: { EMA: { draft } } }));
  assert.equal(result.sameChainAndPeriod, true);
  assert.equal(result.status, "arithmetic-agreement");
});

test("archived source is a visible warning and retains its exact arithmetic", () => {
  const result = analyzePeriodReport(reportInput({ changes: { DAT: { archived: true } } }));
  assert.equal(result.status, "arithmetic-agreement");
  assert.ok(result.warnings.includes("ARCHIVED_SOURCE"));
  assert.equal(result.slots[0].archived, true);
});

test("large integer residuals retain units beyond Number precision", () => {
  const base = 90071992547409931234567890n;
  const source = changedSlot(reportInput(), "DAT", entry => {
    entry.draft.earlier.balanceBaseUnits = base.toString();
    entry.draft.later.balanceBaseUnits = (base + 7n * UNIT + 1n).toString();
  });
  const result = analyzePeriodReport(source);
  assert.equal(result.slots[0].arithmetic.totals.residualBaseUnits, "1");
  assert.equal(result.slots[0].arithmetic.totals.observedDeltaBaseUnits, (7n * UNIT + 1n).toString());
});

test("negative residual remains signed without Number rounding", () => {
  const source = changedSlot(reportInput(), "DAT", entry => { entry.draft.later.balanceBaseUnits = (107n * UNIT - 1n).toString(); });
  assert.equal(analyzePeriodReport(source).slots[0].arithmetic.totals.residualBaseUnits, "-1");
});

test("zero events and equal balances are a genuine arithmetic result, not missing data", () => {
  const source = changedSlot(reportInput(), "DAT", entry => {
    entry.draft.later.balanceBaseUnits = entry.draft.earlier.balanceBaseUnits;
    for (const row of entry.draft.records) row.events = [];
  });
  const slot = analyzePeriodReport(source).slots[0];
  assert.equal(slot.status, "arithmetic-agreement");
  assert.equal(slot.arithmetic.totals.eventCount, 0);
  assert.equal(slot.arithmetic.totals.residualBaseUnits, "0");
});

test("self transfer is counted once and has zero net effect", () => {
  const source = changedSlot(reportInput(), "DAT", entry => {
    const account = entry.draft.plan.context.account;
    const row = entry.draft.records[0].events[0];
    row.from = account; row.to = account;
    entry.draft.later.balanceBaseUnits = (97n * UNIT).toString();
  });
  const slot = analyzePeriodReport(source).slots[0];
  assert.equal(slot.status, "arithmetic-agreement");
  assert.equal(slot.arithmetic.totals.selfTransferCount, 1);
  assert.equal(slot.arithmetic.totals.eventCount, 2);
  assert.equal(slot.arithmetic.totals.netTransferBaseUnits, (-3n * UNIT).toString());
});

test("negative implied intermediate balance cannot be called an agreement", () => {
  const source = changedSlot(reportInput(), "DAT", entry => {
    const first = entry.draft.records[0].events[0], second = entry.draft.records[1].events[0];
    [first.from, first.to] = [first.to, first.from]; first.amountBaseUnits = (110n * UNIT).toString();
    [second.from, second.to] = [second.to, second.from]; second.amountBaseUnits = (117n * UNIT).toString();
  });
  const result = analyzePeriodReport(source);
  assert.equal(result.slots[0].arithmetic.totals.residualBaseUnits, "0");
  assert.equal(result.slots[0].status, "inconsistent-history");
  assert.equal(result.status, "attention");
});

test("analysis does not mutate evidence and is deterministic", () => {
  const input = clone(reportInput()), before = JSON.stringify(input);
  const first = analyzePeriodReport(input), second = analyzePeriodReport(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
});
