import test from "node:test";
import assert from "node:assert/strict";
import { guardFixture, clockFixture, PRIVATE } from "./helpers/export-fixtures.js";

const code = (action, expected) => assert.throws(action, error => error.code === expected);

test("an early timer rearms only the remaining retention time", () => {
  const f = guardFixture();
  f.offer();
  f.clock.advance(250);
  f.clock.fire();
  assert.equal(f.guard.state().active, 1);
  assert.equal(f.resources[0].releases, 0);
  assert.equal(f.clock.installed.at(-1).delay, 750);
  f.clock.advance(750); f.clock.due();
  assert.equal(f.guard.state().active, 0);
});

test("fractional early clock rounds the remaining delay upward", () => {
  const f = guardFixture();
  f.offer(); f.clock.advance(0.2); f.clock.fire();
  assert.equal(f.clock.installed.at(-1).delay, 1000);
  f.clock.set(1000); f.clock.fire();
  assert.equal(f.guard.state().active, 0);
});

test("stale timer cannot expire another newer offer", () => {
  const f = guardFixture();
  f.offer();
  const callback = f.clock.installed[0].fn;
  f.guard.clear(); f.offer();
  callback(); callback();
  assert.equal(f.guard.state().active, 1);
  assert.equal(f.resources[1].releases, 0);
  f.guard.clear();
});

test("an old rearmed callback cannot create duplicate timers", () => {
  const f = guardFixture();
  f.offer();
  const old = f.clock.installed[0].fn;
  f.clock.advance(200); f.clock.fire();
  old(); old();
  assert.equal(f.clock.timers.size, 1);
  assert.equal(f.clock.installed.length, 2);
  f.guard.clear();
});

for (const time of [NaN, Infinity, -1, "100", null, undefined, Number.MAX_SAFE_INTEGER]) {
  test("invalid clock fails closed before allocation: " + String(time), () => {
    const f = guardFixture({ now: () => time });
    code(() => f.offer(), "EXPORT_CLOCK");
    assert.equal(f.resources.length, 0);
    assert.equal(f.guard.state().clockFault, true);
    code(() => f.offer(), "EXPORT_CLOCK");
  });
}

test("backward time cancels previous leases and permanently stops admission", () => {
  const f = guardFixture();
  f.clock.set(50); f.offer();
  f.clock.set(49);
  code(() => f.offer(), "EXPORT_CLOCK");
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.resources.length, 1);
  f.clock.set(100);
  code(() => f.offer(), "EXPORT_CLOCK");
});

test("clock throwing sensitive data produces a fixed clock error", () => {
  const f = guardFixture({ now() { throw Error(PRIVATE); } });
  code(() => f.offer(), "EXPORT_CLOCK");
  assert.equal(f.guard.state().clockFault, true);
});

test("clock failure while a timer runs still cleans every lease", () => {
  const f = guardFixture();
  f.offer(); f.offer();
  f.clock.set(NaN); f.clock.fire();
  assert.equal(f.guard.state().clockFault, true);
  assert.equal(f.guard.state().active, 0);
  assert(f.resources.every(item => !item.live));
});

test("activation crossing its deadline cannot return a successful receipt", () => {
  const clock = clockFixture();
  let released = 0;
  const f = guardFixture({ now: clock.now, createResource: () => ({
    activate() { clock.advance(1000); }, release() { released++; },
  }) });
  code(() => f.offer(), "EXPORT_CANCELLED");
  assert.equal(f.guard.state().offered, 0);
  assert.equal(f.guard.state().active, 0);
  assert(released >= 1);
});

test("clock fault after activation cleans resources and rejects the offer", () => {
  const clock = clockFixture();
  const f = guardFixture({ now: clock.now, createResource: () => ({
    activate() { clock.set(-1); }, release() {},
  }) });
  code(() => f.offer(), "EXPORT_CLOCK");
  assert.equal(f.guard.state().clockFault, true);
  assert.equal(f.guard.state().active, 0);
});

test("synchronously invoked scheduler cannot activate or leak a resource", () => {
  let activated = 0, released = 0, cancelled = 0;
  const f = guardFixture({ schedule(callback) { callback(); return 1; },
    unschedule() { cancelled++; }, createResource: () => ({
      activate() { activated++; }, release() { released++; },
    }) });
  code(() => f.offer(), "EXPORT_CANCELLED");
  assert.equal(activated, 0);
  assert(released >= 1); assert(cancelled >= 1);
  assert.equal(f.guard.state().active, 0);
});

test("scheduler failure closes the captured resource before any click", () => {
  let activated = 0, released = 0;
  const f = guardFixture({ schedule() { throw Error(PRIVATE); }, createResource: () => ({
    activate() { activated++; }, release() { released++; },
  }) });
  code(() => f.offer(), "EXPORT_FAILED");
  assert.equal(activated, 0); assert(released >= 1);
  assert.equal(f.guard.state().active, 0);
});

test("unschedule failure cannot skip release and stale callback remains inert", () => {
  const f = guardFixture({ unschedule() { throw Error(PRIVATE); } });
  f.offer();
  const timer = f.clock.installed[0].fn;
  f.guard.clear();
  timer();
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.resources[0].releases, 1);
});

test("a large forward jump frees only leases whose timer is evaluated", () => {
  const f = guardFixture();
  f.offer(); f.offer();
  f.clock.advance(86400000); f.clock.due();
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.guard.state().clockFault, false);
});

test("multiple offers retain independent deadlines", () => {
  const f = guardFixture();
  f.offer(); f.clock.advance(200); f.offer();
  f.clock.set(1000); f.clock.due();
  assert.equal(f.guard.state().active, 1);
  assert.equal(f.resources[0].releases, 1);
  assert.equal(f.resources[1].releases, 0);
  f.clock.set(1200); f.clock.due();
  assert.equal(f.guard.state().active, 0);
});
