import test from "node:test";
import assert from "node:assert/strict";
import { createSecurityLock } from "../src/security-lock.js";
import { fakeClock, flush } from "./helpers/access-lifecycle.js";

const defects = {
  throwing() { throw Error("timer unavailable"); },
  null: () => null,
  undefined: () => undefined,
  synchronous(fn) { fn(); return 123; },
  fulfilled: () => Promise.resolve(123),
  rejected: () => Promise.reject(Error("private timer rejection")),
  pending: () => new Promise(() => {}),
  accessor: () => Object.defineProperty({}, "then", { get() { throw Error("private accessor"); } }),
};

for (const phase of ["initial", "activity", "resume", "configure", "early-fire"]) {
  for (const [kind, defect] of Object.entries(defects)) {
    test(`timer ${kind} at ${phase} fails closed and consumes late errors`, async t => {
      const clock = fakeClock();
      let fail = phase === "initial", attempts = 0;
      const lock = createSecurityLock({ ...clock.options, schedule(fn, ms) {
        attempts++;
        return fail ? defect(fn, ms) : clock.options.schedule(fn, ms);
      } });
      t.after(() => lock.dispose());
      if (phase === "resume") lock.lock();
      const timer = clock.timers()[0];
      fail = true;
      if (phase === "activity") assert.equal(lock.activity(), false);
      if (phase === "resume") assert.equal(lock.unlock(), false);
      if (phase === "configure") lock.configure(60_000);
      if (phase === "early-fire") clock.invokeOld(timer);
      await flush();
      assert.equal(lock.state().locked, true);
      assert.equal(lock.state().reason, "timer");
      assert.equal(lock.state().canResume, false);
      assert.equal(lock.check(), false);
      assert.equal(lock.unlock(), false);
      assert(attempts <= 2, "No recursive timer installation");
      fail = false;
      lock.retryCleanup();
      assert.equal(lock.unlock(), false, "A timer fault requires a fresh page");
    });
  }
}

for (const action of ["lock", "dispose"]) {
  test(`scheduler reentrant ${action} invalidates a handle returned later`, t => {
    const clock = fakeClock();
    let lock, act = false, returned;
    lock = createSecurityLock({ ...clock.options, schedule(fn, ms) {
      const handle = clock.options.schedule(fn, ms);
      if (act) { returned = handle; lock[action](); }
      return handle;
    } });
    t.after(() => lock.dispose());
    act = true;
    assert.equal(lock.activity(), false);
    assert.equal(clock.timers().length, 0);
    clock.invokeOld(returned);
    assert.equal(lock.state().canRead, false);
  });
}

for (const removal of ["throw", "reject", "synchronous-old-callback"]) {
  test(`broken timer removal ${removal} cannot revive the prior timer`, async t => {
    const clock = fakeClock();
    let broken = false;
    const lock = createSecurityLock({ ...clock.options, unschedule(handle) {
      clock.options.unschedule(handle);
      if (!broken) return;
      if (removal === "throw") throw Error("remove failed");
      if (removal === "reject") return Promise.reject(Error("remove rejected"));
      clock.invokeOld(handle);
    } });
    t.after(() => lock.dispose());
    const old = clock.timers()[0];
    broken = true;
    assert.equal(lock.lock(), true);
    assert.equal(lock.state().locked, true);
    assert.equal(lock.unlock(), true);
    clock.invokeOld(old);
    assert.equal(lock.check(), true);
    await flush();
  });
}

test("repeated activity maintains one live timer and invalidates all replaced callbacks", t => {
  const clock = fakeClock();
  const lock = createSecurityLock(clock.options);
  t.after(() => lock.dispose());
  const removed = [];
  for (let index = 0; index < 100; index++) {
    removed.push(clock.timers()[0]);
    clock.advance(10, false);
    assert.equal(lock.activity(), true);
    assert.equal(clock.timers().length, 1);
  }
  for (const handle of removed) clock.invokeOld(handle);
  assert.equal(lock.check(), true);
  assert.equal(clock.timers().length, 1);
  clock.advance(300_000);
  assert.equal(lock.state().reason, "idle");
});

test("timer handle then getter is read once and cannot reopen a stopped gate", t => {
  const clock = fakeClock();
  let reads = 0, active = false, lock;
  lock = createSecurityLock({ ...clock.options, schedule(fn, ms) {
    if (!active) return clock.options.schedule(fn, ms);
    return Object.defineProperty({}, "then", { get() { reads++; lock.lock(); return undefined; } });
  } });
  t.after(() => lock.dispose());
  active = true;
  assert.equal(lock.activity(), false);
  assert.equal(reads, 1);
  assert.equal(lock.check(), false);
});

test("zero is a valid timer handle and is cancelled on stop", t => {
  let removed;
  const lock = createSecurityLock({ now: () => 0, schedule: () => 0,
    unschedule: handle => { removed = handle; } });
  t.after(() => lock.dispose());
  assert.equal(lock.check(), true);
  lock.lock();
  assert.equal(removed, 0);
});
