#!/usr/bin/env node
/**
 * Public liquidity-target tracker for DAT / EMA / CAWELON on Aerodrome Classic.
 *
 * npm run liquidity:progress
 * npm run liquidity:progress -- --json
 *
 * Read-only. Never authorizes a USDC deposit, signs, swaps, approves, adds LP
 * or accesses any wallet. There is no persistent "current balance" cache.
 */
import { inspectAerodromePools } from "../src/aerodrome-pools.js";
import { assessLiquidityTargets } from "../src/liquidity-target.js";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--json")) {
  process.stderr.write("Usage: npm run liquidity:progress -- [--json]\n");
  process.exit(2);
}

try {
  // Exactly one live snapshot; the target is a governance/planning metric.
  const observation = await inspectAerodromePools();
  const result = assessLiquidityTargets(observation);
  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    process.stdout.write("ThreeCore | read-only USDC pool reserve target\n");
    process.stdout.write("Base Mainnet observed block: " + result.observedBlockNumber + "\n");
    process.stdout.write("Target: 5,000 USDC per Classic volatile pool (no funding authorized)\n\n");
    for (const [token, pool] of Object.entries(result.pools)) {
      if (pool.status === "UNVERIFIED") {
        process.stdout.write(token + ": UNVERIFIED (not assumed to be zero)\n");
      } else {
        process.stdout.write(
          token + ": " + pool.observedUsdc +
          " USDC | progress " + pool.progressPercent +
          "% | reserve gap " + pool.reserveGapUsdc +
          " USDC | " + (pool.targetMet ? "TARGET MET" : "BELOW TARGET") + "\n",
        );
      }
    }
    process.stdout.write("\nObserved aggregate: " +
      (result.aggregateObservedUsdc ?? "UNVERIFIED") + " USDC\n");
    process.stdout.write("Sum of per-pool reserve shortfalls: " +
      (result.aggregateReserveGapUsdc ?? "UNVERIFIED") + " USDC\n");
    process.stdout.write(
      "\nOBSERVATION ONLY: this is not an LP deposit quote. " +
      "Token amounts and balances must be checked before any deposit.\n",
    );
  }
} catch (error) {
  process.stderr.write(
    "Read-only liquidity check failed: " +
    (error?.code ?? "RPC_ERROR") + " " +
    (error?.message ?? String(error)) + "\n",
  );
  process.exitCode = 1;
}
