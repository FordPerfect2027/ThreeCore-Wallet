#!/usr/bin/env node
/**
 * Manual, read-only public Base RPC diagnostic.
 * Does not read wallet accounts, sign, grant allowances, send transactions,
 * or claim that a third-party dApp integration has been completed.
 *
 * Examples:
 *   node scripts/probe-base.js sepolia
 *   node scripts/probe-base.js mainnet 0x1111111111111111111111111111111111111111
 */
import { probeBaseRpc } from "../src/base-rpc-probe.js";

const [network = "sepolia", contractAddress] = process.argv.slice(2);
try {
  const result = await probeBaseRpc({ network, contractAddress });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  process.stderr.write(
    "Base public RPC check failed: " + (error?.code ?? "RPC_ERROR") +
    " " + (error?.message ?? String(error)) + "\n",
  );
  process.exitCode = 1;
}
