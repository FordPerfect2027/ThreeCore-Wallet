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
import { parsePublicDiagnosticArgs } from "./public-diagnostic-options.js";

const parsed = parsePublicDiagnosticArgs("holdings", process.argv.slice(2));
if (!parsed.ok || parsed.help) {
  (parsed.ok ? process.stdout : process.stderr).write(parsed.usage + "\n");
  process.exit(parsed.ok ? 0 : 2);
}
try {
  const report = await inspectAerodromeBase(parsed.options);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} catch (error) {
  process.stderr.write(
    "Read-only Aerodrome inspection failed: " +
      (error?.code ?? "RPC_FAILURE") + " " + (error?.message ?? String(error)) + "\n",
  );
  process.exitCode = 1;
}
