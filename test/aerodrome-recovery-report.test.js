import test from "node:test";
import assert from "node:assert/strict";
import { summarizeWalletRecovery } from "../src/aerodrome-recovery-report.js";
const stages = ["before", "reviewed", "afterSelection", "afterCancel", "afterListChange", "refreshedReview", "afterApply", "afterOldCallback", "noDuplicates"];
function evidence() {
  const choices = [1, 2, 3, 4].map(id => ({ uid: `uid-${id}`, id, label: `Wallet choice ${id}` }));
  const p = () => ({ methods: ["eth_accounts"], accounts: [] });
  const buttons = () => [2, 3].map(id => ({ text: `Keep choice ${id}`, disabled: false, selected: id === 2 ? "true" : "false" }));
  const r = { recoveryUiExperiment: true, lifecycleVerification: { verified: true }, primaryChoice: choices[1], rediscoveredChoice: choices[2],
    recovery: { inputMethod: "CDP mouse on visible recovery-panel controls" } };
  for (const key of stages) r.recovery[key] = { url: "https://aerodrome.finance/connect", simulationActive: true, discovery: "eip6963-only", hasLegacyProvider: false,
    ...p(), secondary: p(), added: p(), choices: structuredClone(choices), recoveryUi: { status: "ready", text: "", buttons: buttons() } };
  for (const key of ["opened", "selected", "closed", "reopened", "selectedBeforeChange", "refreshed", "reselected", "applied", "reviewAfterApply", "finalClose"]) r.recovery[key] = true;
  r.recovery.afterCancel.recoveryUi.status = "closed";
  r.recovery.afterListChange.recoveryUi.status = "changed";
  r.recovery.afterApply.recoveryUi.status = "done";
  for (const key of ["afterApply", "afterOldCallback", "noDuplicates"]) r.recovery[key].choices.splice(2, 1);
  r.recovery.noDuplicates.recoveryUi = { status: "ready", text: "No duplicate connections found", buttons: [] };
  r.recovery.staleApplyClicked = false; r.recovery.repeatApplyClicked = false;
  r.recovery.oldCallback = { rejected: true, error: "Stale wallet choice" };
  return r;
}
test("complete visible recovery evidence passes with explicit deployment limits", () => {
  const result = summarizeWalletRecovery(evidence()); assert.equal(result.verified, true);
  assert.equal(result.officialDeploymentChanged, false); assert.equal(result.publisherIdentityVerified, false);
});
test("every recovery checkpoint and explicit user action is required", () => {
  for (const key of [...stages, "opened", "selected", "closed", "reopened", "selectedBeforeChange", "refreshed", "reselected", "applied", "reviewAfterApply", "finalClose"]) {
    const r = evidence(); delete r.recovery[key]; assert.equal(summarizeWalletRecovery(r).verified, false, key);
  }
});
test("same-name distinct provider cannot enter the duplicate removal group", () => {
  const r = evidence(); r.recovery.reviewed.recoveryUi.buttons.push({ text: "Keep choice 1" });
  assert.equal(summarizeWalletRecovery(r).verified, false);
});
test("cancel, stale apply, repeated apply and old callback failures reject the report", () => {
  for (const change of [r => { r.recovery.afterCancel.choices.pop(); }, r => { r.recovery.staleApplyClicked = true; },
    r => { r.recovery.repeatApplyClicked = true; }, r => { r.recovery.oldCallback.rejected = false; },
    r => { r.recovery.afterApply.choices[0].uid = "wrong"; }, r => { r.recovery.afterSelection.recoveryUi.buttons[0].selected = "false"; }]) {
    const r = evidence(); change(r); assert.equal(summarizeWalletRecovery(r).verified, false);
  }
});
test("cleanup and review must never request permissions or grant accounts", () => {
  for (const key of stages) for (const slot of [null, "secondary", "added"]) for (const method of ["wallet_requestPermissions", "personal_sign"]) {
    const r = evidence(), p = slot ? r.recovery[key][slot] : r.recovery[key];
    p.methods.push(method); assert.equal(summarizeWalletRecovery(r).verified, false, `${key} ${slot} ${method}`);
  }
  const r = evidence(); r.recovery.afterSelection.added.accounts.push("0x3333"); assert.equal(summarizeWalletRecovery(r).verified, false);
});
test("missing isolation, failed reconnection or leftover duplicates fail validation", () => {
  for (const change of [r => { r.lifecycleVerification.verified = false; }, r => { r.recoveryUiExperiment = false; },
    r => { r.recovery.afterApply.hasLegacyProvider = true; }, r => { r.recovery.reviewed.url = "https://aerodrome.finance.evil.test/"; },
    r => { r.recovery.noDuplicates.recoveryUi.buttons.push({ text: "Keep choice 2" }); }]) {
    const r = evidence(); change(r); assert.equal(summarizeWalletRecovery(r).verified, false);
  }
});
