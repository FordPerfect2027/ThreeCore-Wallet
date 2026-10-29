/**
 * ThreeCore liquidity depth target reporting.
 *
 * Public, read-only observations of Aerodrome Classic volatile pools.
 * Never initiates LP deposits, swaps, approvals, signing or wallet access.
 * The "gap" is an OBSERVED RESERVE SHORTFALL, not a required cash contribution.
 */
import { AERODROME_BASE } from "./aerodrome-readonly.js";
import { BASE_NATIVE_USDC } from "./aerodrome-pools.js";

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
const MAX_UINT256 = (1n << 256n) - 1n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = "0x" + "0".repeat(40);
function decimal(value, maximum = MAX_UINT256) {
  return typeof value === "string" && value.length <= maximum.toString().length &&
    /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= maximum;
}
function sameAddress(value, expected) {
  return typeof value === "string" && ADDRESS.test(value) && value.toLowerCase() === expected;
}
function parseRaw(value, field, maximum = MAX_UINT256) {
  if (!decimal(value, maximum)) {
    reject("INVALID_RESERVE", field + " must be a nonnegative decimal string of base units");
  }
  return BigInt(value);
}
export function formatUsdcRaw(value) {
  // Three uint256 pool reserves can sum above uint256 without being invalid.
  const maximum = MAX_UINT256 * BigInt(TRACKED_TOKENS.length);
  const units = typeof value === "bigint" ? value : parseRaw(value, "USDC", maximum);
  if (units < 0n || units > maximum) reject("INVALID_RESERVE", "USDC amount is outside the supported range");
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
  if (!report || report.chainId !== 8453 || report.classicFactoryOnly !== true ||
      report.readOnly !== true || report.transactionsExecuted !== false ||
      report.walletConnected !== false ||
      !sameAddress(report.factoryAddress, AERODROME_BASE.poolFactory) ||
      !sameAddress(report.quoteTokenAddress, BASE_NATIVE_USDC) ||
      !decimal(report.checkedBlockNumber)) {
    reject("INVALID_REPORT", "Expected a read-only Base Mainnet Classic factory observation");
  }
  const byToken = {};
  let verifiedTotal = 0n;
  let verifiedGapTotal = 0n;
  let verifiedCount = 0;
  const seenPools = new Set();
  for (const agent of TRACKED_TOKENS) {
    const pool = report.pools?.[agent]?.volatile;
    if (!pool || typeof pool !== "object" || Array.isArray(pool))
      reject("INVALID_REPORT", "Missing Classic volatile pool entry for " + agent);
    const validAddress = typeof pool.poolAddress === "string" && ADDRESS.test(pool.poolAddress) &&
      pool.poolAddress.toLowerCase() !== ZERO_ADDRESS;
    if ((pool.poolAddress !== null && !validAddress) || typeof pool.contractCodePresent !== "boolean" ||
        (pool.contractCodePresent && !validAddress))
      reject("INVALID_REPORT", "Invalid Classic volatile pool identity for " + agent);
    const verified = pool.contractCodePresent;
    if (!verified) {
      if (pool.usdcReserveBaseUnits != null || pool.tokenReserveBaseUnits != null || pool.reserveTimestamp != null)
        reject("INVALID_REPORT", "Undeployed pool cannot carry observed reserves for " + agent);
      byToken[agent] = Object.freeze({
        status: "UNVERIFIED",
        poolAddress: pool.poolAddress === null ? null : pool.poolAddress.toLowerCase(),
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
    parseRaw(pool.reserveTimestamp, agent + " reserve timestamp");
    const poolKey = pool.poolAddress.toLowerCase();
    if (seenPools.has(poolKey)) reject("INVALID_REPORT", "A pool cannot be counted for more than one token");
    seenPools.add(poolKey);
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
