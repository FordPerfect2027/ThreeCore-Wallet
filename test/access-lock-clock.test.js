import test from "node:test";
import assert from "node:assert/strict";
import { createSecurityLock, LOCK_IDLE_CHOICES } from "../src/security-lock.js";
import { lockFixture, fakeClock } from "./helpers/access-lifecycle.js";

for (const idleMs of LOCK_IDLE_CHOICES) {
  for (const operation of ["check", "ticket", "valid"]) {
    test(`clock regression is observed between ${operation} calls at ${idleMs}`, t => {
      const f = lockFixture(t, { idleMs });
      const ticket = f.lock.ticket();
      f.clock.set(1000);
      f.lock[operation](ticket);
      f.clock.set(999);
      f.lock[operation](ticket);
      assert.equal(f.lock.state().fault, "clock");
      assert.equal(f.lock.state().canRead, false);
      assert.equal(f.lock.unlock(), false);
      assert.equal(f.lock.valid(ticket), false);
      assert.equal(f.stops.length, 1);
    });
  }
  for (const offset of [-1, 0, 1]) {
    test(`deadline ${idleMs} at offset ${offset} cannot be extended by read`, t => {
      const f = lockFixture(t, { idleMs });
      const ticket = f.lock.ticket();
      f.clock.set(idleMs + offset);
      assert.equal(f.lock.valid(ticket), offset < 0);
      assert.equal(f.lock.state().canRead, offset < 0);
      if (offset >= 0) assert.equal(f.lock.state().reason, "idle");
      else {
        f.clock.set(idleMs);
        assert.equal(f.lock.check(), false);
        assert.equal(f.lock.state().reason, "idle");
      }
    });
  }
  test(`real activity resets deadline without changing session ticket at ${idleMs}`, t => {
    const f = lockFixture(t, { idleMs });
    const ticket = f.lock.ticket();
    f.clock.set(1000);
    assert.equal(f.lock.activity(), true);
    assert.equal(f.lock.ticket(), ticket);
    f.clock.set(idleMs + 999);
    assert.equal(f.lock.check(), true);
    f.clock.set(idleMs + 1000);
    assert.equal(f.lock.activity(), false);
    assert.equal(f.lock.state().reason, "idle");
  });
}

for (const value of [NaN, Infinity, -Infinity, -1, "100", null, undefined, 2 ** 60, Number.MAX_VALUE]) {
  test(`unusable clock ${String(value)} fails closed after initialization`, t => {
    const f = lockFixture(t);
    f.clock.set(value);
    assert.equal(f.lock.check(), false);
    assert.equal(f.lock.state().reason, "clock");
    f.clock.set(500);
    assert.equal(f.lock.unlock(), false);
    assert.equal(f.lock.state().canResume, false);
    assert.equal(f.clock.timers().length, 0);
  });
}

test("clock continuity is retained across manual stop and explicit resume", t => {
  const f = lockFixture(t);
  f.clock.set(100);
  assert.equal(f.lock.check(), true);
  f.lock.lock();
  f.clock.set(99);
  assert.equal(f.lock.unlock(), false);
  assert.equal(f.lock.state().fault, "clock");
  f.clock.set(200);
  f.lock.retryCleanup();
  assert.equal(f.lock.unlock(), false);
});

test("clock returning the same sample is allowed until the deadline", t => {
  const f = lockFixture(t);
  f.clock.set(100);
  for (let index = 0; index < 20; index++) assert.equal(f.lock.check(), true);
  assert.equal(f.lock.state().fault, null);
  f.clock.set(300000);
  assert.equal(f.lock.check(), false);
});

test("read clock reentrancy closes rather than recursively reading the clock", t => {
  const clock = fakeClock();
  let lock, armed = false, reads = 0;
  lock = createSecurityLock({ ...clock.options, now() {
    reads++;
    if (armed) lock.check();
    return 0;
  } });
  t.after(() => lock.dispose());
  armed = true;
  assert.equal(lock.check(), false);
  assert.equal(lock.state().fault, "clock");
  assert.equal(reads, 2);
  assert.equal(lock.unlock(), false);
});

for (const action of ["lock", "dispose"]) {
  test(`clock callback ${action} invalidates a successful numeric read`, t => {
    const clock = fakeClock();
    let lock, armed = false;
    lock = createSecurityLock({ ...clock.options, now() {
      if (armed) lock[action]();
      return 10;
    } });
    t.after(() => lock.dispose());
    armed = true;
    assert.equal(lock.check(), false);
    assert.equal(lock.state().canRead, false);
  });
}

test("a repeated stop inside the resume clock invalidates that resume", t => {
  const clock = fakeClock();
  let lock, stopDuringRead = false;
  lock = createSecurityLock({ ...clock.options, now() {
    if (stopDuringRead) lock.lock();
    return 10;
  } });
  t.after(() => lock.dispose());
  lock.lock();
  stopDuringRead = true;
  assert.equal(lock.unlock(), false);
  assert.equal(lock.state().locked, true);
  stopDuringRead = false;
  assert.equal(lock.unlock(), true);
});

test("a thrown resume clock remains closed and records a reload-only fault", t => {
  const clock = fakeClock();
  let broken = false;
  const lock = createSecurityLock({ ...clock.options, now() {
    if (broken) throw Error("fixture-only clock failure");
    return 0;
  } });
  t.after(() => lock.dispose());
  lock.lock();
  broken = true;
  assert.equal(lock.unlock(), false);
  assert.equal(lock.state().fault, "clock");
  broken = false;
  assert.equal(lock.unlock(), false);
});

test("clock fault does not leak a private diagnostic in state", t => {
  let broken = false;
  const clock = fakeClock();
  const lock = createSecurityLock({ ...clock.options, now() {
    if (broken) throw Error("secret synthetic address / balance / key");
    return 0;
  } });
  t.after(() => lock.dispose());
  broken = true;
  lock.check();
  const text = JSON.stringify(lock.state());
  assert(!text.includes("secret"));
  assert(!text.includes("address"));
  assert.equal(lock.state().canSign, false);
  assert.equal(lock.state().canSendTransactions, false);
});
