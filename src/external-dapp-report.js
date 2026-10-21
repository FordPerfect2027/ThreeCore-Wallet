// Interpret observations, never infer completed sign-in from a connect click.
// Used by the live, synthetic Aerodrome diagnostic and offline regressions.
import { SYNTHETIC_ACCOUNT, SYNTHETIC_WALLET_NAME } from "./aerodrome-mock-wallet.js";

// Prefer the announced synthetic wallet in discovery-only mode. Never match
// substrings or arbitrary discovered names; ambiguous duplicate labels fail.
export function selectMockWalletLabel(snapshot, discovery) {
  const labels = discovery === "eip6963-only" ?
    [SYNTHETIC_WALLET_NAME, "Browser Wallet", "Connect Wallet", "Connect"] :
    ["Browser Wallet", "Connect Wallet", "Connect"];
  for (const label of labels) {
    const matches = (snapshot?.buttons ?? []).filter(b => b.text === label && !b.disabled);
    if (matches.length > 1) return null;
    if (matches.length === 1) return label;
  }
  return null;
}
export function summarizeDiscoveryTrace(record) {
  const before = record.before?.trace ?? [];
  const after = record.afterConnect?.trace ?? [];
  const rediscovery = record.afterRediscovery?.trace ?? [];
  const permission = entry => entry.kind === "rpc" &&
    ["wallet_requestPermissions", "eth_requestAccounts"].includes(entry.method);
  const request = before.find(e => e.kind === "discovery-request");
  const announcementAfterRequest = !!request && before.some(e => e.kind === "announcement" && e.sequence > request.sequence);
  const preClickAccountProbe = before.some(e => e.kind === "rpc" && e.method === "eth_accounts" && e.phase === "page-load");
  const rediscoveryRequest = rediscovery.find(e => e.kind === "discovery-request" && e.phase === "explicit-rediscovery");
  const rediscoveryAnswered = !!rediscoveryRequest && rediscovery.some(e =>
    e.kind === "announcement" && e.phase === "explicit-rediscovery" && e.sequence > rediscoveryRequest.sequence);
  const permissionRequested = after.some(permission);
  const observedWithoutPermission = record.discovery === "eip6963-only" && record.before?.hasLegacyProvider === false &&
    request && announcementAfterRequest && preClickAccountProbe && rediscoveryAnswered &&
    record.connectClicked === true && record.secondConnectClicked === true && after.length < 200 && !permissionRequested;
  return {
    dappRequestedDiscovery: !!request, announcementAfterRequest, preClickAccountProbe,
    rediscoveryAnswered, permissionRequested,
    status: observedWithoutPermission ? "discovered-but-no-permission-request" :
      permissionRequested ? "permission-request-observed" : "insufficient-discovery-evidence",
    syntheticNameVisible: typeof record.before?.text === "string" ? record.before.text.includes("ThreeCore TEST ONLY") : null,
    // These observations do not by themselves prove which internal connector
    // the external site selected. Correlate with the recorded public JS asset.
    externalRoutingCauseProvenByTraceAlone: false,
  };
}

export function summarizeAerodromeProbe(record) {
  const official = snapshot => {
    try { return new URL(snapshot.url).origin === "https://aerodrome.finance"; }
    catch { return false; }
  };
  const snapshots = [record.before, record.afterConnect, record.afterSignIn].filter(Boolean);
  const last = record.afterSignIn ?? record.afterConnect ?? record.before;
  const methods = last?.methods ?? [];
  const rejections = last?.rejections ?? [];
  const siteUiLoaded = snapshots.length > 0 && snapshots.every(official) &&
    record.before?.buttons?.some(b => ["Browser Wallet", "Connect Wallet", "Connect", SYNTHETIC_WALLET_NAME].includes(b.text));
  const choiceExperiment = record.pageVariant === "local-wallet-choice-experiment";
  const routeUnambiguous = choiceExperiment ? !!record.primaryChoice &&
    record.before?.buttons?.filter(b => b.text === record.primaryChoice.label && !b.disabled).length === 1 :
    !!selectMockWalletLabel(record.before, record.discovery);
  const simulationVerified = snapshots.length > 0 && snapshots.every(s =>
    s.simulationActive === true && s.discovery === record.discovery &&
    s.hasLegacyProvider === (record.discovery === "legacy-and-eip6963"));
  // EIP-2255 permissions can expose the account without an additional
  // eth_requestAccounts call (observed with Aerodrome/viem).
  const accountRequested = methods.includes("eth_requestAccounts") || methods.includes("wallet_requestPermissions");
  const syntheticAccountGranted = last?.accounts?.length === 1 && last.accounts[0] === SYNTHETIC_ACCOUNT;
  const signatureRequested = methods.includes("personal_sign");
  const signatureRejected = signatureRequested && rejections.some(r => r.method === "personal_sign" && r.code === 4001);
  const clicked = record.connectClicked === true;
  const browserRouteAttempted = clicked && (record.before?.buttons?.some(b => b.text === "Browser Wallet") ||
    record.browserWalletClicked === true);
  const signatureBoundaryReached = siteUiLoaded && routeUnambiguous && simulationVerified && clicked && accountRequested && syntheticAccountGranted &&
    record.signInClicked === true && signatureRejected;
  // An observation without a connection is useful for the discovery-only probe,
  // but is explicitly NOT a positive compatibility test or proof of non-support.
  const discoveryOnlyObservation = record.discovery === "eip6963-only" &&
    siteUiLoaded && routeUnambiguous && simulationVerified && browserRouteAttempted && !accountRequested && !signatureRequested;
  const experimentalPage = record.pageVariant === "local-connector-list-experiment" || choiceExperiment;
  const knownVariant = record.pageVariant === undefined || record.pageVariant === "unmodified-official" || experimentalPage;
  const experimentVerified = experimentalPage && record.discovery === "eip6963-only" &&
    record.connectorExperiment?.status === "applied" && record.connectorExperiment?.replacements === 1 &&
    (choiceExperiment ? record.connectorExperiment.kind === "wallet-choice" && routeUnambiguous &&
      record.selectedWalletLabel === record.primaryChoice?.label : record.selectedWalletLabel === SYNTHETIC_WALLET_NAME);
  const diagnosticCompleted = knownVariant && (experimentalPage ? experimentVerified && signatureBoundaryReached :
    !record.connectorExperiment && (signatureBoundaryReached || discoveryOnlyObservation));
  return {
    siteUiLoaded, routeUnambiguous, simulationVerified, accountRequested, syntheticAccountGranted, signatureRequested, signatureRejected,
    signatureBoundaryReached,
    experimentalPage, experimentVerified,
    unmodifiedOfficialConnectionObserved: diagnosticCompleted && !experimentalPage && signatureBoundaryReached,
    diagnosticCompleted,
    outcome: !diagnosticCompleted ? "incomplete-or-unexpected-flow" :
      experimentalPage ? "experimental-page-signature-rejected" : signatureBoundaryReached ? "signature-rejected-as-required" :
      discoveryOnlyObservation ? "connection-not-observed" : "incomplete-or-unexpected-flow",
    completedSignIn: false, realWalletUsed: false,
  };
}
