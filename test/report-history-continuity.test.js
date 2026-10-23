import test from "node:test";
import assert from "node:assert/strict";
import { inspectReportContinuity, reportContinuityText } from "../src/report-history-continuity.js";
import { validatePeriodReportInput } from "../src/period-report-model.js";
import { reportInput, clone, changedSlot, forkedInput } from "./helpers/report-history-fixtures.js";
import { hash, UNIT } from "./helpers/period-report-fixtures.js";

/** Move a complete synthetic acquisition to another interval, including every block anchor. */
function shifted(input = reportInput(), blocks = 12n, balance = 7n * UNIT) {
  const result = clone(input);
  result.title = "後の期間";
  for (const slot of result.slots) {
    if (!slot.entry) continue;
    const draft = slot.entry.draft;
    draft.plan.earlierBlock = (BigInt(draft.plan.earlierBlock) + blocks).toString();
    draft.plan.laterBlock = (BigInt(draft.plan.laterBlock) + blocks).toString();
    for (const endpoint of [draft.earlier, draft.later]) {
      if (!endpoint) continue;
      endpoint.blockNumber = (BigInt(endpoint.blockNumber) + blocks).toString();
      endpoint.blockHash = hash(endpoint.blockNumber);
      if (endpoint.balanceBaseUnits !== null) endpoint.balanceBaseUnits = (BigInt(endpoint.balanceBaseUnits) + balance).toString();
    }
    for (const record of draft.records) {
      record.range.fromBlock = (BigInt(record.range.fromBlock) + blocks).toString();
      record.range.toBlock = (BigInt(record.range.toBlock) + blocks).toString();
      record.fromBlockHash = hash(record.range.fromBlock);
      record.toBlockHash = hash(record.range.toBlock);
      for (const event of record.events) {
        event.blockNumber = (BigInt(event.blockNumber) + blocks).toString();
        event.blockHash = hash(event.blockNumber);
        event.transactionHash = hash(BigInt(event.transactionHash) + blocks + 10000n);
      }
    }
  }
  return validatePeriodReportInput(result);
}

test("adjacent complete periods have matching boundary balances and hashes for all three tokens", () => {
  const before = reportInput(), after = shifted(before);
  const result = inspectReportContinuity(before, after);
  assert.equal(result.allContinuous, true);
  assert.deepEqual(result.slots.map(row => row.status), ["continuous", "continuous", "continuous"]);
  assert.equal(result.slots[0].boundaryBlock, "42");
  assert.equal(result.slots[0].beforeBoundaryBalance, (107n * UNIT).toString());
  assert.equal(result.slots[0].afterBoundaryBalance, (107n * UNIT).toString());
  assert.equal(result.slots[0].boundaryBalanceDifference, "0");
  assert.equal(result.tokenAmountsSummed, false);
  assert.equal(result.eventCountsMerged, false);
});
test("same period is a replacement comparison, not a continuation", () => {
  const result = inspectReportContinuity(reportInput(), reportInput({ title: "renamed" }));
  assert.equal(result.allContinuous, false);
  assert.equal(result.slots[0].status, "same-period");
  assert.equal(result.slots[0].adjacent, false);
  assert.equal(result.slots[0].boundaryBalanceDifference, null);
});
for (const [offset, gap] of [[13n, "1"], [20n, "8"], [1000n, "988"]]) {
  test("gap block count follows end-exclusive start convention at offset " + offset, () => {
    const result = inspectReportContinuity(reportInput(), shifted(reportInput(), offset));
    assert.equal(result.slots[0].status, "gap"); assert.equal(result.slots[0].gapBlocks, gap);
    assert.equal(result.slots[0].boundaryBalanceDifference, null); assert.equal(result.allContinuous, false);
  });
}
for (const [offset, overlap] of [[1n, "11"], [5n, "7"], [11n, "1"]]) {
  test("overlap is detected without double-counting events at offset " + offset, () => {
    const result = inspectReportContinuity(reportInput(), shifted(reportInput(), offset));
    assert.equal(result.slots[0].status, "overlap"); assert.equal(result.slots[0].overlapBlocks, overlap);
    assert.equal(result.eventCountsMerged, false); assert.equal(result.slots[0].boundaryBalanceDifference, null);
  });
}
test("reverse selected order is explicit and never silently reordered", () => {
  const early = reportInput(), late = shifted(early);
  const result = inspectReportContinuity(late, early);
  assert.equal(result.slots[0].status, "reversed"); assert.equal(result.beforeTitle, late.title);
  assert.equal(result.afterTitle, early.title); assert.equal(result.allContinuous, false);
});
test("report creation timestamps do not override block-period ordering", () => {
  const early = { ...reportInput(), createdAt: "2027-01-01T00:00:00.000Z" };
  const late = { ...shifted(), createdAt: "2025-01-01T00:00:00.000Z" };
  assert.equal(inspectReportContinuity(early, late).allContinuous, true);
});
test("different chains with equal boundary block numbers are not linked", () => {
  const after = shifted(reportInput({ chainId: 8453 }));
  const result = inspectReportContinuity(reportInput(), after);
  assert.equal(result.slots[0].status, "different-context"); assert.equal(result.slots[0].sameContext, false);
  assert.equal(result.slots[0].boundaryBalanceDifference, null);
});
for (const agent of ["DAT", "EMA", "CAWELON"]) {
  test("missing " + agent + " cannot produce whole-report continuity", () => {
    const after = changedSlot(shifted(), agent, (_entry, slot) => { slot.entry = null; });
    const result = inspectReportContinuity(reportInput(), after);
    assert.equal(result.slots.find(row => row.agent === agent).status, "missing");
    assert.equal(result.allContinuous, false);
  });
  test("boundary conflict in " + agent + " is not masked by agreement in other tokens", () => {
    const result = inspectReportContinuity(reportInput(), forkedInput(agent, shifted()));
    const slot = result.slots.find(row => row.agent === agent);
    assert.equal(slot.status, "boundary-conflict"); assert.ok(slot.issues.includes("BOUNDARY_HASH"));
    assert.equal(slot.boundaryBalanceDifference, null); assert.equal(result.allContinuous, false);
  });
  test("new quarantine in " + agent + " preserves adjacency but blocks confidence", () => {
    const after = changedSlot(shifted(), agent, entry => { entry.requiresNewPlan = true; });
    const result = inspectReportContinuity(reportInput(), after), slot = result.slots.find(row => row.agent === agent);
    assert.equal(slot.adjacent, true); assert.equal(slot.continuousEvidence, false);
    assert.ok(slot.issues.includes("RESTRICTED")); assert.equal(result.allContinuous, false);
  });
}
test("matching boundary hash with different saved balance reports exact discrepancy", () => {
  const after = shifted(reportInput(), 12n, 8n * UNIT);
  const result = inspectReportContinuity(reportInput(), after);
  assert.equal(result.slots[0].status, "boundary-conflict");
  assert.equal(result.slots[0].boundaryBalanceDifference, UNIT.toString());
  assert.ok(result.slots[0].issues.includes("BOUNDARY_BALANCE"));
  assert.equal(result.allContinuous, false);
});
test("negative boundary discrepancy is preserved as an exact integer", () => {
  const result = inspectReportContinuity(reportInput(), shifted(reportInput(), 12n, 6n * UNIT));
  assert.equal(result.slots[0].boundaryBalanceDifference, (-UNIT).toString());
});
test("partial collection can share a valid boundary without being reported complete", () => {
  const after = shifted(reportInput({ counts: [3, 5, 5] }));
  const result = inspectReportContinuity(reportInput(), after);
  assert.equal(result.slots[0].status, "incomplete-evidence");
  assert.ok(result.slots[0].issues.includes("AFTER_NOT_RECONCILED")); assert.equal(result.allContinuous, false);
});
test("missing ending boundary and starting boundary are explicit unknowns", () => {
  const result = inspectReportContinuity(reportInput({ counts: [1, 5, 5] }), shifted(reportInput({ counts: [0, 5, 5] })));
  assert.equal(result.slots[0].status, "incomplete-evidence");
  assert.ok(result.slots[0].issues.includes("MISSING_BOUNDARY"));
  assert.equal(result.slots[0].beforeBoundaryBalance, null);
  assert.equal(result.slots[0].afterBoundaryBalance, null);
});
test("zero boundary balance is not mistaken for missing data", () => {
  const before = shifted(reportInput(), 0n, -100n * UNIT);
  // The first period finishes at 7; shift the following period to start at 7.
  const after = shifted(reportInput(), 12n, -93n * UNIT);
  const result = inspectReportContinuity(before, after);
  assert.equal(result.allContinuous, true); assert.equal(result.slots[0].beforeBoundaryBalance, (7n * UNIT).toString());
  const zeroAfter = shifted(reportInput(), 12n, -100n * UNIT);
  const mismatch = inspectReportContinuity(before, zeroAfter);
  assert.equal(mismatch.slots[0].afterBoundaryBalance, "0");
  assert.ok(!mismatch.slots[0].issues.includes("UNKNOWN_BALANCE"));
});
test("very large block numbers remain exact and are never coerced to floating point", () => {
  const offset = 9007199254740993n;
  const before = shifted(reportInput(), offset, 0n), after = shifted(before, 12n, 7n * UNIT);
  const result = inspectReportContinuity(before, after);
  assert.equal(result.slots[0].boundaryBlock, (offset + 42n).toString());
  assert.equal(result.allContinuous, true);
});
test("continuity is deeply immutable and neither input is mutated", () => {
  const before = reportInput(), after = shifted(), original = JSON.stringify([before, after]);
  const result = inspectReportContinuity(before, after);
  assert.ok(Object.isFrozen(result.slots[0].issues));
  assert.equal(JSON.stringify([before, after]), original);
  assert.equal(result.liveChainRechecked, false); assert.equal(result.independentlyVerified, false);
});
test("continuity text explains range conventions and makes no profit claim", () => {
  const text = reportContinuityText(inspectReportContinuity(reportInput(), shifted()));
  assert.match(text, /翌ブロック/); assert.match(text, /利益の証明ではありません/);
  assert.match(text, /境界ブロック: 42/); assert.equal(reportContinuityText(null), "");
});
test("continuity validates its inputs before rendering or integer arithmetic", () => {
  assert.throws(() => inspectReportContinuity(null, shifted()));
  assert.throws(() => inspectReportContinuity(reportInput(), { ...shifted(), trusted: true }));
});
