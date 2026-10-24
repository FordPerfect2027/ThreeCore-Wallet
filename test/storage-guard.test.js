import test from "node:test";
import assert from "node:assert/strict";
import { createStorageGuard, STORAGE_STATUS_SCHEMA } from "../src/storage-guard.js";
import { microtasks, code, invariant } from "./helpers/storage-guard-fixtures.js";

function setup(t) {
  const guard = createStorageGuard();
  const calls = [];
  const leases = [];
  t.after(() => {
    guard.dispose();
    for (const lease of leases) lease.finish();
  });
  return {
    guard,
    calls,
    leases,
    acquire(fn = reason => calls.push(reason)) {
      const lease = guard.acquire(fn);
      leases.push(lease);
      return lease;
    },
  };
}

test("guard begins with no storage effects and a frozen aggregate snapshot", t => {
  const f = setup(t);
  const state = invariant(f.guard, assert);
  assert.equal(state.schema, STORAGE_STATUS_SCHEMA);
  assert.equal(state.active, 0);
  assert.equal(state.canStart, true);
  assert(Object.isFrozen(state));
  assert.deepEqual(f.calls, []);
});

test("one page admits four outstanding operations and refuses a fifth", t => {
  const f = setup(t);
  for (let index = 0; index < 4; index++) f.acquire();
  assert.equal(f.guard.state().opening, 4);
  assert.equal(f.guard.state().canStart, false);
  assert.throws(() => f.acquire(), code("CHECKPOINT_BUSY"));
  assert.equal(f.guard.state().rejected, 1);
  assert.equal(f.guard.state().accepted, 4);
  assert.equal(f.calls.length, 0);
});

test("stopped native operations hold their capacity until explicit completion", t => {
  const f = setup(t);
  for (let index = 0; index < 4; index++) f.acquire().phase("writing");
  assert.equal(f.guard.cancelAll(), 4);
  assert.equal(f.guard.state().draining, 4);
  assert.throws(() => f.acquire(), code("CHECKPOINT_BUSY"));
  f.leases[0].finish({ late: true });
  assert.equal(f.guard.state().active, 3);
  assert.equal(f.guard.state().canStart, true);
  f.acquire();
  assert.equal(f.guard.state().active, 4);
});

for (const phase of ["opening", "reading", "writing"]) {
  test("phase transition remains reflected without changing capacity: " + phase, t => {
    const f = setup(t);
    const lease = f.acquire();
    assert.equal(lease.phase(phase), true);
    const state = invariant(f.guard, assert);
    assert.equal(state.active, 1);
    assert.equal(state[phase], 1);
    assert.equal(state.accepted, 1);
  });
}

for (const phase of ["draining", "done", "", null, {}, 1]) {
  test("untrusted phase cannot inject display state: " + String(phase), t => {
    const f = setup(t);
    const lease = f.acquire();
    assert.throws(() => lease.phase(phase), code("CHECKPOINT_ADAPTER"));
    assert.equal(f.guard.state().opening, 1);
  });
}

for (const [reason, counter] of [
  ["CHECKPOINT_CANCELLED", "cancelled"],
  ["CHECKPOINT_TIMEOUT", "timedOut"],
  ["CHECKPOINT_CLOSED", "cancelled"],
  ["CHECKPOINT_ABORTED", "cancelled"],
  ["CHECKPOINT_CLOCK", "failed"],
  ["CHECKPOINT_TIMER", "failed"],
  ["CHECKPOINT_STORAGE", "failed"],
]) {
  test("stop records one terminal classification: " + reason, t => {
    const f = setup(t);
    const lease = f.acquire();
    assert.equal(lease.stop(reason), true);
    assert.equal(lease.stop(reason), false);
    assert.equal(f.guard.state()[counter], 1);
    assert.equal(lease.phase("reading"), false);
    assert.deepEqual(f.calls, [reason]);
    lease.finish({ late: true });
    assert.equal(f.guard.state()[counter], 1);
    assert.equal(f.guard.state().failed, counter === "failed" ? 1 : 0);
    assert.equal(f.guard.state().late, 1);
  });
}

test("normal completion is counted once even if native events repeat", t => {
  const f = setup(t);
  const lease = f.acquire();
  assert.equal(lease.finish({ success: true }), true);
  assert.equal(lease.finish({ success: true }), false);
  assert.equal(lease.stop(), false);
  assert.equal(f.guard.state().completed, 1);
  assert.equal(f.guard.state().active, 0);
  assert.deepEqual(f.calls, []);
});

test("native completion after a queued-write cancellation records uncertainty", t => {
  const f = setup(t);
  const lease = f.acquire();
  lease.phase("writing");
  lease.stop();
  lease.finish({ late: true, uncertain: true });
  const state = f.guard.state();
  assert.equal(state.cancelled, 1);
  assert.equal(state.completed, 0);
  assert.equal(state.uncertain, 1);
  assert.equal(state.late, 1);
});

test("cancellation closes admission before invoking callbacks", t => {
  const f = setup(t);
  const results = [];
  f.acquire(() => {
    results.push(f.guard.state().canStart);
    assert.throws(() => f.acquire(), code("CHECKPOINT_BUSY"));
  });
  f.guard.cancelAll();
  assert.deepEqual(results, [false]);
  assert.equal(f.guard.state().accepted, 1);
});

test("a reentrant cancellation cannot notify the same operation twice", t => {
  const f = setup(t);
  let nested;
  f.acquire(() => { nested = f.guard.cancelAll(); });
  assert.equal(f.guard.cancelAll(), 1);
  assert.equal(nested, 0);
  assert.equal(f.guard.state().cancelled, 1);
});

test("callbacks can release their slot while cancellation visits peers", t => {
  const f = setup(t);
  let first;
  first = f.acquire(() => first.finish());
  f.acquire();
  assert.equal(f.guard.cancelAll(), 2);
  assert.equal(f.guard.state().active, 1);
  assert.equal(f.guard.state().draining, 1);
  invariant(f.guard, assert);
});

test("one throwing cancellation callback cannot stop protection of peers", t => {
  const f = setup(t);
  f.acquire(() => { throw Error("private adapter details"); });
  f.acquire();
  assert.equal(f.guard.cancelAll(), 2);
  assert.deepEqual(f.calls, ["CHECKPOINT_CANCELLED"]);
  assert.equal(f.guard.state().draining, 2);
});

test("rejected asynchronous cancellation callbacks are consumed", async t => {
  const f = setup(t);
  f.acquire(async () => { throw Error("private"); });
  assert.equal(f.guard.cancelAll(), 1);
  await microtasks();
  assert.equal(f.guard.state().cancelled, 1);
});

test("clock fault is sticky across completed operations", t => {
  const f = setup(t);
  const lease = f.acquire();
  f.guard.tripClock();
  lease.finish();
  assert.equal(f.guard.state().clockFault, true);
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.guard.state().canStart, false);
  assert.throws(() => f.acquire(), code("CHECKPOINT_CLOCK"));
});

test("disposal cancels all outstanding work but retains native capacity evidence", t => {
  const f = setup(t);
  f.acquire();
  f.acquire();
  f.guard.dispose();
  f.guard.dispose();
  const state = f.guard.state();
  assert.equal(state.disposed, true);
  assert.equal(state.draining, 2);
  assert.equal(state.cancelled, 2);
  assert.throws(() => f.acquire(), code("CHECKPOINT_CLOSED"));
});

test("observers receive a coherent frozen state on a microtask", async t => {
  const f = setup(t);
  const seen = [];
  const stop = f.guard.subscribe(value => seen.push(value));
  const lease = f.acquire();
  lease.phase("writing");
  assert.equal(seen.length, 0);
  await microtasks();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].writing, 1);
  assert(Object.isFrozen(seen[0]));
  stop();
  lease.stop();
  await microtasks();
  assert.equal(seen.length, 1);
});

test("unsubscribing during notification excludes the removed observer", async t => {
  const f = setup(t);
  let called = 0;
  let remove;
  f.guard.subscribe(() => remove());
  remove = f.guard.subscribe(() => called++);
  f.acquire();
  await microtasks();
  assert.equal(called, 0);
});

test("observer errors are contained without hiding updates from other observers", async t => {
  const f = setup(t);
  let called = 0;
  f.guard.subscribe(() => { throw Error("private"); });
  f.guard.subscribe(async () => { throw Error("private async"); });
  f.guard.subscribe(() => called++);
  f.acquire();
  await microtasks();
  assert.equal(called, 1);
});

test("there is no unbounded observer registration", t => {
  const f = setup(t);
  const removals = Array.from({ length: 16 }, () => f.guard.subscribe(() => {}));
  assert.throws(() => f.guard.subscribe(() => {}), code("CHECKPOINT_ADAPTER"));
  removals[0]();
  const remove = f.guard.subscribe(() => {});
  remove();
});

test("two pages use independent guards and cannot release each other's slots", t => {
  const a = setup(t);
  const b = setup(t);
  a.acquire();
  b.acquire();
  a.guard.cancelAll();
  assert.equal(a.guard.state().draining, 1);
  assert.equal(b.guard.state().opening, 1);
  assert.equal(b.guard.state().cancelled, 0);
});

for (const value of [null, false, 1, "secret", {}]) {
  test("invalid subscription and stop callbacks are rejected: " + String(value), t => {
    const f = setup(t);
    assert.throws(() => f.guard.acquire(value), code("CHECKPOINT_ADAPTER"));
    assert.throws(() => f.guard.subscribe(value), code("CHECKPOINT_ADAPTER"));
    assert.equal(f.guard.state().active, 0);
  });
}

test("the status contains only fixed field names and bounded scalars", t => {
  const f = setup(t);
  const secret = "0x123 address private-key database filename";
  f.acquire(() => secret).stop();
  const text = JSON.stringify(f.guard.state());
  assert(!text.includes("private"));
  assert(!text.includes("database"));
  assert(!text.includes("filename"));
  assert.equal(Object.values(f.guard.state()).some(value => typeof value === "object"), false);
});
