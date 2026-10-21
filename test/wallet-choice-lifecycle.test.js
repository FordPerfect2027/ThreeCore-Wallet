import test from "node:test";
import assert from "node:assert/strict";
import { createWalletChoiceRegistry } from "../src/experimental-wallet-choices.js";
import { createWalletLifecycleHarness } from "../src/experimental-wallet-lifecycle.js";
import { parseProbeOptions } from "../scripts/aerodrome-probe-options.js";

function fixture(uid, name = "Same wallet") {
  const state = { requests: 0, accounts: [] }, provider = { uid };
  const connector = { uid, name, id: "same-advertised-id", getProvider: async () => provider,
    async connect() { state.requests++; state.accounts = [uid]; return { accounts: [...state.accounts] }; } };
  return { state, provider, connector };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

for (const name of ["Same wallet", ""]) {
  test(`removed ${JSON.stringify(name)} choice cannot request permission via an old callback`, async () => {
    const r = createWalletChoiceRegistry(), a = fixture("a", name), b = fixture("b", name);
    const [old] = r.map([a.connector, b.connector], 0);
    r.map([b.connector], 0);
    await assert.rejects(() => old.connect(), /stale|removed/i);
    assert.equal(a.state.requests, 0); assert.equal(b.state.requests, 0);
  });
  test(`remove/readd ${JSON.stringify(name)} invalidates the old choice but allows explicit new selection`, async () => {
    const r = createWalletChoiceRegistry(), a = fixture("a", name), b = fixture("b", name);
    const [old] = r.map([a.connector, b.connector], 0);
    r.map([b.connector], 0);
    const restored = r.map([b.connector, a.connector], 0)[1];
    assert.equal(restored.name, old.name);
    await assert.rejects(() => old.connect(), /stale|removed/i);
    assert.deepEqual(await restored.connect(), { accounts: ["a"] });
    assert.equal(a.state.requests, 1); assert.equal(b.state.requests, 0);
  });
}

test("list change while resolving a removed provider prevents any permission request", async () => {
  const r = createWalletChoiceRegistry(), a = fixture("a"), b = fixture("b"), gate = deferred();
  a.connector.getProvider = () => gate.promise;
  const old = r.map([a.connector, b.connector], 0)[0];
  const pending = old.connect(); r.map([b.connector], 0); gate.resolve(a.provider);
  await assert.rejects(pending, /stale|removed/i);
  assert.equal(a.state.requests, 0); assert.equal(b.state.requests, 0);
});

test("a late connector result after removal is rejected and never handed off to another provider", async () => {
  const r = createWalletChoiceRegistry(), a = fixture("a"), b = fixture("b"), entered = deferred(), result = deferred();
  a.connector.connect = async () => { a.state.requests++; entered.resolve(); return result.promise; };
  const old = r.map([a.connector, b.connector], 0)[0], pending = old.connect();
  await entered.promise; r.map([b.connector], 0); result.resolve({ accounts: ["a"] });
  await assert.rejects(pending, /stale|removed/i);
  assert.equal(a.state.requests, 1); assert.equal(b.state.requests, 0);
});

test("addition and reordering keep active callbacks bound to their original connector", async () => {
  const r = createWalletChoiceRegistry(), a = fixture("a"), b = fixture("b"), c = fixture("c");
  const [first, second] = r.map([a.connector, b.connector], 0);
  const next = r.map([c.connector, b.connector, a.connector], 0);
  assert.equal(next[2].name, first.name); assert.equal(next[1].name, second.name);
  assert.deepEqual(await first.connect(), { accounts: ["a"] });
  assert.deepEqual(await second.connect(), { accounts: ["b"] });
  assert.equal(c.state.requests, 0);
});

test("a provider changing behind the same getter is rejected on reconnect", async () => {
  const r = createWalletChoiceRegistry(), a = fixture("a"), b = fixture("b"); let provider = a.provider;
  a.connector.getProvider = async () => provider;
  const choice = r.map([a.connector], 0)[0];
  await choice.connect(); provider = b.provider;
  await assert.rejects(() => choice.connect(), /provider.*changed/i);
  assert.equal(a.state.requests, 1); assert.equal(b.state.requests, 0);
});

test("metadata changes preserve the number but invalidate old displayed choices", async () => {
  const r = createWalletChoiceRegistry(), a = fixture("a");
  const old = r.map([a.connector], 0)[0]; a.connector.name = "Renamed";
  const next = r.map([a.connector], 0)[0];
  assert.equal(r.choices()[0].id, 1); assert.notEqual(old.name, next.name);
  await assert.rejects(() => old.connect(), /stale|removed/i); await next.connect();
  assert.equal(a.state.requests, 1);
});

test("invalid list updates invalidate saved callbacks without calling another connector", async () => {
  const r = createWalletChoiceRegistry(), a = fixture("a"), old = r.map([a.connector], 0)[0];
  assert.throws(() => r.map([a.connector, a.connector], 0));
  await assert.rejects(() => old.connect(), /stale|removed/i); assert.equal(a.state.requests, 0);
});

test("lifecycle fixture updates the subscribed store and invalidates saved callbacks before render", async () => {
  const r = createWalletChoiceRegistry(), h = createWalletLifecycleHarness(r), a = fixture("a"), b = fixture("b");
  let state = [a.connector, b.connector]; const listeners = [];
  const config = { get connectors() { return state; }, _internal: { connectors: { subscribe: fn => listeners.push(fn),
    setState: next => { state = next; listeners.forEach(fn => fn(next)); } } } };
  h.map(state, 0, config); h.capture("a"); h.remove("a");
  assert.deepEqual(r.choices().map(c => c.uid), ["b"]);
  assert.equal((await h.trySavedConnect()).rejected, true);
  h.restore("a"); h.reverse();
  assert.equal((await h.trySavedConnect()).rejected, true);
  assert.equal(r.choices()[0].id, 1); assert.equal(a.state.requests, 0); assert.equal(b.state.requests, 0);
  assert.throws(() => h.remove("missing")); assert.throws(() => h.restore("missing"));
  assert.throws(() => h.map(state, 0, {}));
});

test("lifecycle mode cannot run without explicit choice experiment and mock isolation", () => {
  const args = ["--mock-wallet", "--eip6963-only", "--diagnose-discovery", "--test-wallet-choice-fix", "--scenario=unnamed", "--test-wallet-lifecycle"];
  assert.equal(parseProbeOptions(args).lifecycle, true);
  for (const flag of args.slice(0, 4)) assert.throws(() => parseProbeOptions(args.filter(a => a !== flag)));
});

test("a rediscovered provider with a new UID cannot revive old callbacks or permit duplicate routing", async () => {
  const r = createWalletChoiceRegistry(), a = fixture("a"), b = fixture("b");
  const old = r.map([a.connector, b.connector], 0)[0];
  r.map([b.connector], 0);
  const rediscovered = { ...a.connector, uid: "new-a" };
  const added = r.map([b.connector, rediscovered], 0);
  assert.notEqual(added[1].name, old.name);
  await assert.rejects(() => old.connect(), /stale|removed/i);
  const duplicates = r.map([b.connector, rediscovered, a.connector], 0);
  await assert.rejects(() => duplicates[1].connect(), /ambiguous/i);
  await assert.rejects(() => duplicates[2].connect(), /ambiguous/i);
  assert.equal(a.state.requests, 0); assert.equal(b.state.requests, 0);
  const resolved = r.map([b.connector, a.connector], 0);
  assert.deepEqual(await resolved[1].connect(), { accounts: ["a"] });
  assert.equal(a.state.requests, 1); assert.equal(b.state.requests, 0);
});
