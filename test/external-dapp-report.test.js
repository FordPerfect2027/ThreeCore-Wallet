import test from "node:test";
import assert from "node:assert/strict";
import { summarizeAerodromeProbe } from "../src/external-dapp-report.js";
import { SYNTHETIC_ACCOUNT, SYNTHETIC_WALLET_NAME } from "../src/aerodrome-mock-wallet.js";

function record(discovery = "legacy-and-eip6963") {
  const snapshot = () => ({ url: "https://aerodrome.finance/connect", simulationActive: true,
    discovery, hasLegacyProvider: discovery === "legacy-and-eip6963",
    buttons: [{ text: "Browser Wallet" }], methods: [], rejections: [], accounts: [] });
  return { discovery, before: snapshot(), afterConnect: snapshot(), afterSignIn: {
    ...snapshot(), methods: ["wallet_requestPermissions", "eth_requestAccounts", "personal_sign"],
    accounts: [SYNTHETIC_ACCOUNT],
    rejections: [{ method: "personal_sign", code: 4001 }],
  }, connectClicked: true, signInClicked: true };
}
test("successful probe means signature rejection, never completed sign-in", () => {
  const result = summarizeAerodromeProbe(record());
  assert.equal(result.signatureBoundaryReached, true);
  assert.equal(result.diagnosticCompleted, true);
  assert.equal(result.completedSignIn, false);
});
test("reaching the correct URL without loaded UI does not pass", () => {
  const r = record(); r.before.buttons = [];
  assert.equal(summarizeAerodromeProbe(r).diagnosticCompleted, false);
});
test("a lookalike, alternate port or redirected origin cannot pass", () => {
  for (const url of ["https://aerodrome.finance.evil.example/connect", "https://aerodrome.finance:8443/connect", "http://aerodrome.finance/connect", "invalid"]) {
    const r = record(); r.afterConnect.url = url;
    assert.equal(summarizeAerodromeProbe(r).diagnosticCompleted, false);
  }
});
test("a signature request without actual rejection evidence does not pass", () => {
  const r = record(); r.afterSignIn.rejections = [];
  assert.equal(summarizeAerodromeProbe(r).diagnosticCompleted, false);
});
test("a simulation marker or click alone cannot establish compatibility", () => {
  const r = record(); r.afterSignIn.methods = [];
  assert.equal(summarizeAerodromeProbe(r).diagnosticCompleted, false);
});
test("discovery-only absence is reported separately from compatibility", () => {
  const r = record("eip6963-only"); delete r.afterSignIn; r.signInClicked = false;
  const result = summarizeAerodromeProbe(r);
  assert.equal(result.diagnosticCompleted, true);
  assert.equal(result.signatureBoundaryReached, false);
  assert.equal(result.outcome, "connection-not-observed");
});
test("discovery-only result is invalid if a legacy provider was present", () => {
  const r = record("eip6963-only"); r.before.hasLegacyProvider = true;
  assert.equal(summarizeAerodromeProbe(r).diagnosticCompleted, false);
});
test("missing or incomplete observations cannot pass", () => {
  assert.equal(summarizeAerodromeProbe({}).diagnosticCompleted, false);
  const r = record(); r.before.simulationActive = false;
  assert.equal(summarizeAerodromeProbe(r).diagnosticCompleted, false);
});

test("observed EIP-2255-only permission flow reaches the signature boundary", () => {
  const r = record();
  r.afterSignIn.methods = ["wallet_requestPermissions", "eth_chainId", "eth_accounts", "wallet_getCapabilities", "personal_sign"];
  assert.equal(summarizeAerodromeProbe(r).signatureBoundaryReached, true);
});
test("a permission request without a granted synthetic account does not pass", () => {
  for (const accounts of [[], ["0x2222222222222222222222222222222222222222"], [SYNTHETIC_ACCOUNT, SYNTHETIC_ACCOUNT]]) {
    const r = record(); r.afterSignIn.accounts = accounts;
    assert.equal(summarizeAerodromeProbe(r).signatureBoundaryReached, false);
  }
});
test("a generic Connect click without the browser route is an incomplete observation", () => {
  const r = record("eip6963-only"); delete r.afterSignIn;
  r.before.buttons = [{ text: "Connect" }];
  assert.equal(summarizeAerodromeProbe(r).diagnosticCompleted, false);
});

test("a rendered chooser with duplicate mock names is loaded but not unambiguously selectable", () => {
  const r = record("eip6963-only");
  r.before.buttons = [{ text: "Browser Wallet" }, { text: SYNTHETIC_WALLET_NAME }, { text: SYNTHETIC_WALLET_NAME }];
  const result = summarizeAerodromeProbe(r);
  assert.equal(result.siteUiLoaded, true);
  assert.equal(result.routeUnambiguous, false);
  assert.equal(result.signatureBoundaryReached, false);
});
