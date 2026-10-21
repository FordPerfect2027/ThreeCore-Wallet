import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDiscoveryTrace } from "../src/external-dapp-report.js";
import { inspectPublicAppScripts } from "../scripts/inspect-dapp-discovery.js";
import { createHash } from "node:crypto";

function observation() {
  const before = [
    { sequence: 1, phase: "page-load", kind: "announcement" },
    { sequence: 2, phase: "page-load", kind: "discovery-request" },
    { sequence: 3, phase: "page-load", kind: "announcement" },
    { sequence: 4, phase: "page-load", kind: "rpc", method: "eth_accounts" },
  ];
  const rediscovery = [...before,
    { sequence: 5, phase: "explicit-rediscovery", kind: "discovery-request" },
    { sequence: 6, phase: "explicit-rediscovery", kind: "announcement" }];
  return { discovery: "eip6963-only", before: { trace: before, hasLegacyProvider: false, text: "Browser Wallet" },
    afterRediscovery: { trace: rediscovery }, afterConnect: { trace: rediscovery }, connectClicked: true, secondConnectClicked: true };
}
test("diagnoses discovery and permission as distinct stages", () => {
  const result = summarizeDiscoveryTrace(observation());
  assert.equal(result.status, "discovered-but-no-permission-request");
  assert.equal(result.dappRequestedDiscovery, true);
  assert.equal(result.preClickAccountProbe, true);
  assert.equal(result.rediscoveryAnswered, true);
  assert.equal(result.syntheticNameVisible, false);
  assert.equal(result.externalRoutingCauseProvenByTraceAlone, false);
});
test("an initial announcement alone cannot prove discovery was handled", () => {
  const r = observation(); r.before.trace = r.before.trace.slice(0, 1);
  assert.equal(summarizeDiscoveryTrace(r).status, "insufficient-discovery-evidence");
});
test("a post-click account query cannot be relabelled as a pre-click readiness check", () => {
  const r = observation(); r.before.trace[3].phase = "browser-wallet-click";
  assert.equal(summarizeDiscoveryTrace(r).preClickAccountProbe, false);
  assert.equal(summarizeDiscoveryTrace(r).status, "insufficient-discovery-evidence");
});
test("permission-only requests are recognized after rediscovery", () => {
  const r = observation(); r.afterConnect.trace = [...r.afterConnect.trace,
    { kind: "rpc", method: "wallet_requestPermissions", phase: "second-browser-wallet-click" }];
  assert.equal(summarizeDiscoveryTrace(r).status, "permission-request-observed");
});
test("missing second click or unanswered rediscovery cannot establish the diagnostic", () => {
  for (const key of ["secondConnectClicked", "afterRediscovery"]) {
    const r = observation(); delete r[key];
    assert.equal(summarizeDiscoveryTrace(r).status, "insufficient-discovery-evidence");
  }
});
test("legacy availability and a full trace buffer rule out the discovery-only diagnosis", () => {
  const r = observation(); r.before.hasLegacyProvider = true;
  assert.equal(summarizeDiscoveryTrace(r).status, "insufficient-discovery-evidence");
  r.before.hasLegacyProvider = false;
  r.afterConnect.trace = Array.from({ length: 200 }, () => ({ kind: "announcement" }));
  assert.equal(summarizeDiscoveryTrace(r).status, "insufficient-discovery-evidence");
});
test("missing observations remain unknown", () => {
  const r = summarizeDiscoveryTrace({});
  assert.equal(r.status, "insufficient-discovery-evidence");
  assert.equal(r.syntheticNameVisible, null);
});

test("source inspection fetches only exact-origin JS assets and rejects redirects", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    return new Response('const name = "Browser Wallet";');
  });
  const output = await inspectPublicAppScripts([
    "https://aerodrome.finance/assets/app.js", "https://aerodrome.finance/assets/app.js",
    "https://aerodrome.finance.evil.example/app.js", "http://aerodrome.finance/app.js",
    "https://aerodrome.finance:8443/app.js", "https://user:password@aerodrome.finance/app.js",
    "https://aerodrome.finance/api", "invalid",
  ]);
  assert.deepEqual(calls, ["https://aerodrome.finance/assets/app.js"]);
  assert.equal(output[0].sha256, createHash("sha256").update('const name = "Browser Wallet";').digest("hex"));
  assert.equal(output[0].excerpts[0].pattern, "Browser Wallet");
});
test("failed source fetches are recorded rather than interpreted as routing evidence", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  const result = await inspectPublicAppScripts(["https://aerodrome.finance/assets/app.js"]);
  assert.equal(result[0].error, "HTTP 503");
  assert.equal(result[0].excerpts, undefined);
});
test("source inspection bounds the number and size of assets", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(new Uint8Array(6 * 1024 * 1024 + 1));
  });
  const result = await inspectPublicAppScripts(["https://aerodrome.finance/large.js"]);
  assert.equal(result[0].error, "Asset exceeds diagnostic limit");
  t.mock.restoreAll();
  calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("// empty"); });
  await inspectPublicAppScripts(Array.from({ length: 30 }, (_, i) => "https://aerodrome.finance/" + i + ".js"));
  assert.equal(calls, 24);
});
