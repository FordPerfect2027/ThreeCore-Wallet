#!/usr/bin/env node
/**
 * Inspect known ThreeCore token and Aerodrome Classic contract addresses
 * through public Base Mainnet JSON-RPC; no wallet or signing required.
 *
 * node scripts/inspect-aerodrome.js
 * node scripts/inspect-aerodrome.js 0xYOUR_PUBLIC_WALLET_ADDRESS
 *
 * Do NOT pass a private key or seed phrase. Providing a public wallet address
 * requests public onchain balance and existing Aerodrome Classic Router
 * allowance information; it does not approve spending.
 */
import { inspectAerodromeBase } from "../src/aerodrome-readonly.js";

const args = process.argv.slice(2);
if (args.length > 1) {
  process.stderr.write("Usage: node scripts/inspect-aerodrome.js [public-wallet-address]\n");
  process.exit(2);
}
try {
  const report = await inspectAerodromeBase({ publicWalletAddress: args[0] });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  process.stderr.write(
    "Read-only Aerodrome inspection failed: " +
      (error?.code ?? "RPC_FAILURE") + " " + (error?.message ?? String(error)) + "\n",
  );
  process.exitCode = 1;
}
