/**
 * ThreeCore liquidity depth target reporting.
 *
 * Public, read-only observations of Aerodrome Classic volatile pools.
 * Never initiates LP deposits, swaps, approvals, signing or wallet access.
 * The "gap" is an OBSERVED RESERVE SHORTFALL, not a required cash contribution.
 */
export const TARGET_USDC_PER_POOL = 5_000n;
export const USDC_DECIMALS = 6;
export const TARGET_USDC_RAW = TARGET_USDC_PER_POOL * 10n ** BigInt(USDC_DECIMALS);
export const TRACKED_TOKENS = Object.freeze(["DAT", "EMA", "CAWELON"]);

export class LiquidityTargetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LiquidityTargetError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new LiquidityTargetError(code, message);
}
function parseRaw(value, field) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    reject("INVALID_RESERVE", field + " must be a nonnegative decimal string of base units");
  }
  return BigInt(value);
}
export function formatUsdcRaw(value) {
  const units = typeof value === "bigint" ? value : parseRaw(value, "USDC");
  if (units < 0n) reject("INVALID_RESERVE", "USDC reserve cannot be negative");
  const dollars = units / 1_000_000n;
  const fraction = (units % 1_000_000n).toString().padStart(6, "0");
  return dollars.toString() + "." + fraction;
}

function percent2(reserveRaw) {
  const basisPoints = reserveRaw * 10_000n / TARGET_USDC_RAW;
  return (basisPoints / 100n).toString() + "." +
    (basisPoints % 100n).toString().padStart(2, "0");
}

/**
 * Convert inspectAerodromePools() output into exact-integer target progress.
 * No ERC-20 decimal assumption is made for each project's token reserve.
 */
export function assessLiquidityTargets(report) {
  if (!report || report.chainId !== 8453 || !report.classicFactoryOnly ||
      report.readOnly !== true || report.transactionsExecuted !== false ||
      !/^(0|[1-9][0-9]*)$/.test(report.checkedBlockNumber ?? "")) {
    reject("INVALID_REPORT", "Expected a read-only Base Mainnet Classic factory observation");
  }
  const byToken = {};
  let verifiedTotal = 0n;
  let verifiedGapTotal = 0n;
  let verifiedCount = 0;
  for (const agent of TRACKED_TOKENS) {
    const pool = report.pools?.[agent]?.volatile;
    if (!pool) reject("INVALID_REPORT", "Missing Classic volatile pool entry for " + agent);
    const verified = typeof pool.poolAddress === "string" &&
      /^0x[0-9a-fA-F]{40}$/.test(pool.poolAddress) &&
      pool.contractCodePresent === true &&
      pool.usdcReserveBaseUnits != null &&
      pool.tokenReserveBaseUnits != null;
    if (!verified) {
      byToken[agent] = Object.freeze({
        status: "UNVERIFIED",
        poolAddress: pool.poolAddress ?? null,
        targetUsdc: TARGET_USDC_PER_POOL.toString(),
        observedUsdc: null,
        observedUsdcRaw: null,
        reserveGapUsdc: null,
        reserveGapRaw: null,
        progressPercent: null,
        targetMet: null,
        proportionalAdditionalTokenRawIllustration: null,
      });
      continue;
    }

    const usdcRaw = parseRaw(pool.usdcReserveBaseUnits, agent + " USDC");
    const tokenRaw = parseRaw(pool.tokenReserveBaseUnits, agent + " token");
    const gap = usdcRaw >= TARGET_USDC_RAW ? 0n : TARGET_USDC_RAW - usdcRaw;

    // Ratio illustration only; not a quote or executable LP deposit amount.
    // If USDC reserve is zero, no meaningful ratio can be computed.
    const additionalTokenRaw = usdcRaw === 0n ? null :
      ((tokenRaw * gap + usdcRaw - 1n) / usdcRaw).toString();
    verifiedCount++;
    verifiedTotal += usdcRaw;
    verifiedGapTotal += gap;
    byToken[agent] = Object.freeze({
      status: "OBSERVED",
      poolAddress: pool.poolAddress.toLowerCase(),
      targetUsdc: TARGET_USDC_PER_POOL.toString(),
      observedUsdc: formatUsdcRaw(usdcRaw),
      observedUsdcRaw: usdcRaw.toString(),
      reserveGapUsdc: formatUsdcRaw(gap),
      reserveGapRaw: gap.toString(),
      progressPercent: percent2(usdcRaw),
      targetMet: usdcRaw >= TARGET_USDC_RAW,
      proportionalAdditionalTokenRawIllustration: additionalTokenRaw,
    });
  }
  const aggregateTarget = TARGET_USDC_RAW * BigInt(TRACKED_TOKENS.length);
  const remaining = verifiedGapTotal;
  return Object.freeze({
    observedBlockNumber: report.checkedBlockNumber,
    chainId: 8453,
    targetUsdcPerPool: TARGET_USDC_PER_POOL.toString(),
    totalTargetUsdc: formatUsdcRaw(aggregateTarget),
    aggregateObservedUsdc: verifiedCount === 3 ? formatUsdcRaw(verifiedTotal) : null,
    aggregateReserveGapUsdc: verifiedCount === 3 ? formatUsdcRaw(remaining) : null,
    verifiedPools: verifiedCount,
    totalPools: 3,
    pools: Object.freeze(byToken),
    readOnly: true,
    fundsMoved: false,
    goalIsNotFundingAuthorization: true,
    caveat: "Reserve gap is NOT the actual amount to deposit. Pool reserves change with trades and other LPs. Token-ratio illustration uses the observed pool ratio only; no price, wallet balance, slippage, fees or LP shares have been checked.",
  });
}
