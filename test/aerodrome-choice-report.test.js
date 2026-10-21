import test from "node:test";
import assert from "node:assert/strict";
import { summarizeWalletChoiceExperiment } from "../src/aerodrome-choice-report.js";

function observation(scenario = "duplicate-name") {
  const name = scenario === "unnamed" ? "Unnamed wallet" : "Same";
  const rows = [1, 2].map(id => ({ uid: "uid-" + id, id, label: `Wallet choice ${id}: ${name} (unverified name)` }));
  const read = () => ({ accounts: [], methods: ["eth_accounts"], rejections: [], emitted: [] });
  const snap = () => ({ url: "https://aerodrome.finance/connect", simulationActive: true, discovery: "eip6963-only", hasLegacyProvider: false,
    ...read(), mockName: scenario === "unnamed" ? "" : "Same", choices: structuredClone(rows), buttons: rows.map(r => ({ text: r.label })),
    secondary: { ...read(), uuid: "f0c10000-1000-4000-8000-000000000002", name: scenario === "unnamed" ? "   " : "Same" } });
  const r = { scenario, pageVariant: "local-wallet-choice-experiment", connectorExperiment: { kind: "wallet-choice", status: "applied", replacements: 1 },
    primaryChoice: rows[1], secondaryChoice: rows[0], secondaryConnectClicked: true, secondarySignInClicked: true,
    verification: { signatureBoundaryReached: true, revocationObserved: true, explicitReconnectObserved: true } };
  for (const key of ["beforeChoices", "before", "afterConnect", "afterSignIn", "afterSyntheticRevocation", "afterReconnect",
    "afterPrimaryDisconnect", "afterSecondaryConnect", "afterSecondarySignIn", "afterBothRevoked"]) r[key] = snap();
  for (const key of ["afterPrimaryDisconnect", "afterSecondaryConnect", "afterSecondarySignIn", "afterBothRevoked"]) {
    r[key].methods.push("wallet_requestPermissions", "personal_sign");
  }
  for (const key of ["afterSecondaryConnect", "afterSecondarySignIn", "afterBothRevoked"]) {
    r[key].secondary.methods.push("wallet_requestPermissions");
    if (key !== "afterBothRevoked") r[key].secondary.accounts = ["0x2222222222222222222222222222222222222222"];
  }
  r.afterSecondarySignIn.secondary.methods.push("personal_sign");
  r.afterSecondarySignIn.secondary.rejections.push({ method: "personal_sign", code: 4001 });
  r.afterBothRevoked.secondary.emitted.push({ event: "accountsChanged", accounts: [] });
  return r;
}

test("two independently selected instances can pass without claiming wallet publisher authentication", () => {
  for (const scenario of ["duplicate-name", "unnamed"]) {
    const result = summarizeWalletChoiceExperiment(observation(scenario));
    assert.equal(result.verified, true); assert.equal(result.publisherIdentityVerified, false); assert.equal(result.completedSignIn, false);
  }
});

test("each missing stage fails the two-wallet experiment", () => {
  for (const key of ["beforeChoices", "before", "afterConnect", "afterSignIn", "afterSyntheticRevocation", "afterReconnect",
    "afterPrimaryDisconnect", "afterSecondaryConnect", "afterSecondarySignIn", "afterBothRevoked"]) {
    const r = observation(); delete r[key]; assert.equal(summarizeWalletChoiceExperiment(r).verified, false);
  }
});

test("duplicate choices, stale labels, wrong bindings and absent visible buttons cannot pass", () => {
  for (const mutate of [r => { r.before.choices[1].uid = r.before.choices[0].uid; },
    r => { r.beforeChoices.choices[0].label += " stale"; }, r => { r.secondaryChoice = r.primaryChoice; },
    r => { r.before.buttons = []; }, r => { r.before.choices = [null, null]; }]) {
    const r = observation(); mutate(r); assert.equal(summarizeWalletChoiceExperiment(r).verified, false);
  }
});

test("permission or signature leakage into the unselected provider invalidates the result", () => {
  for (const mutate of [r => { r.before.methods.push("wallet_requestPermissions"); },
    r => { r.afterReconnect.secondary.methods.push("personal_sign"); },
    r => { r.afterConnect.secondary.accounts = ["0x2222222222222222222222222222222222222222"]; },
    r => { r.afterSecondarySignIn.methods.push("wallet_requestPermissions"); },
    r => { r.afterSecondaryConnect.accounts = ["0x1111111111111111111111111111111111111111"]; }]) {
    const r = observation(); mutate(r); assert.equal(summarizeWalletChoiceExperiment(r).verified, false);
  }
});

test("secondary permission, exact mock account, signature rejection and final revocation are required", () => {
  for (const mutate of [r => { r.secondaryConnectClicked = false; }, r => { r.secondarySignInClicked = false; },
    r => { r.afterSecondaryConnect.secondary.accounts = ["0x1111111111111111111111111111111111111111"]; },
    r => { r.afterSecondarySignIn.secondary.rejections = []; }, r => { r.afterBothRevoked.secondary.emitted = []; },
    r => { r.verification.explicitReconnectObserved = false; }]) {
    const r = observation(); mutate(r); assert.equal(summarizeWalletChoiceExperiment(r).verified, false);
  }
});

test("a different experiment, unknown scenario or contaminated page cannot become a positive result", () => {
  for (const mutate of [r => { r.pageVariant = "unmodified-official"; }, r => { r.connectorExperiment.kind = "connector-list"; },
    r => { r.connectorExperiment.status = "pending"; }, r => { r.afterBothRevoked.hasLegacyProvider = true; },
    r => { r.afterSecondaryConnect.url = "https://example.org"; }, r => { r.scenario = "unknown"; }]) {
    const r = observation(); mutate(r); assert.equal(summarizeWalletChoiceExperiment(r).verified, false);
  }
});
