import test from "node:test";
import assert from "node:assert/strict";
import { createWalletChoiceRegistry } from "../src/experimental-wallet-choices.js";
import { createWalletLifecycleHarness } from "../src/experimental-wallet-lifecycle.js";

// All scenarios operate on a synthetic connector store with no RPC capability.
function setup() {
  const registry = createWalletChoiceRegistry();
  let permissions = 0, failure = "none";
  const provider = {};
  const a = { uid: "a", name: "One", getProvider: async () => provider,
    async connect() { permissions++; return { accounts: ["a"] }; } };
  const b = { uid: "b", name: "Other", getProvider: async () => ({}),
    async connect() { permissions++; return { accounts: ["b"] }; } };
  let rows = [a, b];
  // Deliberately omit notifications: the harness must protect stale choices.
  const store = { subscribe() {},
    setState(next) {
      if (failure === "before") throw Error("store rejected");
      if (failure !== "noop") rows = next;
      if (failure === "after") throw Error("subscriber failed after mutation");
    },
  };
  const config = { get connectors() { return rows; }, _internal: { connectors: store } };
  const harness = createWalletLifecycleHarness(registry);
  const old = harness.map(rows, 0, config)[0];
  return { harness, registry, old, a,
    setFailure(value) { failure = value; },
    get rows() { return rows; }, get permissions() { return permissions; } };
}

test("pre-write store rejection preserves entry and permits fresh retry, not stale connect", async () => {
  const f = setup(); f.setFailure("before");
  assert.throws(() => f.harness.remove("a"), /store rejected/);
  assert.deepEqual(f.rows.map(x => x.uid), ["a", "b"]);
  await assert.rejects(() => f.old.connect(), /stale|removed/);
  f.setFailure("none"); f.harness.remove("a");
  assert.deepEqual(f.rows.map(x => x.uid), ["b"]);
  f.harness.restore("a");
  assert.deepEqual(f.rows.map(x => x.uid), ["b", "a"]);
  assert.equal(f.permissions, 0);
});

test("post-write subscriber failure tracks actual removal and supports explicit recovery", async () => {
  const f = setup(); f.setFailure("after");
  assert.throws(() => f.harness.remove("a"), /subscriber failed/);
  assert.deepEqual(f.rows.map(x => x.uid), ["b"]);
  await assert.rejects(() => f.old.connect(), /stale|removed/);
  f.setFailure("none"); f.harness.restore("a");
  assert.deepEqual(f.rows.map(x => x.uid), ["b", "a"]);
  assert.equal(f.permissions, 0);
});

test("failed restoration retains or clears the recovery ledger according to actual store", async () => {
  for (const mode of ["before", "after"]) {
    const f = setup(); f.harness.remove("a");
    f.setFailure(mode); assert.throws(() => f.harness.restore("a"));
    assert.equal(f.rows.some(x => x === f.a), mode === "after");
    await assert.rejects(() => f.old.connect(), /stale|removed/);
    f.setFailure("none");
    if (mode === "before") f.harness.restore("a");
    else assert.throws(() => f.harness.restore("a"), /Cannot restore/);
    assert.equal(f.rows.some(x => x === f.a), true);
    assert.equal(f.permissions, 0);
  }
});

test("silent no-op store update fails closed and never authorizes removed callback", async () => {
  const f = setup(); f.setFailure("noop");
  assert.throws(() => f.harness.remove("a"), /did not take effect/);
  assert.deepEqual(f.rows.map(x => x.uid), ["a", "b"]);
  await assert.rejects(() => f.old.connect(), /stale|removed/);
  f.setFailure("none"); f.harness.remove("a");
  assert.equal(f.rows.some(x => x === f.a), false);
  assert.equal(f.permissions, 0);
});

test("successful removal without store notifications still invalidates cached selections", async () => {
  const f = setup(); f.harness.remove("a");
  await assert.rejects(() => f.old.connect(), /stale|removed/);
  assert.equal(f.permissions, 0);
});
