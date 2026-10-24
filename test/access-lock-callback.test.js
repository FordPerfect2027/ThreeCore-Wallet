import test from "node:test";
import assert from "node:assert/strict";
import { createSecurityLock, LOCK_REASONS } from "../src/security-lock.js";
import { fakeClock, flush } from "./helpers/access-lifecycle.js";

for (const reason of LOCK_REASONS) {
  test(`cleanup cannot reopen ${reason} while shutdown is running`, t => {
    const clock = fakeClock();
    let lock, attempts = [];
    lock = createSecurityLock({ ...clock.options, onLock() {
      attempts.push(lock.unlock(), lock.activity(), lock.configure(900000), lock.retryCleanup());
      assert.equal(lock.check(), false);
      assert.equal(lock.ticket(), null);
    } });
    t.after(() => lock.dispose());
    const old = lock.ticket();
    lock.lock(reason);
    assert.deepEqual(attempts, [false, false, false, false]);
    assert.equal(lock.valid(old), false);
    assert.equal(lock.state().canRead, false);
    if (!["clock", "timer"].includes(reason)) assert.equal(lock.unlock(), true);
  });
}

const failures = {
  false: () => false,
  throw() { throw Error("synthetic private cleanup failure"); },
  reject: () => Promise.reject(Error("synthetic private async cleanup")),
  resolve: () => Promise.resolve(true),
  pending: () => new Promise(() => {}),
  thenGetter: () => Object.defineProperty({}, "then", { get() { throw Error("getter failed"); } }),
  thenThrow: () => ({ then() { throw Error("then failed"); } }),
};
for (const [kind, fail] of Object.entries(failures)) {
  test(`cleanup ${kind} requires an explicit successful retry`, async t => {
    const clock = fakeClock();
    let broken = true, calls = 0;
    const lock = createSecurityLock({ ...clock.options, onLock() { calls++; return broken ? fail() : true; } });
    t.after(() => lock.dispose());
    lock.lock();
    assert.equal(lock.state().cleanupComplete, false);
    assert.equal(lock.state().canResume, false);
    assert.equal(lock.unlock(), false);
    await flush();
    assert.equal(lock.state().cleanupComplete, false);
    assert.equal(lock.retryCleanup(), false);
    broken = false;
    assert.equal(lock.retryCleanup(), true);
    assert.equal(calls, 3);
    assert.equal(lock.state().canRead, false);
    assert.equal(lock.state().canResume, true);
    assert.equal(lock.unlock(), true);
    await flush();
  });
}

for (const kind of ["throw", "reject", "resolve", "thenGetter", "thenThrow"]) {
  test(`observer ${kind} cannot change the cleanup result`, async t => {
    const clock = fakeClock();
    const lock = createSecurityLock({ ...clock.options, onChange: failures[kind] });
    t.after(() => lock.dispose());
    lock.lock();
    await flush();
    assert.equal(lock.state().cleanupComplete, true);
    assert.equal(lock.unlock(), true);
    await flush();
    assert.equal(lock.check(), true);
  });
}

for (const action of ["unlock", "activity", "configure", "retryCleanup"]) {
  test(`observer cannot reenter permissive action ${action}`, t => {
    const clock = fakeClock();
    let lock, answer;
    lock = createSecurityLock({ ...clock.options, onChange() { answer = lock[action](900000); } });
    t.after(() => lock.dispose());
    lock.lock();
    assert.equal(answer, false);
    assert.equal(lock.check(), false);
  });
}

test("observer can demand a stop while a resume is being published", t => {
  const clock = fakeClock();
  let lock, deliveries = 0;
  lock = createSecurityLock({ ...clock.options, onChange(state) {
    deliveries++;
    if (!state.locked) lock.lock("hidden");
  } });
  t.after(() => lock.dispose());
  lock.lock();
  assert.equal(lock.unlock(), false);
  assert.equal(lock.state().reason, "hidden");
  assert.equal(deliveries, 3, "A bounded follow-up delivers the final stopped state");
});

test("dispose from cleanup is terminal before observers receive the result", () => {
  const clock = fakeClock();
  let lock, callbacks = 0;
  lock = createSecurityLock({ ...clock.options, onLock() {
    callbacks++;
    lock.dispose();
    assert.equal(lock.unlock(), false);
    assert.equal(lock.state().disposed, true);
  } });
  lock.lock();
  assert.equal(callbacks, 1);
  assert.equal(lock.state().disposed, true);
  assert.equal(lock.retryCleanup(), false);
  assert.equal(clock.timers().length, 0);
});

test("cleanup may ask to stop again without recursive cleanup", t => {
  const clock = fakeClock();
  let lock, count = 0;
  lock = createSecurityLock({ ...clock.options, onLock() { count++; lock.lock("hidden"); } });
  t.after(() => lock.dispose());
  lock.lock();
  assert.equal(count, 1);
  assert.equal(lock.state().reason, "manual");
  assert.equal(lock.retryCleanup(), true);
  assert.equal(count, 2);
});

test("then property is captured once for cleanup and never trusted as delayed success", async t => {
  let gets = 0, executes = 0;
  const clock = fakeClock();
  const lock = createSecurityLock({ ...clock.options, onLock() {
    return Object.defineProperty({}, "then", { get() {
      gets++;
      return function(resolve, reject) { executes++; resolve(true); reject(Error("ignored second result")); };
    } });
  } });
  t.after(() => lock.dispose());
  lock.lock();
  await flush();
  assert.equal(gets, 1);
  assert.equal(executes, 1);
  assert.equal(lock.unlock(), false);
});

test("frozen snapshots preserve the earlier reason across later resume", t => {
  const clock = fakeClock();
  const lock = createSecurityLock(clock.options);
  t.after(() => lock.dispose());
  lock.lock();
  const stopped = lock.state();
  assert(Object.isFrozen(stopped));
  assert.throws(() => { stopped.locked = false; }, TypeError);
  lock.unlock();
  assert.equal(stopped.locked, true);
  assert.equal(stopped.reason, "manual");
  assert.equal(lock.state().locked, false);
});
