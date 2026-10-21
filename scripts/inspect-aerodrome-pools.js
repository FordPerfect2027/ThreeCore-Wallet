#!/usr/bin/env node
/**
 * Read-only Aerodrome Classic (v2) PoolFactory query for ThreeCore/USDC.
 * Runs on Base Mainnet through a public RPC endpoint.
 *
 * node scripts/inspect-aerodrome-pools.js
 *
 * No wallet is connected. No signatures, swaps or funds are moved.
 */
import { inspectAerodromePools } from "../src/aerodrome-pools.js";

try {
  const report = await inspectAerodromePools();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  process.stderr.write("Aerodrome pool check failed: " +
    (error?.code ?? "RPC_ERROR") + " " + (error?.message ?? String(error)) + "\n");
  process.exitCode = 1;
}
