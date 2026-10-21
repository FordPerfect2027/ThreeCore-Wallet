import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createWalletChoiceRegistry, makeWalletChoiceRegistrySource } from "../src/experimental-wallet-choices.js";
import { replaceUniqueWalletChoices, patchPinnedConnectorAsset, EXPERIMENT_URL } from "../scripts/aerodrome-connector-experiment.js";
import { parseProbeOptions } from "../scripts/aerodrome-probe-options.js";
const connector = (uid, name, provider = {}) => ({ uid, name, id: "same-self-reported-id", getProvider: async () => provider });

test("same names receive distinct labels bound to the actual provider, not their metadata", async () => {
  const r = createWalletChoiceRegistry(), a = {}, b = {};
  const result = r.map([connector("uid-b", "Same", b), connector("uid-a", "Same", a)], 0);
  assert.notEqual(result[0].name, result[1].name);
  assert.equal(await r.labelForProvider(a), result[1].name);
  assert.equal(await r.labelForProvider(b), result[0].name);
  assert.equal(await r.labelForProvider({}), null);
});

test("empty and whitespace names get explicit unnamed labels without collapsing identities", () => {
  const r = createWalletChoiceRegistry();
  const labels = r.map([connector("a", ""), connector("b", " \t\n ")], 0).map(c => c.name);
  assert.ok(labels.every(l => l.includes("Unnamed wallet") && l.includes("unverified name")));
  assert.notEqual(labels[0], labels[1]);
});

test("reordering, repeated lists and cloned connector records preserve each choice number", async () => {
  const r = createWalletChoiceRegistry(), p = {}, a = connector("a", "Same", p), b = connector("b", "Same");
  const initial = r.map([a, b], 0);
  for (let i = 0; i < 3; i++) {
    const next = r.map([{ ...b }, { ...a }], 0);
    assert.equal(next[1].name, initial[0].name); assert.equal(next[0].name, initial[1].name);
    assert.equal(await r.labelForProvider(p), initial[0].name);
  }
});

test("configured connectors keep their behavior and the browser-wallet display alias", async () => {
  const r = createWalletChoiceRegistry(), configured = connector("configured", "Injected"), p = {};
  const result = r.map([configured, connector("a", "", p)], 1);
  assert.equal(result[0].name, "Browser Wallet");
  assert.equal(result[0].getProvider, configured.getProvider);
  assert.equal(await result[1].getProvider(), p);
});

test("duplicate, missing, configured-colliding and rebound framework identities fail closed", async () => {
  const r = createWalletChoiceRegistry(), a = connector("a", "One"), p = await a.getProvider();
  r.map([a], 0);
  assert.throws(() => r.map([connector("a", "Other")], 0), /rebound/);
  assert.equal(await r.labelForProvider(p), null);
  for (const rows of [[a, a], [connector("", "empty uid")], [{ uid: "b", name: "missing provider" }]]) assert.throws(() => r.map(rows, 0));
  assert.throws(() => r.map([a, { ...a }], 1), /identity/);
});

test("a removed connector cannot be selected and newly discovered connectors never reuse its number", async () => {
  const r = createWalletChoiceRegistry(), p = {}, a = connector("a", "Same", p);
  const label = r.map([a], 0)[0].name;
  const next = r.map([connector("b", "Same")], 0)[0].name;
  assert.notEqual(next, label); assert.equal(await r.labelForProvider(p), null);
});

test("two connector identities resolving to one provider are refused instead of picking the first", async () => {
  const r = createWalletChoiceRegistry(), p = {};
  r.map([connector("a", "A", p), connector("b", "B", p)], 0);
  assert.equal(await r.labelForProvider(p), null);
});

test("a list change during asynchronous provider resolution invalidates the pending selection", async () => {
  const r = createWalletChoiceRegistry(), p = {}; let release;
  r.map([{ uid: "a", name: "Name", getProvider: () => new Promise(resolve => { release = () => resolve(p); }) }], 0);
  const pending = r.labelForProvider(p);
  r.map([], 0); release();
  assert.equal(await pending, null);
});

test("provider failures and malformed lists cannot yield an authorized choice", async () => {
  const r = createWalletChoiceRegistry();
  r.map([{ uid: "a", name: "Name", getProvider: async () => { throw Error("unavailable"); } }], 0);
  assert.equal(await r.labelForProvider({}), null);
  for (const [rows, count] of [[null, 0], [[], -1], [[], 1], [[], 0.5]]) assert.throws(() => r.map(rows, count));
});

test("display names are bounded and strip control/bidi characters without using HTML", () => {
  const r = createWalletChoiceRegistry();
  const label = r.map([connector("a", "\u202e\u0000<img>" + "x".repeat(100))], 0)[0].name;
  assert.ok(!/[\p{C}<>]/u.test(label)); assert.ok(label.length < 100);
  assert.match(label, /^Wallet choice 1:/);
});

test("registry state is bounded across many successive discovery lists", () => {
  const r = createWalletChoiceRegistry();
  for (let i = 0; i < 100; i++) r.map([connector(String(i), "A")], 0);
  assert.throws(() => r.map([connector("overflow", "A")], 0), /Too many/);
  assert.deepEqual(r.choices(), []);
});

test("injected adapter requires the exact official origin and synthetic marker", () => {
  for (const window of [{ location: { origin: "https://example.org" }, __threecoreWalletSimulation: {} },
    { location: { origin: "https://aerodrome.finance" } }]) {
    vm.runInNewContext(makeWalletChoiceRegistrySource(), { window });
    assert.equal(window.__threecoreExperimentalChoices, undefined);
  }
  const window = { location: { origin: "https://aerodrome.finance" }, __threecoreWalletSimulation: {} };
  vm.runInNewContext(makeWalletChoiceRegistrySource(), { window });
  assert.equal(typeof window.__threecoreExperimentalChoices.map, "function");
});

test("the pinned chooser expression is replaced exactly once and unknown kinds are refused", () => {
  const source = 'r.slice(0,_0e).map(o=>o.name==="Injected"?{...o,name:"Browser Wallet"}:o)';
  assert.equal(replaceUniqueWalletChoices(source), "window.__threecoreExperimentalChoices.map(r,_0e,Oc)");
  for (const s of ["", source + source]) assert.throws(() => replaceUniqueWalletChoices(s));
  assert.throws(() => patchPinnedConnectorAsset(EXPERIMENT_URL, Buffer.alloc(0), "unknown"));
});

test("choice experiment requires explicit isolation and cannot be mixed with the old experiment", () => {
  const flags = ["--mock-wallet", "--eip6963-only", "--diagnose-discovery", "--test-wallet-choice-fix", "--scenario=unnamed"];
  assert.equal(parseProbeOptions(flags).choiceExperiment, true);
  for (const omitted of flags.slice(0, 4)) assert.throws(() => parseProbeOptions(flags.filter(f => f !== omitted)));
  assert.throws(() => parseProbeOptions([...flags, "--test-connector-list-fix"]));
  assert.throws(() => parseProbeOptions(flags.filter(f => !f.startsWith("--scenario"))));
});
