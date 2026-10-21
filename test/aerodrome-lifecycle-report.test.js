import test from "node:test";
import assert from "node:assert/strict";
import { summarizeWalletLifecycle } from "../src/aerodrome-lifecycle-report.js";
const keys = ["start", "afterRemoval", "afterStaleRemoved", "afterAddition", "afterReorder", "afterRestore", "afterStaleRestored",
  "afterAmbiguousRestored", "afterDeduplication", "afterPrimaryConnect", "afterConnectedRemoval", "afterPrimaryRevocation", "afterAddedConnect", "afterAddedSignIn", "final"];

function observation(scenario = "duplicate-name") {
  const rows = [1, 2, 3, 4].map(id => ({ uid: "uid-" + id, id, label: `Wallet choice ${id}: ${scenario === "unnamed" ? "Unnamed wallet" : "Same"} (unverified name)` }));
  const p = () => ({ accounts: [], methods: ["eth_accounts"], rejections: [], emitted: [] });
  const snap = indexes => ({ url: "https://aerodrome.finance/connect", simulationActive: true, discovery: "eip6963-only", hasLegacyProvider: false,
    ...p(), mockName: scenario === "unnamed" ? "" : "Same", choices: indexes.map(i => ({ ...rows[i] })), buttons: indexes.map(i => ({ text: rows[i].label })),
    secondary: { ...p(), uuid: "f0c10000-1000-4000-8000-000000000002", name: scenario === "unnamed" ? "   " : "Same" },
    added: { ...p(), uuid: "f0c10000-1000-4000-8000-000000000003", name: scenario === "unnamed" ? "" : "Same" } });
  const r = { scenario, lifecycleSimulation: true, scenarioVerification: { verified: true }, primaryChoice: rows[1], secondaryChoice: rows[0], addedChoice: rows[3], rediscoveredChoice: rows[2],
    lifecycle: { scope: "synthetic-framework-list-removal-and-restoration", staleRemoved: { rejected: true, error: "Stale choice" },
      staleRestored: { rejected: true, error: "Stale choice" }, ambiguousRestored: { rejected: true, error: "Ambiguous provider" }, primaryClicked: true, addedClicked: true, addedSignInClicked: true } };
  const groups = [[0, 1], [0], [0], [0, 2, 3], [3, 2, 0], [3, 2, 0, 1], [3, 2, 0, 1], [3, 2, 0, 1], [3, 0, 1], [3, 0, 1], [3, 0], [3, 0], [3, 0], [3, 0], [3, 0]];
  keys.forEach((key, i) => { r.lifecycle[key] = snap(groups[i]); });
  for (const key of keys.slice(keys.indexOf("afterPrimaryConnect"))) r.lifecycle[key].methods.push("wallet_requestPermissions");
  for (const key of ["afterPrimaryConnect", "afterConnectedRemoval"]) r.lifecycle[key].accounts = ["0x" + "1".repeat(40)];
  for (const key of ["afterAddedConnect", "afterAddedSignIn", "final"]) r.lifecycle[key].added.methods.push("wallet_requestPermissions");
  for (const key of ["afterAddedConnect", "afterAddedSignIn"]) r.lifecycle[key].added.accounts = ["0x" + "3".repeat(40)];
  r.lifecycle.afterAddedSignIn.added.methods.push("personal_sign");
  r.lifecycle.afterAddedSignIn.added.rejections.push({ method: "personal_sign", code: 4001 });
  r.lifecycle.final.added.emitted.push({ event: "accountsChanged", accounts: [] });
  return r;
}

test("complete same-name and blank-name lifecycle evidence passes with explicit limits", () => {
  for (const scenario of ["duplicate-name", "unnamed"]) {
    const result = summarizeWalletLifecycle(observation(scenario));
    assert.equal(result.verified, true); assert.equal(result.extensionUninstallTested, false); assert.equal(result.publisherIdentityVerified, false);
  }
});
test("every lifecycle checkpoint is required", () => {
  for (const key of keys) { const r = observation(); delete r.lifecycle[key]; assert.equal(summarizeWalletLifecycle(r).verified, false, key); }
});
test("identity reuse, relabeling, failed removal and missing visible choices fail validation", () => {
  for (const mutate of [r => { r.addedChoice = r.primaryChoice; }, r => { r.lifecycle.afterRestore.choices[2].label = "other"; },
    r => { r.lifecycle.afterRemoval = r.lifecycle.start; }, r => { r.lifecycle.afterReorder = r.lifecycle.afterAddition; },
    r => { r.lifecycle.afterAddition.buttons = []; }]) {
    const r = observation(); mutate(r); assert.equal(summarizeWalletLifecycle(r).verified, false);
  }
});
test("stale actions must be rejected without new permission or signature calls", () => {
  for (const mutate of [r => { r.lifecycle.staleRemoved.rejected = false; }, r => { r.lifecycle.staleRestored.error = "unrelated"; },
    r => { r.lifecycle.ambiguousRestored.rejected = false; }, r => { r.lifecycle.afterAmbiguousRestored.methods.push("wallet_requestPermissions"); },
    r => { r.lifecycle.afterStaleRemoved.methods.push("wallet_requestPermissions"); },
    r => { r.lifecycle.afterStaleRestored.secondary.methods.push("personal_sign"); },
    r => { r.lifecycle.afterAddition.added.accounts = ["0x" + "3".repeat(40)]; }]) {
    const r = observation(); mutate(r); assert.equal(summarizeWalletLifecycle(r).verified, false);
  }
});
test("cross-wallet calls, wrong accounts, absent rejection and incomplete revocation fail validation", () => {
  for (const mutate of [r => { r.lifecycle.afterPrimaryConnect.accounts = ["0x" + "3".repeat(40)]; },
    r => { r.lifecycle.afterPrimaryConnect.added.methods.push("wallet_requestPermissions"); },
    r => { r.lifecycle.afterAddedConnect.methods.push("wallet_requestPermissions"); },
    r => { r.lifecycle.afterAddedSignIn.added.rejections = []; }, r => { r.lifecycle.final.added.emitted = []; },
    r => { r.lifecycle.final.secondary.accounts = ["0x" + "2".repeat(40)]; }]) {
    const r = observation(); mutate(r); assert.equal(summarizeWalletLifecycle(r).verified, false);
  }
});
test("isolation and the preceding two-wallet validation cannot be omitted", () => {
  for (const mutate of [r => { r.lifecycleSimulation = false; }, r => { r.scenarioVerification.verified = false; },
    r => { r.lifecycle.scope = "real-extension"; }, r => { r.lifecycle.afterAddition.hasLegacyProvider = true; },
    r => { r.lifecycle.final.url = "https://example.org"; }, r => { r.scenario = "unknown"; }]) {
    const r = observation(); mutate(r); assert.equal(summarizeWalletLifecycle(r).verified, false);
  }
});
