// Verify both selectable synthetic instances independently. A green result is
// limited to the modified disposable page, not wallet publisher authentication.
export function summarizeWalletChoiceExperiment(record) {
  const keys = ["beforeChoices", "before", "afterConnect", "afterSignIn", "afterSyntheticRevocation", "afterReconnect",
    "afterPrimaryDisconnect", "afterSecondaryConnect", "afterSecondarySignIn", "afterBothRevoked"];
  const snapshots = keys.map(k => record[k]);
  const reads = new Set(["eth_accounts", "eth_chainId", "net_version", "wallet_getPermissions", "wallet_getCapabilities", "eth_getBalance"]);
  const untouched = p => !!p && p.accounts?.length === 0 && Array.isArray(p.methods) &&
    p.methods.every(m => reads.has(m)) && p.rejections?.length === 0;
  const isolated = snapshots.every(s => {
    try { return !!s && new URL(s.url).origin === "https://aerodrome.finance" && s.simulationActive === true &&
      s.discovery === "eip6963-only" && s.hasLegacyProvider === false && s.secondary?.uuid === "f0c10000-1000-4000-8000-000000000002"; }
    catch { return false; }
  });
  const patched = record.pageVariant === "local-wallet-choice-experiment" && record.connectorExperiment?.kind === "wallet-choice" &&
    record.connectorExperiment?.status === "applied" && record.connectorExperiment?.replacements === 1;
  const rows = Array.isArray(record.before?.choices) ? record.before.choices : [];
  const earlier = Array.isArray(record.beforeChoices?.choices) ? record.beforeChoices.choices : [];
  const choicesDistinct = rows.length === 2 && rows.every(r => r && typeof r === "object") && new Set(rows.map(r => r.uid)).size === 2 &&
    new Set(rows.map(r => r.label)).size === 2 && rows.every(r => typeof r.uid === "string" && typeof r.label === "string" && Number.isSafeInteger(r.id) && r.id > 0 &&
      r.label.startsWith("Wallet choice " + r.id + ": ") && r.label.endsWith(" (unverified name)") &&
      (record.before.buttons ?? []).filter(b => b.text === r.label && !b.disabled).length === 1);
  const choicesStable = choicesDistinct && earlier.length === 2 && earlier.every(e => e && typeof e === "object") &&
    rows.every(r => earlier.some(e => e.uid === r.uid && e.id === r.id && e.label === r.label));
  const primary = record.primaryChoice, secondary = record.secondaryChoice;
  const boundChoices = choicesDistinct && primary && secondary && primary.uid !== secondary.uid &&
    rows.some(r => r.uid === primary.uid && r.label === primary.label) &&
    rows.some(r => r.uid === secondary.uid && r.label === secondary.label);
  const cleanBeforeClick = untouched(record.beforeChoices) && untouched(record.before) &&
    untouched(record.beforeChoices?.secondary) && untouched(record.before?.secondary);
  const primaryBoundary = record.verification?.signatureBoundaryReached === true && record.verification?.revocationObserved === true &&
    record.verification?.explicitReconnectObserved === true;
  const secondaryUntouchedUntilSelected = ["before", "afterConnect", "afterSignIn", "afterReconnect", "afterPrimaryDisconnect"]
    .every(k => untouched(record[k]?.secondary));
  const second = record.afterSecondarySignIn?.secondary, secondConnect = record.afterSecondaryConnect?.secondary;
  const accountGranted = p => p?.accounts?.length === 1 && p.accounts[0] === "0x2222222222222222222222222222222222222222" &&
    Array.isArray(p.methods) && p.methods.some(m => ["eth_requestAccounts", "wallet_requestPermissions"].includes(m));
  const secondaryBoundary = record.secondaryConnectClicked === true && record.secondarySignInClicked === true &&
    accountGranted(secondConnect) && accountGranted(second) && second.methods.includes("personal_sign") &&
    Array.isArray(second.rejections) && second.rejections.some(r => r.method === "personal_sign" && r.code === 4001);
  const nonReadMethods = s => (s?.methods ?? []).filter(m => !reads.has(m));
  const primaryStayedRevoked = record.afterPrimaryDisconnect?.accounts?.length === 0 &&
    [record.afterSecondaryConnect, record.afterSecondarySignIn, record.afterBothRevoked].every(s =>
      s?.accounts?.length === 0 && JSON.stringify(nonReadMethods(s)) === JSON.stringify(nonReadMethods(record.afterPrimaryDisconnect)));
  const bothRevoked = record.afterBothRevoked?.accounts?.length === 0 && record.afterBothRevoked?.secondary?.accounts?.length === 0 &&
    record.afterBothRevoked?.secondary?.emitted?.some(e => e.event === "accountsChanged" && e.accounts.length === 0);
  const scenarioObserved = record.scenario === "unnamed" ?
    record.before?.mockName === "" && typeof record.before?.secondary?.name === "string" &&
      record.before.secondary.name.trim() === "" && rows.every(r => typeof r.label === "string" && r.label.includes("Unnamed wallet")) :
    record.scenario === "duplicate-name" && record.before?.mockName === record.before?.secondary?.name;
  const verified = isolated && patched && choicesStable && !!boundChoices && cleanBeforeClick && primaryBoundary &&
    secondaryUntouchedUntilSelected && !!secondaryBoundary && primaryStayedRevoked && !!bothRevoked && !!scenarioObserved;
  return { scenario: record.scenario, isolated, patched, choicesDistinct, choicesStable, boundChoices: !!boundChoices,
    cleanBeforeClick, primaryBoundary, secondaryUntouchedUntilSelected, secondaryBoundary: !!secondaryBoundary,
    primaryStayedRevoked, bothRevoked: !!bothRevoked, scenarioObserved: !!scenarioObserved,
    verified, publisherIdentityVerified: false, completedSignIn: false };
}
