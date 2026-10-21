import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { makeAerodromeMockWalletSource, SYNTHETIC_WALLET_NAME, SECONDARY_WALLET_NAME } from "../src/aerodrome-mock-wallet.js";
import { parseProbeOptions } from "../scripts/aerodrome-probe-options.js";
import { summarizeMockScenario } from "../src/aerodrome-scenarios.js";

function fixture(scenario) {
  const listeners = new Map(), announcements = [];
  const window = { location: { origin: "https://aerodrome.finance" },
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(callback); },
    dispatchEvent(event) {
      if (event.type === "eip6963:announceProvider") announcements.push(event.detail);
      for (const callback of listeners.get(event.type) ?? []) callback(event);
    } };
  class CustomEvent { constructor(type, { detail }) { this.type = type; this.detail = detail; } }
  vm.runInNewContext(makeAerodromeMockWalletSource(undefined, { discovery: "eip6963-only", scenario }),
    { window, CustomEvent, setTimeout: callback => callback() }, { timeout: 1000 });
  return { window, announcements, primary: window.__threecoreWalletSimulation, secondary: window.__threecoreSecondarySimulation };
}

test("two distinct providers announce secondary first without a legacy global or account grants", async () => {
  const f = fixture("multi-reannounce");
  assert.equal(f.window.ethereum, undefined);
  assert.deepEqual(f.announcements.map(a => a.info.name), [SECONDARY_WALLET_NAME, SYNTHETIC_WALLET_NAME]);
  assert.notEqual(f.primary.provider, f.secondary.provider);
  assert.notEqual(f.announcements[0].info.uuid, f.announcements[1].info.uuid);
  for (const a of f.announcements) { assert.ok(Object.isFrozen(a)); assert.ok(Object.isFrozen(a.info)); }
  for (const p of [f.primary, f.secondary]) assert.equal((await p.provider.request({ method: "eth_accounts" })).length, 0);
});

test("reannouncements preserve provider and UUID identities without granting access", () => {
  const f = fixture("multi-reannounce"), initial = [...f.announcements];
  for (let i = 0; i < 3; i++) f.window.dispatchEvent({ type: "eip6963:requestProvider" });
  assert.equal(f.announcements.length, 8);
  for (let i = 0; i < 8; i++) assert.equal(f.announcements[i], initial[i % 2]);
  assert.equal(f.primary.accounts.length, 0); assert.equal(f.secondary.accounts.length, 0);
});

test("selected mock permissions and revocation never spill into the other provider", async () => {
  const f = fixture("multi-reannounce");
  await f.primary.provider.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  assert.equal(f.primary.accounts[0], "0x1111111111111111111111111111111111111111");
  assert.equal(f.secondary.accounts.length, 0);
  assert.equal(f.secondary.observed.length, 0);
  f.primary.revokeAccounts();
  assert.equal(f.primary.accounts.length, 0); assert.equal(f.secondary.accounts.length, 0);
});

test("both synthetic providers reject signatures, approvals and transaction methods", async () => {
  const f = fixture("multi-reannounce");
  for (const p of [f.primary, f.secondary]) {
    for (const method of ["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction", "eth_sendRawTransaction", "wallet_sendCalls", "wallet_grantPermissions"]) {
      await assert.rejects(p.provider.request({ method }), error => error.code === 4001);
    }
    assert.equal(p.accounts.length, 0);
  }
});

test("delayed availability produces no announcement until explicitly activated", () => {
  const f = fixture("delayed");
  f.window.dispatchEvent({ type: "eip6963:requestProvider" });
  assert.equal(f.announcements.length, 0);
  assert.equal(f.primary.announcementsEnabled, false);
  f.primary.markPhase("scenario-activation"); f.primary.activate();
  assert.equal(f.announcements.length, 1);
  f.window.dispatchEvent({ type: "eip6963:requestProvider" });
  assert.equal(f.announcements[0], f.announcements[1]);
  assert.equal(f.primary.accounts.length, 0);
});

test("same-name fixture retains two distinct identities without impersonating an actual wallet", () => {
  const f = fixture("duplicate-name");
  assert.equal(f.announcements[0].info.name, SYNTHETIC_WALLET_NAME);
  assert.equal(f.announcements[1].info.name, SYNTHETIC_WALLET_NAME);
  assert.notEqual(f.announcements[0].info.rdns, f.announcements[1].info.rdns);
  assert.notEqual(f.announcements[0].provider, f.announcements[1].provider);
});

test("scenario CLI refuses unknown, multiple or unisolated combinations", () => {
  const base = ["--mock-wallet", "--eip6963-only", "--diagnose-discovery", "--test-connector-list-fix"];
  for (const args of [[...base, "--scenario=unknown"], [...base, "--scenario=delayed", "--scenario=duplicate-name"],
    ["--mock-wallet", "--eip6963-only", "--scenario=multi-reannounce"]]) assert.throws(() => parseProbeOptions(args));
  assert.equal(parseProbeOptions([...base, "--scenario=multi-reannounce"]).scenario, "multi-reannounce");
  assert.throws(() => makeAerodromeMockWalletSource(undefined, { scenario: "delayed" }));
  assert.throws(() => makeAerodromeMockWalletSource(undefined, { discovery: "eip6963-only", scenario: "unknown" }));
});

const events = n => Array.from({ length: n }, (_, i) => ({ kind: "announcement", phase: "scenario-activation", sequence: i + 1 }));
function observation(scenario) {
  const secondary = () => ({ uuid: "f0c10000-1000-4000-8000-000000000002", accounts: [], methods: ["eth_accounts"], rejections: [], trace: events(1) });
  const snap = () => ({ url: "https://aerodrome.finance/connect", simulationActive: true, discovery: "eip6963-only",
    hasLegacyProvider: false, accounts: [], methods: ["eth_accounts"], rejections: [], trace: events(1),
    announcementsEnabled: true, secondary: secondary(),
    buttons: [{ text: "Browser Wallet" }, { text: SYNTHETIC_WALLET_NAME }, { text: SECONDARY_WALLET_NAME }] });
  const r = { scenario, pageVariant: "local-connector-list-experiment", connectorExperiment: { status: "applied", replacements: 1 },
    beforeScenario: snap(), before: snap(), afterConnect: snap(), afterSignIn: snap(), afterSyntheticRevocation: snap(), afterReconnect: snap(),
    verification: { signatureBoundaryReached: true, revocationObserved: true, explicitReconnectObserved: true },
    selectedWalletLabel: SYNTHETIC_WALLET_NAME, connectClicked: true, signInClicked: true };
  if (scenario === "multi-reannounce") { r.before.trace = events(4); r.before.secondary.trace = events(4); }
  if (scenario === "delayed") {
    r.beforeScenario.announcementsEnabled = false;
    r.beforeScenario.buttons = [{ text: "Browser Wallet" }]; r.beforeScenario.trace = [];
  }
  if (scenario === "duplicate-name") {
    r.before.buttons = [{ text: SYNTHETIC_WALLET_NAME }, { text: SYNTHETIC_WALLET_NAME }];
    delete r.selectedWalletLabel; r.connectClicked = false; r.signInClicked = false;
  }
  return r;
}

test("scenario evidence confirms distinct repeated providers, late arrival and explicit ambiguity refusal", () => {
  for (const scenario of ["multi-reannounce", "delayed", "duplicate-name"]) assert.equal(summarizeMockScenario(observation(scenario)).verified, true);
});

test("repeated-provider scenario rejects missing repetition, duplicate choices or secondary access", () => {
  for (const mutate of [r => { r.before.trace = events(1); }, r => { r.before.secondary.trace = events(1); },
    r => { r.before.buttons.push({ text: SYNTHETIC_WALLET_NAME }); },
    r => { r.afterReconnect.secondary.methods.push("wallet_requestPermissions"); },
    r => { r.afterConnect.secondary.accounts = ["0x2222222222222222222222222222222222222222"]; },
    r => { r.afterSignIn.secondary.methods.push("personal_sign"); }, r => { delete r.afterReconnect.secondary; },
    r => { r.verification.explicitReconnectObserved = false; }]) {
    const r = observation("multi-reannounce"); mutate(r); assert.equal(summarizeMockScenario(r).verified, false);
  }
});

test("late-arrival scenario requires observed absence, activation, visibility and connection boundary", () => {
  for (const mutate of [r => { r.beforeScenario.announcementsEnabled = true; },
    r => { r.beforeScenario.buttons.push({ text: SYNTHETIC_WALLET_NAME }); },
    r => { r.before.trace = []; }, r => { r.before.buttons = []; }, r => { r.verification.signatureBoundaryReached = false; }]) {
    const r = observation("delayed"); mutate(r); assert.equal(summarizeMockScenario(r).verified, false);
  }
});

test("ambiguity control cannot pass for absent choices, a fallback click or any account permission request", () => {
  for (const mutate of [r => { r.before.buttons.pop(); }, r => { r.connectClicked = true; },
    r => { r.selectedWalletLabel = "Browser Wallet"; }, r => { r.afterConnect.methods.push("eth_requestAccounts"); },
    r => { r.afterConnect.secondary.methods.push("wallet_requestPermissions"); }, r => { r.signInClicked = true; }]) {
    const r = observation("duplicate-name"); mutate(r); assert.equal(summarizeMockScenario(r).verified, false);
  }
});

test("additional scenarios reject missing evidence, unpatched pages and contaminated browser state", () => {
  for (const mutate of [r => { delete r.beforeScenario; }, r => { r.pageVariant = "unmodified-official"; },
    r => { r.connectorExperiment.status = "pending"; }, r => { r.before.hasLegacyProvider = true; },
    r => { r.afterConnect.url = "https://example.org"; }, r => { r.before.methods.push("wallet_requestPermissions"); }]) {
    const r = observation("multi-reannounce"); mutate(r); assert.equal(summarizeMockScenario(r).verified, false);
  }
});
