// Parse all options before a diagnostic can make a network request.
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const USAGES = Object.freeze({
  base: "Usage: node scripts/probe-base.js [sepolia|mainnet] [public-contract-address]",
  holdings: "Usage: node scripts/inspect-aerodrome.js [public-wallet-address]",
  pools: "Usage: node scripts/inspect-aerodrome-pools.js",
  liquidity: "Usage: node scripts/liquidity-progress.js [--json]",
});
export function parsePublicDiagnosticArgs(kind, args) {
  if (!Object.hasOwn(USAGES, kind)) throw new TypeError("Unknown diagnostic");
  const usage = USAGES[kind] + "\nUse --help for this usage without contacting an RPC.";
  const invalid = { ok: false, help: false, usage };
  if (!Array.isArray(args) || !args.every(value => typeof value === "string")) return invalid;
  if (args.length === 1 && args[0] === "--help") return { ok: true, help: true, usage, options: {} };
  let options;
  if (kind === "base") {
    if (args.length > 2 || (args[0] !== undefined && !["sepolia", "mainnet"].includes(args[0])) ||
        (args[1] !== undefined && !ADDRESS.test(args[1]))) return invalid;
    options = { network: args[0] ?? "sepolia", contractAddress: args[1] };
  } else if (kind === "holdings") {
    if (args.length > 1 || (args[0] !== undefined && !ADDRESS.test(args[0]))) return invalid;
    options = { publicWalletAddress: args[0] };
  } else if (kind === "pools") {
    if (args.length !== 0) return invalid;
    options = {};
  } else {
    if (args.length > 1 || (args[0] !== undefined && args[0] !== "--json")) return invalid;
    options = { json: args.length === 1 };
  }
  return { ok: true, help: false, usage, options };
}
