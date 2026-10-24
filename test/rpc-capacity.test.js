import test from "node:test";
import assert from "node:assert/strict";
import { createRpcCapacity, RPC_CAPACITY } from "../src/rpc-capacity.js";

test("native capacity starts empty and exposes immutable bounded defaults", () => {
  const pool = createRpcCapacity();
  assert.deepEqual(pool.state(), { pending: 0, waiting: 0, abandoned: 0,
    occupiedProviders: 0, perProvider: 32, perPage: 96 });
  assert(Object.isFrozen(pool));
  assert(Object.isFrozen(pool.state()));
  assert(Object.isFrozen(RPC_CAPACITY));
  assert.deepEqual(Object.keys(pool), ["acquire", "state"]);
});

for (const value of [0, -1, 33, Infinity, NaN, 1.5, "4", null, false]) {
  test("invalid per-provider capacity rejected: " + String(value), () => {
    assert.throws(() => createRpcCapacity({ perProvider: value }), TypeError);
  });
}
for (const value of [0, -1, 31, 97, Infinity, NaN, 32.5, "96", null, false]) {
  test("invalid per-page capacity rejected: " + String(value), () => {
    assert.throws(() => createRpcCapacity({ perPage: value }), TypeError);
  });
}
for (const provider of [undefined, null, true, false, 0, 1, "wallet", Symbol("wallet")]) {
  test("primitive identity cannot hold a transport lease: " + String(provider), () => {
    const pool = createRpcCapacity();
    assert.throws(() => pool.acquire(provider), TypeError);
    assert.equal(pool.state().pending, 0);
  });
}

test("one provider cannot acquire the 33rd unresolved request", () => {
  const pool = createRpcCapacity();
  const provider = {};
  const leases = Array.from({ length: 32 }, () => pool.acquire(provider));
  assert(leases.every(Boolean));
  assert.equal(pool.acquire(provider), null);
  assert.deepEqual(pool.state(), { pending: 32, waiting: 32, abandoned: 0,
    occupiedProviders: 1, perProvider: 32, perPage: 96 });
  for (const lease of leases) lease.release();
  assert.equal(pool.state().pending, 0);
});

test("three independent providers fill the page without leaking their identities", () => {
  const pool = createRpcCapacity();
  const leases = [];
  for (const name of ["DAT", "EMA", "CAWELON"]) {
    const provider = { name, account: "private synthetic address" };
    for (let i = 0; i < 32; i++) leases.push(pool.acquire(provider));
  }
  assert.equal(pool.acquire({}), null);
  assert.equal(pool.state().occupiedProviders, 3);
  assert.equal(pool.state().pending, 96);
  const text = JSON.stringify(pool.state());
  assert(!text.includes("DAT"));
  assert(!text.includes("address"));
  for (const lease of leases) lease.release();
});

test("abandoning a wait does not replenish native capacity", () => {
  const pool = createRpcCapacity({ perProvider: 1, perPage: 2 });
  const provider = {};
  const lease = pool.acquire(provider);
  assert.equal(lease.abandon(), true);
  assert.equal(lease.abandon(), false);
  assert.equal(pool.acquire(provider), null);
  assert.deepEqual(pool.state(), { pending: 1, waiting: 0, abandoned: 1,
    occupiedProviders: 1, perProvider: 1, perPage: 2 });
  assert.equal(lease.release(), true);
  assert.equal(lease.release(), false);
  const replacement = pool.acquire(provider);
  assert(replacement);
  replacement.release();
});

test("repeated release and abandon never decrement another request", () => {
  const pool = createRpcCapacity({ perProvider: 2, perPage: 2 });
  const provider = {};
  const first = pool.acquire(provider);
  const second = pool.acquire(provider);
  first.release();
  for (let i = 0; i < 50; i++) {
    assert.equal(first.release(), false);
    assert.equal(first.abandon(), false);
  }
  assert.equal(pool.state().pending, 1);
  assert.equal(pool.state().waiting, 1);
  assert.equal(pool.state().occupiedProviders, 1);
  second.abandon();
  second.release();
  assert.equal(pool.state().occupiedProviders, 0);
});

test("capacity uses object identity, never untrusted metadata getters", () => {
  let reads = 0;
  const provider = new Proxy({}, { get() { reads++; throw Error("do not read"); } });
  const pool = createRpcCapacity();
  const first = pool.acquire(provider);
  first.abandon();
  first.release();
  assert.equal(reads, 0);
});

test("callable provider objects remain distinct identities", () => {
  const pool = createRpcCapacity({ perProvider: 1, perPage: 2 });
  const one = () => {}, two = () => {};
  const a = pool.acquire(one), b = pool.acquire(two);
  assert(a && b);
  assert.equal(pool.acquire(one), null);
  a.release(); b.release();
});

test("snapshots are detached from later acquire, abandon and release", () => {
  const pool = createRpcCapacity();
  const empty = pool.state();
  const lease = pool.acquire({});
  const active = pool.state();
  lease.abandon();
  const abandoned = pool.state();
  lease.release();
  assert.equal(empty.pending, 0);
  assert.equal(active.pending, 1);
  assert.equal(active.waiting, 1);
  assert.equal(abandoned.abandoned, 1);
  assert.equal(pool.state().pending, 0);
});

for (const providerLimit of [1, 2, 8, 32]) {
  test("mixed-order native settlements preserve count invariants at " + providerLimit, () => {
    const pool = createRpcCapacity({ perProvider: providerLimit, perPage: providerLimit * 2 });
    const providers = [{}, {}];
    const leases = [];
    for (const provider of providers) {
      for (let i = 0; i < providerLimit; i++) leases.push(pool.acquire(provider));
    }
    for (let i = 0; i < leases.length; i += 2) leases[i].abandon();
    let remaining = leases.length;
    for (const lease of leases.reverse()) {
      lease.release(); remaining--;
      const state = pool.state();
      assert.equal(state.pending, remaining);
      assert.equal(state.waiting + state.abandoned, state.pending);
      assert(state.occupiedProviders <= state.pending);
      assert(state.waiting >= 0 && state.abandoned >= 0);
    }
    assert.equal(pool.state().occupiedProviders, 0);
  });
}

test("retired lease cannot free capacity for a new lease on the same provider", () => {
  const pool = createRpcCapacity({ perProvider: 1, perPage: 1 });
  const provider = {};
  const first = pool.acquire(provider);
  first.release();
  const next = pool.acquire(provider);
  first.release();
  first.abandon();
  assert.equal(pool.acquire(provider), null);
  next.release();
  assert.equal(pool.state().pending, 0);
});

test("page capacity cannot be bypassed by replacing all provider objects", () => {
  const pool = createRpcCapacity({ perProvider: 1, perPage: 4 });
  const leases = Array.from({ length: 4 }, () => pool.acquire({}));
  for (const lease of leases) lease.abandon();
  for (let i = 0; i < 20; i++) assert.equal(pool.acquire({}), null);
  assert.equal(pool.state().abandoned, 4);
  leases[2].release();
  const next = pool.acquire({});
  assert(next);
  assert.equal(pool.state().pending, 4);
  for (const lease of leases) lease.release();
  next.release();
});

test("null-prototype and frozen providers do not require mutation", () => {
  const pool = createRpcCapacity();
  const providers = [Object.create(null), Object.freeze({}), Object.seal({})];
  for (const provider of providers) {
    const before = Reflect.ownKeys(provider);
    const lease = pool.acquire(provider);
    assert.deepEqual(Reflect.ownKeys(provider), before);
    lease.release();
  }
});
