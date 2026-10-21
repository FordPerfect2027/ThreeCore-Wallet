export function summarizeWalletRecovery(record) {
  const ui = record.recovery ?? {}, a = record.primaryChoice, duplicate = record.rediscoveredChoice;
  const stages = ["before", "reviewed", "afterSelection", "afterCancel", "afterListChange", "refreshedReview", "afterApply", "afterOldCallback", "noDuplicates"];
  const reads = new Set(["eth_accounts", "eth_chainId", "net_version", "wallet_getPermissions", "wallet_getCapabilities", "eth_getBalance"]);
  const fingerprint = p => Array.isArray(p?.methods) ? JSON.stringify(p.methods.filter(m => !reads.has(m))) : null;
  const isolated = record.recoveryUiExperiment === true && record.lifecycleVerification?.verified === true &&
    ui.inputMethod === "CDP mouse on visible recovery-panel controls" && stages.every(k => {
    const s = ui[k];
    return s?.simulationActive === true && s.discovery === "eip6963-only" && s.hasLegacyProvider === false &&
      typeof s.url === "string" && /^https:\/\/aerodrome\.finance\//.test(s.url) && !!s.recoveryUi;
  });
  const actions = ["opened", "selected", "closed", "reopened", "selectedBeforeChange", "refreshed", "reselected", "applied", "reviewAfterApply", "finalClose"].every(k => ui[k] === true);
  const keepButtons = s => (s?.recoveryUi?.buttons ?? []).filter(b => /^Keep choice \d+$/.test(b.text) && !b.disabled).map(b => b.text).sort();
  const expected = a && duplicate ? [`Keep choice ${a.id}`, `Keep choice ${duplicate.id}`].sort() : [];
  const exactDuplicates = expected.length === 2 && ["reviewed", "refreshedReview"].every(k =>
    JSON.stringify(keepButtons(ui[k])) === JSON.stringify(expected));
  const selectedExplicitly = ui.afterSelection?.recoveryUi?.buttons?.some(b => b.text === `Keep choice ${a?.id}` && b.selected === "true");
  const ids = s => (s?.choices ?? []).map(c => c.uid).sort();
  const cancelledWithoutChanges = ui.afterCancel?.recoveryUi?.status === "closed" && ui.before?.choices?.length === 4 &&
    JSON.stringify(ids(ui.before)) === JSON.stringify(ids(ui.afterCancel));
  const staleReviewRefused = ui.afterListChange?.recoveryUi?.status === "changed" && ui.staleApplyClicked === false;
  const cleaned = ui.afterApply?.recoveryUi?.status === "done" && ui.afterApply.choices?.length === 3 &&
    JSON.stringify(ids(ui.afterApply)) === JSON.stringify(ids(ui.before).filter(uid => uid !== duplicate?.uid)) &&
    ui.repeatApplyClicked === false && ui.oldCallback?.rejected === true && /stale|removed/i.test(ui.oldCallback.error ?? "");
  const noAutoConnect = stages.every(k => [ui[k], ui[k]?.secondary, ui[k]?.added].every((p, i) => {
    const first = [ui.before, ui.before?.secondary, ui.before?.added][i];
    return Array.isArray(p?.accounts) && p.accounts.length === 0 && fingerprint(first) !== null && fingerprint(p) === fingerprint(first);
  }));
  const separateProvidersPreserved = ui.noDuplicates?.recoveryUi?.status === "ready" && keepButtons(ui.noDuplicates).length === 0 &&
    ui.noDuplicates.choices?.length === 3 && /No duplicate connections found/.test(ui.noDuplicates.recoveryUi.text);
  const verified = !!(isolated && actions && exactDuplicates && selectedExplicitly && cancelledWithoutChanges && staleReviewRefused && cleaned && noAutoConnect && separateProvidersPreserved);
  return { isolated, actions, exactDuplicates, selectedExplicitly: !!selectedExplicitly, cancelledWithoutChanges,
    staleReviewRefused, cleaned: !!cleaned, noAutoConnect, separateProvidersPreserved: !!separateProvidersPreserved,
    verified, officialDeploymentChanged: false, publisherIdentityVerified: false, completedSignIn: false };
}
