import test from "node:test";
import assert from "node:assert/strict";
import { createWalletChoiceRegistry, makeWalletChoiceRegistrySource } from "../src/experimental-wallet-choices.js";
import { createWalletRecoveryController } from "../src/experimental-wallet-recovery.js";
import { parseProbeOptions } from "../scripts/aerodrome-probe-options.js";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(name = "Same name", timeout = 50) {
  const registry = createWalletChoiceRegistry(), providers = [{}, {}, {}], requests = [];
  const connector = (uid, p) => ({ uid, name, getProvider: async () => providers[p],
    async connect() { requests.push(uid); return { accounts: [uid] }; } });
  const configured = { uid: "configured", name: "Browser Wallet" };
  let rows = [configured, connector("a", 0), connector("duplicate-a", 0), connector("b", 1), connector("c", 2)];
  const old = registry.map(rows, 1);
  let state, writes = 0;
  const access = { configuredCount: 1, rows: () => rows, replace: next => {
    writes++; rows = next; controller.changed(); registry.map(rows, 1);
  } };
  const controller = createWalletRecoveryController(registry, access, timeout);
  controller.subscribe(next => { state = next; });
  return { registry, controller, old, access, providers, requests,
    get rows() { return rows; }, get state() { return state; }, get writes() { return writes; },
    change(next) { access.replace(next); }, async choose() { await controller.scan(); assert.equal(controller.select("a"), true); } };
}
for (const name of ["Same name", "", " \t "]) {
  test(`recovery groups exact providers, preserves distinct ${JSON.stringify(name)} wallets and requires fresh selection`, async () => {
    const f = setup(name); await f.choose();
    assert.deepEqual(f.state.groups.map(g => g.map(c => c.uid)), [["a", "duplicate-a"]]);
    assert.equal(await f.controller.apply(), true);
    assert.deepEqual(f.rows.map(c => c.uid), ["configured", "a", "b", "c"]);
    assert.deepEqual(f.requests, []); assert.equal(f.state.status, "done");
    await assert.rejects(() => f.old[1].connect(), /stale|removed/i);
    await f.registry.map(f.rows, 1)[1].connect(); assert.deepEqual(f.requests, ["a"]);
  });
}
test("closing a selected review performs no cleanup or connection", async () => {
  const f = setup(); await f.choose(); f.controller.close();
  assert.equal(await f.controller.apply(), false); assert.equal(f.writes, 0); assert.deepEqual(f.requests, []);
});
test("store changes clear the selected review and require a fresh choice", async () => {
  const f = setup(); await f.choose(); f.change([f.rows[0], ...f.rows.slice(1).reverse()]);
  assert.equal(f.state.status, "changed"); assert.equal(await f.controller.apply(), false);
  await f.choose(); assert.equal(await f.controller.apply(), true); assert.deepEqual(f.requests, []);
});
test("silent connector metadata mutation is refused before cleanup", async () => {
  for (const key of ["name", "uid", "getProvider", "connect"]) {
    const f = setup(); await f.choose(); f.rows[1][key] = key === "name" || key === "uid" ? "changed" : () => ({});
    assert.equal(await f.controller.apply(), false, key); assert.equal(f.writes, 0, key); assert.deepEqual(f.requests, []);
  }
});
test("changed provider behind the same getter cannot remove an entry", async () => {
  const f = setup(); await f.choose(); f.providers[0] = {};
  assert.equal(await f.controller.apply(), false); assert.equal(f.writes, 0); assert.equal(f.state.status, "error");
});
test("unresponsive review times out and late completion cannot replace its error", async () => {
  const f = setup("Same", 10), gate = deferred(); f.rows[1].getProvider = () => gate.promise;
  // Use a new UID for this deliberately altered fixture, so rebinding is not allowed.
  f.rows[1].uid = "new-a"; f.registry.map(f.rows, 1);
  await f.controller.scan(); assert.equal(f.state.status, "error"); assert.match(f.state.message, /timed out/);
  gate.resolve(f.providers[0]); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.state.status, "error"); assert.equal(f.writes, 0); assert.deepEqual(f.requests, []);
});
test("closing while review is pending ignores the late result", async () => {
  const f = setup(), gate = deferred(); f.rows[1].uid = "new-a"; f.rows[1].getProvider = () => gate.promise; f.registry.map(f.rows, 1);
  const pending = f.controller.scan(); f.controller.close(); gate.resolve(f.providers[0]); await pending;
  assert.equal(f.state.status, "closed"); assert.equal(f.writes, 0);
});
test("changing the list during review rejects the pending result", async () => {
  const f = setup(), gate = deferred(); f.rows[1].uid = "new-a"; f.rows[1].getProvider = () => gate.promise; f.registry.map(f.rows, 1);
  const pending = f.controller.scan(); f.change(f.rows.filter(c => c.uid !== "new-a")); gate.resolve(f.providers[0]); await pending;
  assert.equal(f.state.status, "changed"); assert.equal(f.state.groups.length, 0); assert.deepEqual(f.requests, []);
});
test("double apply does not write twice or request permissions", async () => {
  const f = setup(); await f.choose(); const pending = f.controller.apply();
  assert.equal(await f.controller.apply(), false); assert.equal(await pending, true);
  assert.equal(f.writes, 1); assert.deepEqual(f.requests, []);
});
test("close during apply cancels cleanup before the final provider check", async () => {
  const f = setup(); await f.choose(); const pending = f.controller.apply(); f.controller.close();
  assert.equal(await pending, false); assert.equal(f.writes, 0); assert.equal(f.state.status, "closed");
});
test("an unresponsive final check times out without deleting a connector", async () => {
  const f = setup("Same", 10); await f.choose(); f.providers[0] = new Promise(() => {});
  assert.equal(await f.controller.apply(), false); assert.equal(f.state.status, "error");
  assert.equal(f.writes, 0); assert.deepEqual(f.requests, []);
});
test("a new list arriving during apply cancels the selected cleanup", async () => {
  const f = setup(); await f.choose(); const pending = f.controller.apply(); f.change([f.rows[0], ...f.rows.slice(1).reverse()]);
  assert.equal(await pending, false); assert.equal(f.writes, 1); assert.equal(f.rows.length, 5);
});
test("distinct providers and unknown selections cannot be removed", async () => {
  const f = setup(); await f.controller.scan();
  for (const uid of ["b", "c", "configured", "missing"]) assert.equal(f.controller.select(uid), false);
  assert.equal(await f.controller.apply(), false); assert.equal(f.writes, 0);
});
test("review after cleanup reports no duplicates and cannot silently connect", async () => {
  const f = setup(); await f.choose(); await f.controller.apply(); await f.controller.scan();
  assert.equal(f.state.groups.length, 0); assert.equal(f.state.status, "ready"); assert.equal(await f.controller.apply(), false);
  assert.deepEqual(f.requests, []);
});
test("failed store write gives a recoverable error with invalidated old callbacks", async () => {
  const f = setup(); await f.choose(); f.access.replace = () => { throw Error("store failed"); };
  assert.equal(await f.controller.apply(), false); assert.equal(f.state.status, "error");
  await assert.rejects(() => f.old[1].connect(), /stale|removed/i); assert.deepEqual(f.requests, []);
});
test("invalidated registry cannot be misreported as an empty duplicate review", async () => {
  const f = setup(); f.registry.invalidateChoices(); await f.controller.scan();
  assert.equal(f.state.status, "error"); assert.equal(f.writes, 0);
});
test("recovery UI requires explicit mock, isolation, choice and lifecycle opt-ins", () => {
  const args = ["--mock-wallet", "--eip6963-only", "--diagnose-discovery", "--test-wallet-choice-fix", "--scenario=unnamed", "--test-wallet-lifecycle", "--test-wallet-recovery-ui"];
  assert.equal(parseProbeOptions(args).recovery, true);
  for (const flag of args.slice(0, 6)) assert.throws(() => parseProbeOptions(args.filter(a => a !== flag)));
  assert.throws(() => makeWalletChoiceRegistrySource({ recovery: true }));
});
