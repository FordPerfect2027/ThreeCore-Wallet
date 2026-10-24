import test from "node:test";
import assert from "node:assert/strict";
import { createSecureDeadline } from "../src/secure-deadline.js";
import { manualTime, microtasks } from "./helpers/secure-lifecycle-time.js";

function fixture(options = {}) {
  const time = manualTime();
  const expired = [];
  const deadline = createSecureDeadline({ ...time.options, timeoutMs: 100,
    onExpire: code => expired.push(code), ...options });
  return { time, deadline, expired };
}

test("unused deadline carries no authority or timer", () => {
  const f = fixture();
  assert.equal(f.deadline.check(), false);
  assert.deepEqual(f.deadline.state(), { phase: "idle", code: null, fault: null });
  assert.equal(f.time.pending, 0);
  assert.deepEqual(f.expired, []);
});

test("armed deadline permits use strictly before its endpoint", () => {
  const f = fixture();
  assert.equal(f.deadline.arm(), true);
  f.time.advance(99.5);
  assert.equal(f.deadline.check(), true);
  assert.equal(f.time.pending, 1);
  assert.deepEqual(f.expired, []);
  f.deadline.dispose();
});

test("exact endpoint is expired without delivering any timer", () => {
  const f = fixture();
  f.deadline.arm();
  f.time.advance(100);
  assert.equal(f.deadline.check(), false);
  assert.deepEqual(f.expired, ["SECURE_EXPIRED"]);
  assert.equal(f.time.pending, 0);
  assert.equal(f.deadline.state().phase, "expired");
});

test("a suspended tab cannot use data after its elapsed lifetime", () => {
  const f = fixture();
  f.deadline.arm();
  f.time.advance(86_400_000);
  assert.equal(f.deadline.check(), false);
  assert.deepEqual(f.expired, ["SECURE_EXPIRED"]);
  assert.equal(f.deadline.check(), false);
  assert.equal(f.expired.length, 1);
});

test("expiry callback sees closed access before being notified", () => {
  const time = manualTime();
  let deadline;
  const states = [];
  deadline = createSecureDeadline({ ...time.options, timeoutMs: 10,
    onExpire() { states.push([deadline.check(), deadline.state().phase]); } });
  deadline.arm();
  time.advance(10);
  time.flush();
  assert.deepEqual(states, [[false, "expired"]]);
});

test("clearing pending data invalidates a queued old timer", () => {
  const f = fixture();
  f.deadline.arm();
  const [old] = f.time.ids();
  f.deadline.clear();
  f.time.advance(1000);
  f.time.fire(old, { stale: true });
  assert.equal(f.deadline.check(), false);
  assert.equal(f.deadline.state().phase, "idle");
  assert.deepEqual(f.expired, []);
});

test("an old callback cannot expire a newly armed lifetime", () => {
  const f = fixture();
  f.deadline.arm();
  const [old] = f.time.ids();
  f.time.advance(50);
  f.deadline.arm();
  f.time.advance(50);
  f.time.fire(old, { stale: true });
  assert.equal(f.deadline.check(), true);
  assert.equal(f.time.pending, 1);
  assert.deepEqual(f.expired, []);
  f.time.advance(50);
  assert.equal(f.deadline.check(), false);
});

test("early timer delivery re-arms only the remaining duration", () => {
  const f = fixture();
  f.deadline.arm();
  f.time.advance(25);
  f.time.fire(f.time.ids()[0]);
  assert.deepEqual(f.time.delays, [100, 75]);
  assert.equal(f.time.pending, 1);
  f.time.advance(75);
  f.time.flush();
  assert.equal(f.deadline.check(), false);
  assert.deepEqual(f.expired, ["SECURE_EXPIRED"]);
});

test("duplicate early timer callbacks cannot create extra timers", () => {
  const f = fixture();
  f.deadline.arm();
  const [id] = f.time.ids();
  f.time.advance(10);
  f.time.fire(id);
  for (let i = 0; i < 10; i++) f.time.fire(id, { stale: true });
  assert.equal(f.time.pending, 1);
  assert.deepEqual(f.time.delays, [100, 90]);
  f.deadline.dispose();
});

test("periodic early callbacks do not move the absolute deadline", () => {
  const f = fixture();
  f.deadline.arm();
  for (let i = 0; i < 9; i++) {
    f.time.advance(10);
    f.time.fire(f.time.ids()[0]);
    assert.equal(f.deadline.check(), true);
  }
  assert.equal(f.time.delays.at(-1), 10);
  f.time.advance(10);
  assert.equal(f.deadline.check(), false);
  assert.equal(f.expired.length, 1);
});

for (const bad of [NaN, Infinity, -1, "110", undefined, null]) {
  test("invalid clock fails closed: " + String(bad), () => {
    const f = fixture();
    f.deadline.arm();
    f.time.set(bad);
    assert.equal(f.deadline.check(), false);
    assert.equal(f.deadline.state().fault, "SECURE_CLOCK");
    assert.deepEqual(f.expired, ["SECURE_CLOCK"]);
    f.time.set(200);
    assert.equal(f.deadline.arm(), false, "a fault cannot be reset by another click");
  });
}

test("clock rollback closes access even before expiry", () => {
  const f = fixture();
  f.deadline.arm();
  f.time.advance(20);
  assert.equal(f.deadline.check(), true);
  f.time.advance(-1);
  assert.equal(f.deadline.check(), false);
  assert.deepEqual(f.expired, ["SECURE_CLOCK"]);
});

test("clock rollback between separate lifetimes is rejected", () => {
  const f = fixture();
  f.deadline.arm();
  f.time.advance(50);
  f.deadline.check();
  f.deadline.clear();
  f.time.set(100);
  assert.equal(f.deadline.arm(), false);
  assert.deepEqual(f.expired, ["SECURE_CLOCK"]);
});

test("equal monotonic readings are legal", () => {
  const f = fixture();
  assert.equal(f.deadline.arm(), true);
  for (let i = 0; i < 20; i++) assert.equal(f.deadline.check(), true);
  assert.deepEqual(f.expired, []);
  f.deadline.dispose();
});

test("clock exceptions are static and never copied into state", () => {
  const secret = "synthetic credential must not appear";
  const f = fixture({ now() { throw Error(secret); } });
  assert.equal(f.deadline.arm(), false);
  assert.deepEqual(f.expired, ["SECURE_CLOCK"]);
  assert(!JSON.stringify(f.deadline.state()).includes(secret));
});

test("an unrepresentable future deadline closes access", () => {
  const f = fixture({ now: () => Number.MAX_VALUE });
  assert.equal(f.deadline.arm(), false);
  assert.deepEqual(f.expired, ["SECURE_CLOCK"]);
});

test("a clock callback cannot recursively grant authority", () => {
  let deadline;
  const expired = [];
  deadline = createSecureDeadline({ now() { deadline.check(); return 1; },
    onExpire: code => expired.push(code) });
  assert.equal(deadline.arm(), false);
  assert.deepEqual(expired, ["SECURE_CLOCK"]);
});

test("a clock callback that clears invalidates the current check", () => {
  let clear = false;
  let deadline;
  const time = manualTime();
  deadline = createSecureDeadline({ ...time.options, now() {
    if (clear) deadline.clear();
    return time.value;
  } });
  deadline.arm();
  clear = true;
  assert.equal(deadline.check(), false);
  assert.equal(time.pending, 0);
});

test("synchronous timer adapters fail before access is granted", () => {
  const f = fixture({ schedule(fn) { fn(); return 1; } });
  assert.equal(f.deadline.arm(), false);
  assert.equal(f.deadline.check(), false);
  assert.deepEqual(f.expired, ["SECURE_TIMER"]);
});

for (const handle of [null, undefined]) {
  test("missing timer handle fails closed: " + String(handle), () => {
    const f = fixture({ schedule: () => handle });
    assert.equal(f.deadline.arm(), false);
    assert.deepEqual(f.expired, ["SECURE_TIMER"]);
    assert.equal(f.deadline.state().fault, "SECURE_TIMER");
  });
}

test("numeric zero is a valid timer handle", () => {
  const removed = [];
  const f = fixture({ schedule: () => 0, unschedule: id => removed.push(id) });
  assert.equal(f.deadline.arm(), true);
  f.deadline.clear();
  assert.deepEqual(removed, [0]);
});

test("failed timer registration cannot expose a candidate", () => {
  const f = fixture({ schedule() { throw Error("timer backend"); } });
  assert.equal(f.deadline.arm(), false);
  assert.deepEqual(f.expired, ["SECURE_TIMER"]);
  f.deadline.clear();
  assert.equal(f.deadline.arm(), false);
});

test("partial timer installation leaves a harmless stale callback", () => {
  let callback;
  const f = fixture({ schedule(fn) { callback = fn; throw Error("partial installation"); } });
  assert.equal(f.deadline.arm(), false);
  callback();
  callback();
  assert.deepEqual(f.expired, ["SECURE_TIMER"]);
  assert.equal(f.deadline.check(), false);
});

test("timer removal failure cannot extend expired authority", () => {
  const f = fixture({ unschedule() { throw Error("cannot remove"); } });
  f.deadline.arm();
  const [id] = f.time.ids();
  f.deadline.clear();
  f.time.advance(1000);
  f.time.fire(id, { stale: true });
  assert.equal(f.deadline.check(), false);
  assert.deepEqual(f.expired, []);
});

test("expiry notification exceptions cannot reopen a deadline", () => {
  const f = fixture({ onExpire() { throw Error("view failed"); } });
  f.deadline.arm();
  f.time.advance(100);
  assert.doesNotThrow(() => f.time.flush());
  assert.equal(f.deadline.check(), false);
});

test("asynchronous notification rejection is consumed", async () => {
  const f = fixture({ onExpire: async () => { throw Error("async view failed"); } });
  f.deadline.arm();
  f.time.advance(100);
  f.time.flush();
  await microtasks();
  assert.equal(f.deadline.state().phase, "expired");
});

test("disposal cannot be undone by clear, arm or a delayed callback", () => {
  const f = fixture();
  f.deadline.arm();
  const [id] = f.time.ids();
  f.deadline.dispose();
  f.deadline.clear();
  f.time.advance(1000);
  f.time.fire(id, { stale: true });
  assert.equal(f.deadline.arm(), false);
  assert.equal(f.deadline.check(), false);
  assert.equal(f.deadline.state().phase, "disposed");
  assert.deepEqual(f.expired, []);
});

test("state snapshots are frozen and contain no timing payload", () => {
  const f = fixture();
  f.deadline.arm();
  const state = f.deadline.state();
  assert(Object.isFrozen(state));
  assert.deepEqual(Object.keys(state), ["phase", "code", "fault"]);
  assert.throws(() => { state.phase = "idle"; }, TypeError);
  f.time.advance(100);
  f.deadline.check();
  assert.equal(state.phase, "armed", "previous snapshot is immutable");
});

for (const timeoutMs of [0, -1, 1.5, 120001, NaN, Infinity, "10", null]) {
  test("deadline rejects invalid duration " + String(timeoutMs), () => {
    assert.throws(() => createSecureDeadline({ timeoutMs }), { code: "SECURE_INTERNAL" });
  });
}
for (const timeoutMs of [1, 120000]) {
  test("deadline supports documented boundary duration " + timeoutMs, () => {
    const f = fixture({ timeoutMs });
    assert.equal(f.deadline.arm(), true);
    f.time.advance(timeoutMs);
    assert.equal(f.deadline.check(), false);
  });
}
for (const name of ["now", "schedule", "unschedule", "onExpire"]) {
  test("deadline rejects nonfunction " + name, () => {
    assert.throws(() => createSecureDeadline({ [name]: 1 }), { code: "SECURE_INTERNAL" });
  });
}
for (const timeoutCode of ["READ_TIMEOUT", "secret", null]) {
  test("deadline cannot publish arbitrary error text " + timeoutCode, () => {
    assert.throws(() => createSecureDeadline({ timeoutCode }), { code: "SECURE_INTERNAL" });
  });
}

test("runner deadline uses the explicit operation timeout code", () => {
  const f = fixture({ timeoutCode: "SECURE_TIMEOUT" });
  f.deadline.arm();
  f.time.advance(100);
  f.time.flush();
  assert.deepEqual(f.expired, ["SECURE_TIMEOUT"]);
});
