import test from "node:test";
import assert from "node:assert/strict";
import { guardFixture, prepared, PRIVATE, assertPrivate } from "./helpers/export-fixtures.js";

const code = (action, expected) => assert.throws(action, error => error.code === expected);

for (const outcome of ["false", "throw", "promise", "reject", "then-getter"]) {
  test("unconfirmed release keeps its quota and blocks new offers: " + outcome, async () => {
    let broken = true, releases = 0;
    const f = guardFixture({ createResource: () => ({
      activate() {},
      release() {
        releases++;
        if (!broken) return true;
        if (outcome === "false") return false;
        if (outcome === "throw") throw Error(PRIVATE);
        if (outcome === "promise") return Promise.resolve(true);
        if (outcome === "reject") return Promise.reject(Error(PRIVATE));
        return Object.defineProperty({}, "then", { get() { throw Error(PRIVATE); } });
      },
    }) });
    f.offer();
    f.expire();
    assert.equal(f.guard.state().active, 1);
    assert.equal(f.guard.state().reservedBytes, 16);
    assert.equal(f.guard.state().pendingCleanup, 1);
    assert.equal(f.guard.state().cleanupBlocked, true);
    assert.equal(f.guard.state().released, 0);
    assertPrivate(assert, f.guard.state());
    code(() => f.offer(), "EXPORT_CLEANUP");
    assert.equal(releases, 1);
    broken = false;
    assert.equal(f.guard.retryCleanup(), true);
    assert.equal(f.guard.state().active, 0);
    assert.equal(f.guard.state().released, 1);
    assert.equal(f.guard.retryCleanup(), true);
    assert.equal(releases, 2);
    await new Promise(resolve => setImmediate(resolve));
  });
}

test("one broken release cannot prevent cleanup of the other three leases", () => {
  let index = 0;
  const released = [];
  const f = guardFixture({ createResource() {
    const id = index++;
    return { activate() {}, release() { released.push(id); return id !== 1; } };
  } });
  for (let i = 0; i < 4; i++) f.offer();
  assert.equal(f.guard.clear(), false);
  assert.deepEqual(released, [0, 1, 2, 3]);
  assert.equal(f.guard.state().active, 1);
  assert.equal(f.guard.state().released, 3);
  assert.equal(f.guard.state().reservedBytes, 16);
});

test("release can be retried after disposal without reopening admission", () => {
  let broken = true;
  const f = guardFixture({ createResource: () => ({ activate() {}, release: () => !broken }) });
  f.offer(); f.guard.dispose();
  assert.equal(f.guard.state().active, 1);
  broken = false;
  assert.equal(f.guard.retryCleanup(), true);
  assert.equal(f.guard.state().active, 0);
  code(() => f.offer(), "EXPORT_DISPOSED");
});

test("release reentering clear is bounded and never releases negative quota", () => {
  const f = guardFixture();
  let releases = 0;
  f.factory(() => ({ activate() {}, release() { releases++; f.guard.clear(); return true; } }));
  f.offer();
  assert.equal(f.guard.clear(), true);
  assert.equal(releases, 1);
  assert.equal(f.guard.state().released, 1);
  assert.equal(f.guard.state().reservedBytes, 0);
});

test("clear prevents a release callback from creating a replacement download", () => {
  const f = guardFixture();
  let refused = 0;
  f.factory(() => ({ activate() {}, release() {
    code(() => f.offer(), "EXPORT_BUSY"); refused++; return true;
  } }));
  f.offer();
  assert.equal(f.guard.clear(), true);
  assert.equal(refused, 1);
  assert.equal(f.guard.state().accepted, 1);
});

test("clear prevents observers from replacing a lease during cleanup notification", () => {
  const f = guardFixture();
  f.offer();
  let attempted = false;
  f.guard.subscribe(state => {
    if (state.released && !attempted) {
      attempted = true;
      code(() => f.offer(), "EXPORT_BUSY");
    }
  });
  assert.equal(f.guard.clear(), true);
  assert.equal(attempted, true);
  assert.equal(f.guard.state().accepted, 1);
});

for (const stop of ["clear", "dispose"]) {
  test("factory reentrant " + stop + " closes a resource returned after the stop", () => {
    const f = guardFixture();
    let activated = 0, released = 0;
    f.factory(() => {
      f.guard[stop]();
      assert.equal(f.guard.state().active, 1);
      return { activate() { activated++; }, release() { released++; } };
    });
    code(() => f.offer(), "EXPORT_CANCELLED");
    assert.equal(activated, 0);
    assert(released >= 1);
    assert.equal(f.guard.state().active, 0);
    assert.equal(f.guard.state().offered, 0);
  });

  test("activation reentrant " + stop + " cannot be counted as successful", () => {
    const f = guardFixture();
    let releases = 0;
    f.factory(() => ({ activate() { f.guard[stop](); }, release() { releases++; } }));
    code(() => f.offer(), "EXPORT_CANCELLED");
    assert(releases >= 1);
    assert.equal(f.guard.state().active, 0);
    assert.equal(f.guard.state().failed, 1);
    assert.equal(f.guard.state().offered, 0);
  });
}

test("factory cannot recursively bypass the four-offer admission budget", () => {
  const f = guardFixture();
  f.factory(() => {
    code(() => f.offer(), "EXPORT_BUSY");
    return { activate() {}, release() {} };
  });
  f.offer();
  assert.equal(f.guard.state().accepted, 1);
  assert.equal(f.guard.state().rejected, 1);
  f.guard.clear();
});

test("activation cannot reenter admission even with spare count and bytes", () => {
  const f = guardFixture();
  f.factory(() => ({ activate() { code(() => f.offer(), "EXPORT_BUSY"); }, release() {} }));
  f.offer();
  assert.equal(f.guard.state().accepted, 1);
  f.guard.clear();
});

test("snapshot proxy triggering stop cannot continue allocation", () => {
  const f = guardFixture();
  const input = new Proxy(prepared(), {
    getOwnPropertyDescriptor(target, key) {
      if (key === "text") f.guard.clear();
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  code(() => f.offer(input), "EXPORT_CANCELLED");
  assert.equal(f.resources.length, 0);
  assert.equal(f.guard.state().accepted, 0);
});

test("clock callback triggering disposal before admission cannot create a resource", () => {
  const f = guardFixture({ now() { f.guard.dispose(); return 0; } });
  code(() => f.offer(), "EXPORT_DISPOSED");
  assert.equal(f.resources.length, 0);
});

test("release receiver is preserved when the method relies on its resource", () => {
  const resource = { active: false, activate() { this.active = true; }, release() { this.active = false; } };
  const f = guardFixture({ createResource: () => resource });
  f.offer(); assert.equal(resource.active, true);
  f.guard.clear(); assert.equal(resource.active, false);
});

test("delayed promise activation is rejected and its rejection consumed", async () => {
  const f = guardFixture({ createResource: () => ({
    activate() { return Promise.reject(Error(PRIVATE)); }, release() {},
  }) });
  code(() => f.offer(), "EXPORT_FAILED");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.guard.state().offered, 0);
});

test("promise-returning factories are rejected before any activation", async () => {
  const f = guardFixture({ createResource: () => Promise.reject(Error(PRIVATE)) });
  code(() => f.offer(), "EXPORT_FAILED");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.guard.state().active, 0);
});

test("retry targets only unconfirmed cleanup, not healthy retained downloads", () => {
  let id = 0, broken = true;
  const calls = [0, 0];
  const f = guardFixture({ createResource() {
    const current = id++;
    return { activate() {}, release() { calls[current]++; return current !== 0 || !broken; } };
  } });
  f.offer(); f.clock.advance(100); f.offer();
  f.clock.set(1000); f.clock.due();
  broken = false; f.guard.retryCleanup();
  assert.deepEqual(calls, [2, 0]);
  assert.equal(f.guard.state().active, 1);
  f.guard.clear();
});

test("notification feedback remains bounded when a subscriber clears repeatedly", () => {
  const f = guardFixture();
  let notifications = 0;
  f.guard.subscribe(() => { notifications++; f.guard.clear(); });
  assert.equal(f.offer().offered, true);
  assert(notifications < 20);
  assert.equal(f.guard.state().active, 0);
});
