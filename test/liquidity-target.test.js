import test from "node:test";
import assert from "node:assert/strict";
import {
  assessLiquidityTargets, formatUsdcRaw,
  LiquidityTargetError, TARGET_USDC_PER_POOL, TARGET_USDC_RAW,
} from "../src/liquidity-target.js";

const DAT = "0x1111111111111111111111111111111111111111";
const EMA = "0x2222222222222222222222222222222222222222";
const CAWELON = "0x3333333333333333333333333333333333333333";

function pool(address, usdcReserveBaseUnits = "100000000", tokenReserveBaseUnits = "2000000000000000000000") {
  return {
    poolAddress: address,
    contractCodePresent: true,
    usdcReserveBaseUnits,
    tokenReserveBaseUnits,
    reserveTimestamp: "1789362833",
  };
}
function snapshot(overrides = {}) {
  return {
    chainId: 8453,
    classicFactoryOnly: true,
    readOnly: true,
    transactionsExecuted: false,
    checkedBlockNumber: "52852584",
    pools: {
      DAT: { volatile: pool(DAT) },
      EMA: { volatile: pool(EMA) },
      CAWELON: { volatile: pool(CAWELON) },
      ...overrides,
    },
  };
}
const fail = (code) =>
  (error) => error instanceof LiquidityTargetError && error.code === code;

test("the ThreeCore target is 5,000 USDC per pool using six USDC decimals", () => {
  assert.equal(TARGET_USDC_PER_POOL, 5000n);
  assert.equal(TARGET_USDC_RAW, 5_000_000_000n);
  assert.equal(formatUsdcRaw("100000000"), "100.000000");
  assert.equal(formatUsdcRaw(0n), "0.000000");
  assert.equal(formatUsdcRaw("1234567"), "1.234567");
});

test("all three pools at 100 USDC show 2% progress and 4,900 USDC individual gap", () => {
  const result = assessLiquidityTargets(snapshot());
  assert.equal(result.observedBlockNumber, "52852584");
  assert.equal(result.targetUsdcPerPool, "5000");
  assert.equal(result.totalTargetUsdc, "15000.000000");
  assert.equal(result.aggregateObservedUsdc, "300.000000");
  assert.equal(result.aggregateReserveGapUsdc, "14700.000000");
  assert.equal(result.verifiedPools, 3);
  assert.equal(result.totalPools, 3);
  for (const agent of ["DAT", "EMA", "CAWELON"]) {
    const item = result.pools[agent];
    assert.equal(item.status, "OBSERVED");
    assert.equal(item.observedUsdc, "100.000000");
    assert.equal(item.reserveGapUsdc, "4900.000000");
    assert.equal(item.progressPercent, "2.00");
    assert.equal(item.targetMet, false);
    assert.equal(item.proportionalAdditionalTokenRawIllustration,
      "98000000000000000000000");
  }
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.pools));
  assert.ok(Object.isFrozen(result.pools.DAT));
  assert.equal(result.fundsMoved, false);
  assert.equal(result.goalIsNotFundingAuthorization, true);
});

test("exactly 5,000 USDC counts as target met with no further shortfall", () => {
  const result = assessLiquidityTargets(snapshot({
    DAT: { volatile: pool(DAT, "5000000000") },
  }));
  assert.equal(result.pools.DAT.progressPercent, "100.00");
  assert.equal(result.pools.DAT.reserveGapUsdc, "0.000000");
  assert.equal(result.pools.DAT.targetMet, true);
});

test("one pool's excess reserves must not compensate for another pool's shortfall", () => {
  const result = assessLiquidityTargets(snapshot({
    DAT: { volatile: pool(DAT, "20000000000") },
    EMA: { volatile: pool(EMA, "0") },
    CAWELON: { volatile: pool(CAWELON, "5000000000") },
  }));
  assert.equal(result.pools.DAT.targetMet, true);
  assert.equal(result.pools.DAT.progressPercent, "400.00");
  assert.equal(result.pools.EMA.reserveGapUsdc, "5000.000000");
  assert.equal(result.pools.CAWELON.reserveGapUsdc, "0.000000");
  assert.equal(result.aggregateReserveGapUsdc, "5000.000000");
  assert.equal(result.aggregateObservedUsdc, "25000.000000");
});

test("zero USDC reserve is not enough to calculate a proportional token estimate", () => {
  const result = assessLiquidityTargets(snapshot({
    DAT: { volatile: pool(DAT, "0") },
  }));
  assert.equal(result.pools.DAT.observedUsdc, "0.000000");
  assert.equal(result.pools.DAT.progressPercent, "0.00");
  assert.equal(result.pools.DAT.proportionalAdditionalTokenRawIllustration, null);
});

test("missing or unverified pools must never be counted as zero reserve", () => {
  const result = assessLiquidityTargets(snapshot({
    EMA: { volatile: { poolAddress: null, contractCodePresent: false } },
  }));
  assert.equal(result.pools.EMA.status, "UNVERIFIED");
  assert.equal(result.pools.EMA.observedUsdc, null);
  assert.equal(result.pools.EMA.progressPercent, null);
  assert.equal(result.verifiedPools, 2);
  assert.equal(result.aggregateObservedUsdc, null);
  assert.equal(result.aggregateReserveGapUsdc, null);
});

test("rounding never hides a tiny reserve deficit", () => {
  const result = assessLiquidityTargets(snapshot({
    DAT: { volatile: pool(DAT, "4999999999") },
  }));
  assert.equal(result.pools.DAT.reserveGapUsdc, "0.000001");
  assert.equal(result.pools.DAT.targetMet, false);
  assert.equal(result.pools.DAT.progressPercent, "99.99");
});

test("token-side illustration uses raw ratio without assuming ERC-20 decimals", () => {
  const result = assessLiquidityTargets(snapshot({
    DAT: { volatile: pool(DAT, "100000000", "1") },
  }));
  assert.equal(result.pools.DAT.proportionalAdditionalTokenRawIllustration, "49");
  assert.match(result.caveat, /NOT the actual amount to deposit/);
});

test("invalid quantities, including negative and floating-point reserve inputs, fail closed", () => {
  for (const invalid of ["-1", "1.5", "01", "0x10", "", 100000000]) {
    assert.throws(() => assessLiquidityTargets(snapshot({
      DAT: { volatile: pool(DAT, invalid) },
    })), fail("INVALID_RESERVE"));
  }
  assert.throws(() => formatUsdcRaw(-1n), fail("INVALID_RESERVE"));
});

test("invalid reports do not generate a target progress claim", () => {
  for (const invalid of [
    null, {}, { ...snapshot(), chainId: 1 },
    { ...snapshot(), classicFactoryOnly: false },
    { ...snapshot(), readOnly: false },
    { ...snapshot(), transactionsExecuted: true },
    { ...snapshot(), checkedBlockNumber: "not-confirmed" },
  ]) {
    assert.throws(() => assessLiquidityTargets(invalid), fail("INVALID_REPORT"));
  }
  assert.throws(() => assessLiquidityTargets(snapshot({
    DAT: { stable: pool(DAT) },
  })), fail("INVALID_REPORT"));
});
