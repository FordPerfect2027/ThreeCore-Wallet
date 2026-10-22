// Interpret observations, never infer completed sign-in from a connect click.
// Used by the live, synthetic Aerodrome diagnostic and offline regressions.
import { SYNTHETIC_ACCOUNT, SYNTHETIC_WALLET_NAME } from "./aerodrome-mock-wallet.js";

// Fail closed when the external site requests any method outside the
// documented synthetic-wallet diagnostic. Rejection is not evidence that
// an unexpected privileged request was safe or expected.
const EXPECTED_PROBE_METHODS = new Set([
  "eth_chainId", "net_version", "eth_accounts", "eth_requestAccounts",
  "wallet_requestPermissions", "wallet_getPermissions", "wallet_getCapabilities",
  "eth_getBalance", "eth_call", "personal_sign",
]);

const PRIVILEGED_RPC_METHODS = new Set([
  "eth_sign", "eth_signTransaction", "eth_sendTransaction", "eth_sendRawTransaction",
  "eth_sendUserOperation", "wallet_sendCalls", "wallet_sendTransaction", "wallet_prepareCalls",
  "wallet_grantPermissions", "wallet_revokePermissions", "wallet_switchEthereumChain",
  "wallet_addEthereumChain", "wallet_watchAsset",
]);
const isPrivilegedRpcMethod = method => typeof method === "string" &&
  (PRIVILEGED_RPC_METHODS.has(method) || /^eth_signTypedData(?:_v[0-9]+)?$/.test(method));

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
  const methods = Array.isArray(last?.methods) ? last.methods : [];
  const rejections = Array.isArray(last?.rejections) ? last.rejections : [];
  const rpcEvidenceComplete = snapshots.length > 0 && snapshots.every(s =>
    Array.isArray(s.methods) && s.methods.every(m => typeof m === "string") &&
    Array.isArray(s.rejections) && s.rejections.every(r => r && typeof r.method === "string"));
  // Review every observation, not just the final snapshot: unexpected
  // rejected calls must never disappear from the compatibility verdict.
  const observedMethods = snapshots.flatMap(s => [
    ...(Array.isArray(s.methods) ? s.methods : []),
    ...(Array.isArray(s.rejections) ? s.rejections.map(r => r?.method) : []),
    ...(Array.isArray(s.trace) ? s.trace.filter(e => e?.kind === "rpc").map(e => e.method) : []),
  ]);
  const unexpectedMethods = [...new Set(observedMethods.filter(m =>
    typeof m === "string" && !EXPECTED_PROBE_METHODS.has(m)))];
  const privilegedRpcMethods = [...new Set(observedMethods.filter(isPrivilegedRpcMethod))];
  const privilegedRpcRequested = privilegedRpcMethods.length > 0;
  const unexpectedRpcObserved = !rpcEvidenceComplete || unexpectedMethods.length > 0;
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
  const signatureRequested = observedMethods.includes("personal_sign");
  // Snapshots and traces are cumulative: do not sum repeated observations,
  // but never let a shorter final snapshot erase earlier signing attempts.
  const signAttempts = Math.max(0, ...snapshots.map(s => Math.max(
    Array.isArray(s.methods) ? s.methods.filter(m => m === "personal_sign").length : 0,
    Array.isArray(s.trace) ? s.trace.filter(e => e?.kind === "rpc" && e.method === "personal_sign").length : 0,
  )));
  const signRejections = rejections.filter(r => r?.method === "personal_sign");
  const signatureRejected = !!record.afterSignIn && methods.includes("personal_sign") &&
    signAttempts > 0 && signRejections.length === signAttempts &&
    signRejections.every(r => r.code === 4001);
  const clicked = record.connectClicked === true;
  const browserRouteAttempted = clicked && (record.before?.buttons?.some(b => b.text === "Browser Wallet") ||
    record.browserWalletClicked === true);
  const signatureBoundaryReached = siteUiLoaded && routeUnambiguous && simulationVerified && clicked && accountRequested && syntheticAccountGranted &&
    record.signInClicked === true && signatureRejected && !unexpectedRpcObserved;
  // An observation without a connection is useful for the discovery-only probe,
  // but is explicitly NOT a positive compatibility test or proof of non-support.
  const discoveryOnlyObservation = record.discovery === "eip6963-only" &&
    siteUiLoaded && routeUnambiguous && simulationVerified && browserRouteAttempted && !accountRequested && !signatureRequested && !unexpectedRpcObserved;
  const experimentalPage = record.pageVariant === "local-connector-list-experiment" || choiceExperiment;
  const knownVariant = record.pageVariant === undefined || record.pageVariant === "unmodified-official" || experimentalPage;
  const experimentVerified = experimentalPage && record.discovery === "eip6963-only" &&
    record.connectorExperiment?.status === "applied" && record.connectorExperiment?.replacements === 1 &&
    (choiceExperiment ? record.connectorExperiment.kind === "wallet-choice" && routeUnambiguous &&
      record.selectedWalletLabel === record.primaryChoice?.label : record.selectedWalletLabel === SYNTHETIC_WALLET_NAME);
  const diagnosticCompleted = !unexpectedRpcObserved && knownVariant && (experimentalPage ? experimentVerified && signatureBoundaryReached :
    !record.connectorExperiment && (signatureBoundaryReached || discoveryOnlyObservation));
  return {
    siteUiLoaded, routeUnambiguous, simulationVerified, accountRequested, syntheticAccountGranted, signatureRequested, signatureRejected,
    rpcEvidenceComplete, unexpectedMethods, unexpectedRpcObserved, privilegedRpcMethods, privilegedRpcRequested,
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
