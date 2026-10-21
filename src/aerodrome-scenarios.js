// Evidence checks for adversarial synthetic-provider scenarios. These describe
// the experimental browser only, never an official dApp compatibility pass.
import { SYNTHETIC_WALLET_NAME, SECONDARY_WALLET_NAME } from "./aerodrome-mock-wallet.js";
const reads = new Set(["eth_accounts", "eth_chainId", "net_version", "wallet_getPermissions",
  "wallet_getCapabilities", "eth_getBalance"]);
const count = (s, name) => (s?.buttons ?? []).filter(b => b.text === name && !b.disabled).length;
const untouched = p => !!p && Array.isArray(p.accounts) && p.accounts.length === 0 &&
  Array.isArray(p.methods) && p.methods.every(m => reads.has(m)) &&
  Array.isArray(p.rejections) && p.rejections.length === 0;
const announcements = p => (p?.trace ?? []).filter(e => e.kind === "announcement").length;

export function summarizeMockScenario(record) {
  const scenario = record.scenario ?? "single";
  if (scenario === "single") return { scenario, verified: true, additionalScenario: false };
  const start = record.beforeScenario, before = record.before;
  const snapshots = [start, before, record.afterConnect, record.afterSignIn,
    record.afterSyntheticRevocation, record.afterReconnect].filter(Boolean);
  const isolated = snapshots.length >= 3 && snapshots.every(s => {
    try { return new URL(s.url).origin === "https://aerodrome.finance" &&
      s.simulationActive === true && s.discovery === "eip6963-only" && s.hasLegacyProvider === false; }
    catch { return false; }
  });
  const patched = record.pageVariant === "local-connector-list-experiment" &&
    record.connectorExperiment?.status === "applied" && record.connectorExperiment?.replacements === 1;
  const cleanBeforeClick = untouched(start) && untouched(before);
  const completedBoundary = record.verification?.signatureBoundaryReached === true &&
    record.verification?.revocationObserved === true && record.verification?.explicitReconnectObserved === true &&
    record.selectedWalletLabel === SYNTHETIC_WALLET_NAME;
  const secondaryUntouched = snapshots.every(s => untouched(s.secondary) &&
    s.secondary.uuid === "f0c10000-1000-4000-8000-000000000002");
  let scenarioObserved = false;
  if (scenario === "multi-reannounce") {
    scenarioObserved = count(before, SYNTHETIC_WALLET_NAME) === 1 && count(before, SECONDARY_WALLET_NAME) === 1 &&
      announcements(before) >= announcements(start) + 3 &&
      announcements(before?.secondary) >= announcements(start?.secondary) + 3 && secondaryUntouched && completedBoundary;
  } else if (scenario === "delayed") {
    scenarioObserved = start?.announcementsEnabled === false && count(start, SYNTHETIC_WALLET_NAME) === 0 &&
      before?.announcementsEnabled === true && count(before, SYNTHETIC_WALLET_NAME) === 1 &&
      before.trace?.some(e => e.kind === "announcement" && e.phase === "scenario-activation") && completedBoundary;
  } else if (scenario === "duplicate-name") {
    scenarioObserved = count(before, SYNTHETIC_WALLET_NAME) === 2 && secondaryUntouched &&
      record.connectClicked === false && record.signInClicked === false &&
      snapshots.every(untouched) && record.selectedWalletLabel === undefined;
  }
  return { scenario, additionalScenario: true, isolated, patched, cleanBeforeClick,
    secondaryUntouched: ["multi-reannounce", "duplicate-name"].includes(scenario) ? secondaryUntouched : null,
    scenarioObserved: !!scenarioObserved, verified: isolated && patched && cleanBeforeClick && !!scenarioObserved };
}
