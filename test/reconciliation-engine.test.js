import test from "node:test";
import assert from "node:assert/strict";
import { reconcileWorkspace, reconciliationCoverage, formatReconciliationAmount } from "../src/reconciliation-engine.js";
import { RECONCILIATION_AGENTS } from "../src/reconciliation-model.js";
import { ZERO_ADDRESS } from "../src/transfer-codec.js";
import { UNIT, ACCOUNT, OTHER, THIRD, scenario, workspace, clone, context, observation, record, archive, event, hash, errorCode } from "./helpers/reconciliation-fixtures.js";

const result = slot => reconcileWorkspace(workspace([slot])).slots.find(row => row.agent === slot.agent);

for (const agent of RECONCILIATION_AGENTS) {
  for (const chain of [8453, 84532]) test(`${agent}/${chain}: observed delta reconciles with exact transfer net`, () => {
    const input = scenario(agent, {}, chain);
    const row = result(input);
    assert.equal(row.status, "arithmetic-agreement");
    assert.equal(row.totals.observedDeltaBaseUnits, (7n * UNIT).toString());
    assert.equal(row.totals.incomingBaseUnits, (10n * UNIT).toString());
    assert.equal(row.totals.outgoingBaseUnits, (3n * UNIT).toString());
    assert.equal(row.totals.residualBaseUnits, "0");
    assert.equal(row.coverage.expectedBlocks, "12");
    assert.equal(row.coverage.coveredBlocks, "12");
    assert.equal(row.anchors.earlier.status, "agrees");
    assert.equal(row.anchors.later.status, "agrees");
    assert.deepEqual(row.issues, []);
    assert.deepEqual(row.warnings, []);
    assert.ok(Object.isFrozen(row.events[0]));
    assert.equal(row.independentlyVerified, false);
    assert.equal(row.provesProfit, false);
  });
}

for (const residual of [-1n, 1n, 2n * UNIT, -3n * UNIT]) test("residual preserves exact signed difference " + residual, () => {
  const slot = scenario();
  slot.later.balanceBaseUnits = (107n * UNIT + residual).toString();
  const row = result(slot);
  assert.equal(row.status, "unexplained-difference");
  assert.equal(row.totals.residualBaseUnits, residual.toString());
});

for (const part of ["earlier", "later"]) test("missing " + part + " is not zero balance", () => {
  const row = result(scenario("DAT", { [part]: null }));
  assert.equal(row.status, "missing-input");
  assert.equal(row.totals, null);
  assert.equal(row.coverage, null);
  assert.ok(row.issues.includes(part.toUpperCase() + "_MISSING"));
});

test("missing archive retains numeric difference but reports incomplete evidence", () => {
  const row = result(scenario("DAT", { archive: null }));
  assert.equal(row.status, "incomplete-history");
  assert.equal(row.coverage.missingBlocks, "12");
  assert.equal(row.totals.netTransferBaseUnits, "0");
  assert.equal(row.totals.residualBaseUnits, (7n * UNIT).toString());
  assert.ok(row.warnings.includes("ARCHIVE_MISSING"));
});

test("zero residual with gaps never becomes arithmetic agreement", () => {
  const slot = scenario();
  slot.archive = archive([record(35, 40, slot.archive.records[0].events)]);
  const row = result(slot);
  assert.equal(row.totals.residualBaseUnits, "0");
  assert.equal(row.status, "incomplete-history");
  assert.deepEqual(row.coverage.gaps, [{ fromBlock: "31", toBlock: "34" }, { fromBlock: "41", toBlock: "42" }]);
  assert.equal(row.anchors.earlier.status, "unchecked");
});

test("no-change same-block evidence needs no interval and no archive", () => {
  const slot = scenario();
  slot.later = clone(slot.earlier);
  slot.archive = null;
  const row = result(slot);
  assert.equal(row.status, "arithmetic-agreement");
  assert.equal(row.coverage.expectedBlocks, "0");
  assert.deepEqual(row.events, []);
  assert.equal(row.totals.residualBaseUnits, "0");
  assert.equal(row.completeHistory, false);
});

const conflictCases = [
  ["OBSERVATION_CONTEXT_CONFLICT", slot => { slot.later.account = OTHER; }],
  ["OBSERVATION_CONTEXT_CONFLICT", slot => { slot.later = observation({}, context("DAT", 84532)); }],
  ["BLOCK_ORDER_CONFLICT", slot => { slot.earlier.blockNumber = "43"; }],
  ["EARLIER_METADATA_UNUSABLE", slot => { slot.earlier.metadata.symbol = "FAKE"; }],
  ["LATER_METADATA_UNUSABLE", slot => { slot.later.hasCode = false; slot.later.metadata = null; slot.later.balanceBaseUnits = null; }],
  ["SAME_BLOCK_HASH_CONFLICT", slot => { slot.later = { ...slot.earlier, blockHash: hash(300) }; }],
  ["SAME_BLOCK_STATE_CONFLICT", slot => { slot.later = { ...slot.earlier, balanceBaseUnits: "1" }; }],
  ["SAME_BLOCK_STATE_CONFLICT", slot => { slot.later = { ...slot.earlier, nativeBalanceBaseUnits: "1" }; }],
  ["ARCHIVE_CONTEXT_CONFLICT", slot => { slot.archive = scenario("DAT", {}, 8453, OTHER).archive; }],
  ["ARCHIVE_CONTEXT_CONFLICT", slot => { slot.archive = scenario("DAT", {}, 84532).archive; }],
  ["ARCHIVE_ANCHOR_CONFLICT", slot => { slot.earlier.blockHash = hash(3000); }],
  ["ARCHIVE_ANCHOR_CONFLICT", slot => { slot.later.blockHash = hash(4200); }],
];
for (const [issue, mutate] of conflictCases) test("blocks comparison: " + issue + " " + String(mutate), () => {
  const slot = clone(scenario());
  mutate(slot);
  const row = result(slot);
  assert.equal(row.status, "not-comparable");
  assert.ok(row.issues.includes(issue), JSON.stringify(row.issues));
  assert.equal(row.totals, null);
  assert.deepEqual(row.events, []);
});

test("different local origins and epochs are disclosed, not rewritten", () => {
  const slot = scenario();
  slot.later.siteOrigin = "http://127.0.0.1:4188";
  slot.later.connectionEpoch = 7;
  const row = result(slot);
  assert.equal(row.status, "arithmetic-agreement");
  assert.ok(row.warnings.includes("DIFFERENT_OBSERVATION_ORIGINS"));
  assert.ok(row.warnings.includes("DIFFERENT_CONNECTION_EPOCHS"));
  assert.equal(row.origins.later, "http://127.0.0.1:4188");
});

test("interval is earlier-exclusive and later-inclusive, including endpoint events", () => {
  const slot = scenario();
  slot.archive = archive([record(29, 43, [
    event({ blockNumber: "30", blockHash: hash(30), amountBaseUnits: "100" }, 0),
    event({ blockNumber: "31", blockHash: hash(31), amountBaseUnits: "1" }, 1),
    event({ blockNumber: "42", blockHash: hash(42), amountBaseUnits: "2" }, 2),
    event({ blockNumber: "43", blockHash: hash(43), amountBaseUnits: "1000" }, 3),
  ])]);
  slot.later.balanceBaseUnits = (100n * UNIT + 3n).toString();
  const row = result(slot);
  assert.equal(row.status, "arithmetic-agreement");
  assert.equal(row.totals.netTransferBaseUnits, "3");
  assert.deepEqual(row.events.map(e => e.blockNumber), ["31", "42"]);
  assert.equal(row.excludedEvents, 2);
});

test("overlapping archive records count shared events once", () => {
  const slot = scenario();
  const rows = slot.archive.records[0].events;
  slot.archive = archive([record(30, 40, rows), record(35, 42, rows)]);
  const row = result(slot);
  assert.equal(row.status, "arithmetic-agreement");
  assert.equal(row.archiveRecords, 2);
  assert.equal(row.totals.eventCount, 2);
  assert.equal(row.coverage.coveredBlocks, "12");
});

test("mint, burn, self and zero value events retain their meaning", () => {
  const slot = scenario();
  const rows = [
    event({ from: ZERO_ADDRESS, to: ACCOUNT, amountBaseUnits: "8" }, 0),
    event({ from: ACCOUNT, to: ZERO_ADDRESS, amountBaseUnits: "3" }, 1),
    event({ from: ACCOUNT, to: ACCOUNT, amountBaseUnits: "999" }, 2),
    event({ from: OTHER, to: ACCOUNT, amountBaseUnits: "0" }, 3),
  ];
  slot.archive = archive([record(30, 42, rows)]);
  slot.later.balanceBaseUnits = (100n * UNIT + 5n).toString();
  const row = result(slot);
  assert.equal(row.status, "arithmetic-agreement");
  assert.deepEqual(row.events.map(e => e.direction), ["mint", "burn", "self", "incoming"]);
  assert.deepEqual(row.events.map(e => e.deltaBaseUnits), ["8", "-3", "0", "0"]);
  assert.equal(row.totals.incomingBaseUnits, "1007");
  assert.equal(row.totals.outgoingBaseUnits, "1002");
  assert.equal(row.totals.selfTransferCount, 1);
  assert.equal(row.totals.zeroValueCount, 1);
});

test("negative intermediate balance cannot pass even with final zero residual", () => {
  const slot = scenario();
  slot.earlier.balanceBaseUnits = "0";
  slot.later.balanceBaseUnits = "0";
  slot.archive = archive([record(30, 42, [
    event({ from: ACCOUNT, to: OTHER, amountBaseUnits: "10" }, 0),
    event({ from: OTHER, to: ACCOUNT, amountBaseUnits: "10" }, 1),
  ])]);
  const row = result(slot);
  assert.equal(row.status, "inconsistent-history");
  assert.equal(row.totals.residualBaseUnits, "0");
  assert.equal(row.events[0].impliedBalanceBaseUnits, "-10");
  assert.ok(row.warnings.includes("NEGATIVE_IMPLIED_BALANCE"));
});

test("three account contexts remain separate and are never portfolio-summed", () => {
  const value = workspace([
    scenario("DAT", {}, 8453, ACCOUNT), scenario("EMA", {}, 84532, OTHER), scenario("CAWELON", {}, 8453, THIRD),
  ]);
  const report = reconcileWorkspace(value);
  assert.deepEqual(report.slots.map(row => row.account), [ACCOUNT, OTHER, THIRD]);
  assert.ok(report.slots.every(row => row.status === "arithmetic-agreement"));
  assert.equal("total" in report, false);
  assert.equal("portfolioValue" in report, false);
});

test("event totals can exceed uint256 without rounding or overflow", () => {
  const huge = (1n << 256n) - 1n;
  const slot = scenario();
  slot.archive = archive([record(30, 42, Array.from({ length: 500 }, (_, index) =>
    event({ from: ACCOUNT, to: ACCOUNT, amountBaseUnits: huge.toString() }, index)))]);
  slot.later.balanceBaseUnits = slot.earlier.balanceBaseUnits;
  const row = result(slot);
  assert.equal(row.status, "inconsistent-history");
  assert.ok(row.warnings.includes("SELF_TRANSFER_EXCEEDS_BALANCE"));
  assert.equal(row.totals.incomingBaseUnits, (500n * huge).toString());
  assert.equal(row.totals.netTransferBaseUnits, "0");
  assert.ok(formatReconciliationAmount(row.totals.incomingBaseUnits).length > 60);
});

for (const [value, decimals, expected] of [
  ["0", 18, "0"], ["1", 18, "0.000000000000000001"], ["-1", 18, "-0.000000000000000001"],
  ["123400", 4, "12.34"], ["-123400", 4, "-12.34"], ["10", 0, "10"],
  ["1", 255, "0." + "0".repeat(254) + "1"], ["9".repeat(84), 0, "9".repeat(84)],
]) test(`exact display ${value.slice(0, 20)} / ${decimals}`, () => {
  assert.equal(formatReconciliationAmount(value, decimals), expected);
});

for (const value of ["-0", "+1", "01", "1e18", "1.1", " 1", "", 1, null, "9".repeat(85)]) {
  test("reject noncanonical reconciliation amount " + String(value).slice(0, 12), () => {
    assert.throws(() => formatReconciliationAmount(value), errorCode("RECONCILIATION_AMOUNT"));
  });
}

for (const decimals of [-1, 256, 1.1, "18", null]) test("reject invalid decimals " + decimals, () => {
  assert.throws(() => formatReconciliationAmount("1", decimals), errorCode("RECONCILIATION_AMOUNT"));
});

const range = (from, to) => ({ fromBlock: String(from), toBlock: String(to) });
for (const [label, ranges, covered, gaps] of [
  ["none", [], "0", [range(11, 20)]],
  ["exact", [range(11, 20)], "10", []],
  ["wider", [range(0, 100)], "10", []],
  ["left", [range(1, 12)], "2", [range(13, 20)]],
  ["right", [range(19, 30)], "2", [range(11, 18)]],
  ["outside", [range(0, 10), range(21, 30)], "0", [range(11, 20)]],
  ["overlap", [range(11, 17), range(14, 20)], "10", []],
  ["adjacent", [range(11, 14), range(15, 20)], "10", []],
  ["internal gap", [range(11, 13), range(17, 20)], "7", [range(14, 16)]],
  ["nested", [range(12, 13), range(11, 20)], "10", []],
  ["unordered", [range(17, 20), range(11, 13)], "7", [range(14, 16)]],
]) test("coverage interval union: " + label, () => {
  const value = reconciliationCoverage("10", "20", ranges);
  assert.equal(value.coveredBlocks, covered);
  assert.deepEqual(value.gaps, gaps);
  assert.equal(value.missingBlocks, (10n - BigInt(covered)).toString());
  assert.equal(value.provesCompleteHistory, false);
});

test("coverage handles uint256 range end without enumerating blocks", () => {
  const maximum = (1n << 256n) - 1n;
  const value = reconciliationCoverage("0", maximum.toString(), [range(maximum - 1n, maximum)]);
  assert.equal(value.coveredBlocks, "2");
  assert.equal(value.missingBlocks, (maximum - 2n).toString());
  const empty = reconciliationCoverage(maximum.toString(), maximum.toString(), []);
  assert.equal(empty.expectedBlocks, "0");
  assert.deepEqual(empty.gaps, []);
});

test("coverage rejects reversed bounds and excessive ranges", () => {
  assert.throws(() => reconciliationCoverage("20", "10", []), errorCode("RECONCILIATION_ORDER"));
  assert.throws(() => reconciliationCoverage("10", "20", [range(5, 1)]), errorCode("RECONCILIATION_ORDER"));
  assert.throws(() => reconciliationCoverage("10", "20", Array(13).fill(range(10, 20))), errorCode("RECONCILIATION_RANGES"));
});

test("small-range exhaustive coverage agrees with a separate set oracle", () => {
  for (let a = 0; a <= 8; a++) for (let b = a; b <= 8; b++) {
    for (let c = 0; c <= 8; c++) for (let d = c; d <= 8; d++) {
      const oracle = new Set();
      for (let block = 3; block <= 7; block++) if ((block >= a && block <= b) || (block >= c && block <= d)) oracle.add(block);
      const value = reconciliationCoverage("2", "7", [range(a, b), range(c, d)]);
      assert.equal(value.coveredBlocks, String(oracle.size));
      const omitted = value.gaps.flatMap(gap => Array.from({ length: Number(BigInt(gap.toBlock) - BigInt(gap.fromBlock) + 1n) }, (_, i) => Number(gap.fromBlock) + i));
      assert.deepEqual(omitted, [3, 4, 5, 6, 7].filter(block => !oracle.has(block)));
    }
  }
});
