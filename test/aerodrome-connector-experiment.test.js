import test from "node:test";
import assert from "node:assert/strict";
import { parseProbeOptions } from "../scripts/aerodrome-probe-options.js";
import { EXPERIMENT_URL, patchPinnedConnectorAsset, replaceUniqueConnectorLimit,
  fulfillConnectorExperiment } from "../scripts/aerodrome-connector-experiment.js";
import { selectMockWalletLabel, summarizeAerodromeProbe } from "../src/external-dapp-report.js";
import { SYNTHETIC_ACCOUNT, SYNTHETIC_WALLET_NAME } from "../src/aerodrome-mock-wallet.js";

test("counterfactual mode requires explicit mock, discovery-only and diagnostics flags", () => {
  const required = ["--mock-wallet", "--eip6963-only", "--diagnose-discovery"];
  for (const omitted of required) {
    assert.throws(() => parseProbeOptions([...required.filter(a => a !== omitted), "--test-connector-list-fix"]));
  }
  assert.equal(parseProbeOptions([...required, "--test-connector-list-fix"]).experiment, true);
  assert.equal(parseProbeOptions([]).experiment, false);
  assert.equal(parseProbeOptions(required).experiment, false);
});

test("probe arguments reject duplicates, URL overrides and legacy-only experiments", () => {
  for (const args of [["--mock-wallet", "--mock-wallet"], ["--url=https://example.org"],
    ["--mock-wallet", "--test-connector-list-fix"], ["--diagnose-discovery"]]) {
    assert.throws(() => parseProbeOptions(args));
  }
});

const expression = 'r.slice(0,_0e).map(o=>o.name==="Injected"?{...o,name:"Browser Wallet"}:o)';
test("experimental list correction preserves discovered connectors beyond the initial four", () => {
  const connectors = [{ name: "Injected" }, { name: "WalletConnect" }, { name: "Coinbase Wallet" },
    { name: "Binance Wallet" }, { name: SYNTHETIC_WALLET_NAME }];
  // Execute a small owned fixture, never downloaded production source.
  const before = Function("r", "_0e", "return " + expression)(connectors, 4);
  const after = Function("r", "_0e", "return " + replaceUniqueConnectorLimit(expression))(connectors, 4);
  assert.equal(before.length, 4);
  assert.equal(after[4], connectors[4]);
  assert.equal(after[0].name, "Browser Wallet");
});

test("a missing, renamed or repeated connector expression cannot be patched", () => {
  for (const source of ["", null, expression.replace("_0e", "changed"), expression + expression]) {
    assert.throws(() => replaceUniqueConnectorLimit(source));
  }
});

test("patching refuses unrecognized bytes even when the expression looks correct", () => {
  const bytes = Buffer.alloc(2026768, " "); bytes.write(expression);
  assert.throws(() => patchPinnedConnectorAsset(EXPERIMENT_URL, bytes), /Unrecognized/);
  assert.throws(() => patchPinnedConnectorAsset(EXPERIMENT_URL, Buffer.from(expression)), /Unrecognized/);
  assert.throws(() => patchPinnedConnectorAsset(EXPERIMENT_URL + "?override=1", bytes), /Unrecognized/);
});

test("interception refuses redirects, wrong URLs and repeated replacements before requesting body", async () => {
  for (const [event, evidence] of [
    [{ request: { url: EXPERIMENT_URL }, responseStatusCode: 302 }, { status: "pending" }],
    [{ request: { url: "https://example.org/app.js" }, responseStatusCode: 200 }, { status: "pending" }],
    [{ request: { url: EXPERIMENT_URL }, responseStatusCode: 200 }, { status: "applied" }],
  ]) {
    let called = false;
    await assert.rejects(fulfillConnectorExperiment(event, async () => { called = true; }, evidence));
    assert.equal(called, false);
  }
});

test("unknown intercepted content is never fulfilled or marked applied", async () => {
  const calls = [], evidence = { status: "pending" };
  await assert.rejects(fulfillConnectorExperiment({ requestId: "test", request: { url: EXPERIMENT_URL },
    responseStatusCode: 200 }, async method => { calls.push(method); return { body: expression }; }, evidence));
  assert.deepEqual(calls, ["Fetch.getResponseBody"]);
  assert.equal(evidence.status, "refused");
});

test("concurrent duplicate asset responses cannot both enter experimental verification", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [], evidence = { status: "pending" };
  const cmd = async method => { calls.push(method); await gate; return { body: "unknown asset" }; };
  const event = { requestId: "one", request: { url: EXPERIMENT_URL }, responseStatusCode: 200 };
  const first = fulfillConnectorExperiment(event, cmd, evidence);
  const second = fulfillConnectorExperiment({ ...event, requestId: "two" }, cmd, evidence);
  const settled = Promise.allSettled([first, second]);
  try { assert.deepEqual(calls, ["Fetch.getResponseBody"]); }
  finally { release(); await settled; }
});

test("discovery-only selection prefers the announced synthetic wallet; legacy baseline retains its route", () => {
  const snapshot = { buttons: [{ text: "Browser Wallet" }, { text: SYNTHETIC_WALLET_NAME }] };
  assert.equal(selectMockWalletLabel(snapshot, "eip6963-only"), SYNTHETIC_WALLET_NAME);
  assert.equal(selectMockWalletLabel(snapshot, "legacy-and-eip6963"), "Browser Wallet");
});

test("wallet selection refuses duplicate names, disabled buttons and lookalikes", () => {
  for (const buttons of [[{ text: SYNTHETIC_WALLET_NAME }, { text: SYNTHETIC_WALLET_NAME }],
    [{ text: SYNTHETIC_WALLET_NAME, disabled: true }], [{ text: SYNTHETIC_WALLET_NAME + " fake" }],
    [{ text: "MetaMask" }]]) assert.equal(selectMockWalletLabel({ buttons }, "eip6963-only"), null);
});

function experimentRecord() {
  const snapshot = { url: "https://aerodrome.finance/connect", simulationActive: true,
    discovery: "eip6963-only", hasLegacyProvider: false, buttons: [{ text: SYNTHETIC_WALLET_NAME }] };
  return { pageVariant: "local-connector-list-experiment", discovery: "eip6963-only",
    connectorExperiment: { status: "applied", replacements: 1 }, selectedWalletLabel: SYNTHETIC_WALLET_NAME,
    before: { ...snapshot, accounts: [], methods: [] }, afterConnect: snapshot,
    afterSignIn: { ...snapshot, methods: ["wallet_requestPermissions", "personal_sign"],
      accounts: [SYNTHETIC_ACCOUNT], rejections: [{ method: "personal_sign", code: 4001 }] },
    connectClicked: true, signInClicked: true };
}

test("successful counterfactual is never reported as unmodified official compatibility or sign-in", () => {
  const result = summarizeAerodromeProbe(experimentRecord());
  assert.equal(result.diagnosticCompleted, true);
  assert.equal(result.outcome, "experimental-page-signature-rejected");
  assert.equal(result.unmodifiedOfficialConnectionObserved, false);
  assert.equal(result.completedSignIn, false);
});

test("missing patch, wrong route, legacy contamination and missing rejection fail experiment", () => {
  for (const mutate of [r => { delete r.connectorExperiment; }, r => { r.connectorExperiment.status = "pending"; },
    r => { r.connectorExperiment.replacements = 2; }, r => { r.selectedWalletLabel = "Browser Wallet"; },
    r => { r.before.hasLegacyProvider = true; }, r => { r.afterSignIn.rejections = []; },
    r => { r.pageVariant = "unmodified-official"; }, r => { r.pageVariant = "unknown"; }]) {
    const r = experimentRecord(); mutate(r);
    assert.equal(summarizeAerodromeProbe(r).diagnosticCompleted, false);
  }
});

test("unmodified official discovery-only UI can now select its synthetic announced wallet", () => {
  const r = experimentRecord(); r.pageVariant = "unmodified-official"; delete r.connectorExperiment;
  const result = summarizeAerodromeProbe(r);
  assert.equal(result.diagnosticCompleted, true);
  assert.equal(result.unmodifiedOfficialConnectionObserved, true);
});
