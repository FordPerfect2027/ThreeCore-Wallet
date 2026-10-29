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
import { parsePublicDiagnosticArgs } from "./public-diagnostic-options.js";

const parsed = parsePublicDiagnosticArgs("pools", process.argv.slice(2));
if (!parsed.ok || parsed.help) {
  (parsed.ok ? process.stdout : process.stderr).write(parsed.usage + "\n");
  process.exit(parsed.ok ? 0 : 2);
}
try {
  const report = await inspectAerodromePools();
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  process.stderr.write("Aerodrome pool check failed: " +
    (error?.code ?? "RPC_ERROR") + " " + (error?.message ?? String(error)) + "\n");
  process.exitCode = 1;
}
