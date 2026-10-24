import test from "node:test";
import assert from "node:assert/strict";
import { createRpcCapacity } from "../src/rpc-capacity.js";

// Independent abstract model: each accepted request is a row with two flags.
// No production WeakMap counters or release implementation are reproduced here.
function expected(rows, limits) {
  const live = rows.filter(row => !row.released);
  const waiting = live.filter(row => !row.abandoned).length;
  return { pending: live.length, waiting, abandoned: live.length - waiting,
    occupiedProviders: new Set(live.map(row => row.identity)).size, ...limits };
}
function random(seed) {
  let value = seed >>> 0;
  return maximum => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    return (value >>> 0) % maximum;
  };
}

for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597]) {
  test("capacity state-machine trace preserves outstanding work, seed " + seed, () => {
    const choose = random(seed);
    const limits = { perProvider: 1 + choose(6), perPage: 12 };
    const pool = createRpcCapacity(limits);
    const identities = Array.from({ length: 5 }, () => ({}));
    const rows = [];
    const snapshots = [];
    for (let step = 0; step < 400; step++) {
      const action = choose(5);
      if (action < 2 || rows.length === 0) {
        const identity = choose(identities.length);
        const live = rows.filter(row => !row.released);
        const canAcquire = live.length < limits.perPage &&
          live.filter(row => row.identity === identity).length < limits.perProvider;
        const lease = pool.acquire(identities[identity]);
        assert.equal(!!lease, canAcquire, "admission at step " + step);
        if (lease) rows.push({ identity, lease, released: false, abandoned: false });
      } else {
        const row = rows[choose(rows.length)];
        if (action === 2) {
          const changed = !row.released && !row.abandoned;
          assert.equal(row.lease.abandon(), changed);
          if (changed) row.abandoned = true;
        } else if (action === 3) {
          assert.equal(row.lease.release(), !row.released);
          row.released = true; row.abandoned = true;
        } else {
          const value = pool.state();
          snapshots.push({ value, frozen: JSON.stringify(value) });
        }
      }
      assert.deepEqual(pool.state(), expected(rows, limits), "accounting at step " + step);
    }
    for (const row of rows) row.lease.release();
    assert.equal(pool.state().pending, 0);
    assert.equal(pool.state().occupiedProviders, 0);
    for (const { value, frozen } of snapshots) {
      assert(Object.isFrozen(value));
      assert.equal(JSON.stringify(value), frozen);
    }
  });
}

test("all permutations of cancel and completion for three native requests preserve capacity", () => {
  const actions = ["a0", "r0", "a1", "r1", "a2", "r2"];
  function* permutations(items) {
    if (!items.length) { yield []; return; }
    for (let i = 0; i < items.length; i++) {
      for (const tail of permutations(items.filter((_, index) => index !== i))) yield [items[i], ...tail];
    }
  }
  let checked = 0;
  for (const sequence of permutations(actions)) {
    const pool = createRpcCapacity({ perProvider: 2, perPage: 3 });
    const identities = [{}, {}];
    const rows = [0, 0, 1].map(identity => ({ identity, lease: pool.acquire(identities[identity]),
      abandoned: false, released: false }));
    for (const action of sequence) {
      const row = rows[Number(action[1])];
      if (action[0] === "a") {
        row.lease.abandon();
        if (!row.released) row.abandoned = true;
      } else {
        row.lease.release(); row.released = true; row.abandoned = true;
      }
      assert.deepEqual(pool.state(), expected(rows, { perProvider: 2, perPage: 3 }));
    }
    assert.equal(pool.state().pending, 0);
    checked++;
  }
  assert.equal(checked, 720);
});
