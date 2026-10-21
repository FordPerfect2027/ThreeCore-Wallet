import { MOCK_SCENARIOS } from "../src/aerodrome-mock-wallet.js";
export function parseProbeOptions(args) {
  const scenarioFlags = args.filter(a => a.startsWith("--scenario="));
  const scenario = scenarioFlags[0]?.slice("--scenario=".length) ?? "single";
  const choiceExperiment = args.includes("--test-wallet-choice-fix");
  const lifecycle = args.includes("--test-wallet-lifecycle");
  const recovery = args.includes("--test-wallet-recovery-ui");
  const experiment = choiceExperiment || args.includes("--test-connector-list-fix");
  const allowed = ["--mock-wallet", "--eip6963-only", "--diagnose-discovery", "--test-connector-list-fix",
    "--test-wallet-choice-fix", "--test-wallet-lifecycle", "--test-wallet-recovery-ui", ...MOCK_SCENARIOS.map(s => "--scenario=" + s)];
  if (new Set(args).size !== args.length || args.some(a => !allowed.includes(a)) ||
      (args.some(a => a !== "--mock-wallet") && !args.includes("--mock-wallet")) ||
      scenarioFlags.length > 1 || (scenario !== "single" && !experiment) ||
      (scenario === "unnamed" && !choiceExperiment) ||
      (lifecycle && !choiceExperiment) ||
      (recovery && !lifecycle) ||
      (choiceExperiment && (args.includes("--test-connector-list-fix") || !["duplicate-name", "unnamed"].includes(scenario))) ||
      (experiment &&
       !["--mock-wallet", "--eip6963-only", "--diagnose-discovery"].every(a => args.includes(a)))) {
    throw Error("Usage: run-isolated-aerodrome-probe.js [--mock-wallet [--eip6963-only] [--diagnose-discovery] [--test-connector-list-fix]]; experiment requires all three preceding flags");
  }
  return { mockMode: args.includes("--mock-wallet"), diagnose: args.includes("--diagnose-discovery"),
    discovery: args.includes("--eip6963-only") ? "eip6963-only" : "legacy-and-eip6963",
    experiment, choiceExperiment, scenario, lifecycle, recovery };
}
