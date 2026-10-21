// Connection routing evidence only. No assertion of extension uninstall or
// cancellation of an already dispatched wallet permission request.
export function summarizeWalletLifecycle(record) {
  const life = record.lifecycle ?? {}, primary = record.primaryChoice, secondary = record.secondaryChoice, added = record.addedChoice, rediscovered = record.rediscoveredChoice;
  const stages = ["start", "afterRemoval", "afterStaleRemoved", "afterAddition", "afterReorder", "afterRestore", "afterStaleRestored",
    "afterAmbiguousRestored", "afterDeduplication", "afterPrimaryConnect", "afterConnectedRemoval", "afterPrimaryRevocation", "afterAddedConnect", "afterAddedSignIn", "final"];
  const reads = new Set(["eth_accounts", "eth_chainId", "net_version", "wallet_getPermissions", "wallet_getCapabilities", "eth_getBalance"]);
  const nonReads = p => Array.isArray(p?.methods) ? p.methods.filter(m => !reads.has(m)) : null;
  const unchanged = (a, b) => nonReads(a) !== null && nonReads(b) !== null && JSON.stringify(nonReads(a)) === JSON.stringify(nonReads(b));
  const empty = p => Array.isArray(p?.accounts) && p.accounts.length === 0;
  const allEmpty = s => empty(s) && empty(s?.secondary) && empty(s?.added);
  const exactAccount = (p, digit) => p?.accounts?.length === 1 && p.accounts[0] === "0x" + digit.repeat(40);
  const permissionCount = p => (p?.methods ?? []).filter(m => ["wallet_requestPermissions", "eth_requestAccounts"].includes(m)).length;
  const isolated = record.lifecycleSimulation === true && record.scenarioVerification?.verified === true &&
    life.scope === "synthetic-framework-list-removal-and-restoration" && stages.every(key => {
      const s = life[key];
      try { return s?.simulationActive === true && new URL(s.url).origin === "https://aerodrome.finance" &&
        s.discovery === "eip6963-only" && s.hasLegacyProvider === false && s.secondary?.uuid === "f0c10000-1000-4000-8000-000000000002" &&
        s.added?.uuid === "f0c10000-1000-4000-8000-000000000003"; } catch { return false; }
    });
  function choices(s, expected, visible = false) {
    return Array.isArray(s?.choices) && s.choices.length === expected.length && expected.every(e => e &&
      s.choices.filter(c => c?.uid === e.uid && c.id === e.id && c.label === e.label).length === 1 &&
      (!visible || (s.buttons ?? []).filter(b => b.text === e.label && !b.disabled).length === 1));
  }
  const identities = [primary, secondary, added, rediscovered];
  const identitiesDistinct = identities.every(Boolean) && new Set(identities.map(c => c.uid)).size === 4 &&
    new Set(identities.map(c => c.id)).size === 4 && added.id > Math.max(primary.id, secondary.id) && rediscovered.id > Math.max(primary.id, secondary.id);
  const labelsStable = identitiesDistinct && choices(life.start, [primary, secondary], true) &&
    choices(life.afterRemoval, [secondary], true) && choices(life.afterStaleRemoved, [secondary], true) &&
    ["afterAddition", "afterReorder"].every(k => choices(life[k], [secondary, rediscovered, added], true)) &&
    ["afterRestore", "afterStaleRestored", "afterAmbiguousRestored"].every(k => choices(life[k], identities, true)) &&
    choices(life.afterDeduplication, [primary, secondary, added], true) &&
    choices(life.afterConnectedRemoval, [secondary, added]) && choices(life.final, [secondary, added], true);
  const orderChanged = life.afterAddition?.choices?.length === 3 && life.afterReorder?.choices?.length === 3 &&
    life.afterReorder.choices.every((c, i) => c?.uid === life.afterAddition.choices[2 - i]?.uid);
  const rejected = a => a?.rejected === true && /stale|removed/i.test(a.error ?? "");
  const staleCallbacksRejected = rejected(life.staleRemoved) && rejected(life.staleRestored) &&
    ["afterRemoval", "afterStaleRemoved", "afterAddition", "afterReorder", "afterRestore", "afterStaleRestored", "afterAmbiguousRestored", "afterDeduplication"].every(k =>
      allEmpty(life[k]) && unchanged(life.start, life[k]) && unchanged(life.start?.secondary, life[k]?.secondary) && unchanged(life.start?.added, life[k]?.added));
  const ambiguousProviderRejected = life.ambiguousRestored?.rejected === true && /ambiguous/i.test(life.ambiguousRestored.error ?? "");
  const primaryOnly = life.primaryClicked === true && exactAccount(life.afterPrimaryConnect, "1") &&
    exactAccount(life.afterConnectedRemoval, "1") && permissionCount(life.afterPrimaryConnect) > permissionCount(life.afterStaleRestored) &&
    ["afterPrimaryConnect", "afterConnectedRemoval", "afterPrimaryRevocation"].every(k =>
      empty(life[k]?.secondary) && empty(life[k]?.added) && unchanged(life.start?.secondary, life[k]?.secondary) && unchanged(life.start?.added, life[k]?.added)) &&
    allEmpty(life.afterPrimaryRevocation);
  const addedOnly = life.addedClicked === true && life.addedSignInClicked === true &&
    exactAccount(life.afterAddedConnect?.added, "3") && exactAccount(life.afterAddedSignIn?.added, "3") &&
    permissionCount(life.afterAddedConnect?.added) > permissionCount(life.afterPrimaryRevocation?.added) &&
    life.afterAddedSignIn?.added?.rejections?.some(r => r.method === "personal_sign" && r.code === 4001) &&
    ["afterAddedConnect", "afterAddedSignIn", "final"].every(k => empty(life[k]) && empty(life[k]?.secondary) &&
      unchanged(life.afterPrimaryRevocation, life[k]) && unchanged(life.start?.secondary, life[k]?.secondary));
  const allRevoked = allEmpty(life.start) && allEmpty(life.final) &&
    life.final?.added?.emitted?.some(e => e.event === "accountsChanged" && e.accounts?.length === 0);
  const scenarioObserved = record.scenario === "unnamed" ? life.start?.mockName === "" &&
    life.start?.secondary?.name?.trim() === "" && life.start?.added?.name === "" : record.scenario === "duplicate-name" &&
    typeof life.start?.mockName === "string" && life.start.mockName === life.start?.secondary?.name && life.start.mockName === life.start?.added?.name;
  return { isolated, identitiesDistinct, labelsStable: !!labelsStable, orderChanged: !!orderChanged, staleCallbacksRejected, ambiguousProviderRejected,
    primaryOnly: !!primaryOnly, addedOnly: !!addedOnly, allRevoked: !!allRevoked, scenarioObserved,
    verified: !!(isolated && labelsStable && orderChanged && staleCallbacksRejected && ambiguousProviderRejected && primaryOnly && addedOnly && allRevoked && scenarioObserved),
    extensionUninstallTested: false, publisherIdentityVerified: false, completedSignIn: false };
}
