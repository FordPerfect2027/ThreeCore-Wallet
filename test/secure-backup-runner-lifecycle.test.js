import test from "node:test";
import assert from "node:assert/strict";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { manualTime, controlledSignal, microtasks } from "./helpers/secure-lifecycle-time.js";
import { gate } from "./helpers/secure-backup-fixtures.js";
const code = expected => error => error?.code === expected;
function fixture(options = {}) {
  const time = manualTime();
  const runner = createSecureBackupRunner({ ...time.options, timeoutMs: 100, ...options });
  return { time, runner };
}

test("late fulfilled result is rejected when timer delivery is suppressed", async () => {
  const f = fixture();
  const pending = gate();
  const work = f.runner.run(() => pending.promise);
  await microtasks();
  f.time.advance(100);
  pending.resolve("synthetic plaintext");
  await assert.rejects(work, code("SECURE_TIMEOUT"));
  assert.equal(f.runner.busy(), false);
  assert.equal(f.runner.state().completed, 0);
  assert.equal(f.runner.state().timedOut, 1);
  assert.equal(f.runner.state().late, 1);
});

test("deadline is checked before the first work microtask", async () => {
  const f = fixture();
  let calls = 0;
  const work = f.runner.run(() => { calls++; });
  f.time.advance(100);
  await assert.rejects(work, code("SECURE_TIMEOUT"));
  assert.equal(calls, 0);
  assert.equal(f.runner.busy(), false);
});

test("guard refuses a second native stage after deadline without waiting for timer", async () => {
  const f = fixture();
  const pending = gate();
  const checks = [];
  const work = f.runner.run(async guard => {
    checks.push(guard());
    await pending.promise;
    checks.push(guard());
    return "late";
  });
  await microtasks();
  f.time.advance(101);
  pending.resolve();
  await assert.rejects(work, code("SECURE_TIMEOUT"));
  await microtasks();
  assert.deepEqual(checks, [true, false]);
  assert.equal(f.runner.busy(), false);
});

test("a synchronous slow backend cannot win the delayed timer race", async () => {
  const f = fixture();
  const work = f.runner.run(() => { f.time.advance(100); return "late"; });
  await assert.rejects(work, code("SECURE_TIMEOUT"));
  assert.equal(f.runner.state().completed, 0);
});

test("a late backend error is replaced by the expired local deadline", async () => {
  const f = fixture();
  const pending = gate();
  const work = f.runner.run(() => pending.promise);
  await microtasks();
  f.time.advance(100);
  pending.reject(Error("synthetic secret"));
  await assert.rejects(work, code("SECURE_TIMEOUT"));
  assert.equal(f.runner.state().failed, 0);
});

test("timeout notifies caller but does not free an unfinished native slot", async () => {
  const f = fixture();
  const pending = gate();
  const work = f.runner.run(() => pending.promise);
  await microtasks();
  f.time.advance(100);
  f.time.flush();
  await assert.rejects(work, code("SECURE_TIMEOUT"));
  assert.equal(f.runner.state().phase, "draining");
  await assert.rejects(f.runner.run(() => assert.fail()), code("SECURE_BUSY"));
  assert.equal(f.runner.state().denied, 1);
  pending.resolve("late");
  await microtasks();
  assert.equal(f.runner.state().phase, "idle");
  assert.equal(f.runner.state().late, 1);
  assert.equal(await f.runner.run(() => "next"), "next");
});

test("cancel before dispatch prevents native work and frees capacity", async () => {
  const f = fixture();
  let calls = 0;
  const work = f.runner.run(() => { calls++; });
  assert.equal(f.runner.cancel(), true);
  assert.equal(f.runner.cancel(), false);
  await assert.rejects(work, code("SECURE_CANCELLED"));
  assert.equal(calls, 0);
  assert.equal(f.runner.busy(), false);
  assert.equal(f.runner.state().cancelled, 1);
});

test("cancel during native work closes every captured guard", async () => {
  const f = fixture();
  const pending = gate();
  let guard;
  const work = f.runner.run(check => { guard = check; return pending.promise; });
  await microtasks();
  f.runner.cancel();
  await assert.rejects(work, code("SECURE_CANCELLED"));
  assert.equal(guard(), false);
  assert.equal(f.runner.busy(), true);
  pending.reject(Error("late"));
  await microtasks();
  assert.equal(f.runner.busy(), false);
  assert.equal(guard(), false);
});

test("dispose rejects pending caller and permanently prevents reuse", async () => {
  const f = fixture();
  const pending = gate();
  const work = f.runner.run(() => pending.promise);
  await microtasks();
  f.runner.dispose();
  f.runner.dispose();
  await assert.rejects(work, code("SECURE_DISPOSED"));
  assert.equal(f.runner.state().phase, "disposed");
  assert.equal(f.runner.busy(), true);
  await assert.rejects(f.runner.run(() => assert.fail()), code("SECURE_DISPOSED"));
  pending.resolve();
  await microtasks();
  assert.equal(f.runner.busy(), false);
  assert.equal(f.runner.state().phase, "disposed");
});

test("dispose immediately after run prevents invocation", async () => {
  const f = fixture();
  let calls = 0;
  const work = f.runner.run(() => { calls++; });
  f.runner.dispose();
  await assert.rejects(work, code("SECURE_DISPOSED"));
  assert.equal(calls, 0);
  assert.equal(f.runner.state().started, 0);
});

test("signal registration failure prevents all backend invocation", async () => {
  const f = fixture();
  let calls = 0;
  let removals = 0;
  const signal = { aborted: false, addEventListener() { throw Error("failed to attach"); },
    removeEventListener() { removals++; } };
  await assert.rejects(f.runner.run(() => { calls++; }, { signal }), code("SECURE_INTERNAL"));
  await microtasks();
  assert.equal(calls, 0);
  assert.equal(removals, 1);
  assert.equal(f.runner.busy(), false);
  assert.equal(f.time.pending, 0);
});

test("partially installed signal listener remains harmless after setup failure", async () => {
  const f = fixture();
  let callback;
  const signal = { aborted: false, addEventListener(name, fn) { callback = fn; throw Error("partial"); },
    removeEventListener() { throw Error("cleanup also failed"); } };
  await assert.rejects(f.runner.run(() => assert.fail(), { signal }), code("SECURE_INTERNAL"));
  callback();
  callback();
  assert.equal(f.runner.state().failed, 1);
  assert.equal(await f.runner.run(() => "next"), "next");
  callback();
  assert.equal(f.runner.state().completed, 1);
});

test("synchronous abort while registering prevents crypto dispatch", async () => {
  const f = fixture();
  let removals = 0;
  const signal = { aborted: false,
    addEventListener(name, fn) { fn(); }, removeEventListener() { removals++; } };
  await assert.rejects(f.runner.run(() => assert.fail(), { signal }), code("SECURE_CANCELLED"));
  assert.equal(removals, 1);
  assert.equal(f.runner.busy(), false);
});

test("silent abort is detected at the work boundary", async () => {
  const f = fixture();
  const signal = controlledSignal();
  const work = f.runner.run(() => assert.fail(), { signal: signal.signal });
  signal.abort({ notify: false });
  await assert.rejects(work, code("SECURE_CANCELLED"));
  assert.equal(signal.listeners.size, 0);
  assert.equal(f.runner.state().started, 0);
});

test("silent abort after dispatch is detected before result acceptance", async () => {
  const f = fixture();
  const signal = controlledSignal();
  const pending = gate();
  const work = f.runner.run(() => pending.promise, { signal: signal.signal });
  await microtasks();
  signal.abort({ notify: false });
  pending.resolve("secret");
  await assert.rejects(work, code("SECURE_CANCELLED"));
  assert.equal(signal.listeners.size, 0);
  assert.equal(f.runner.state().completed, 0);
});

test("captured signal cleanup method is used even if property changes", async () => {
  const f = fixture();
  const signal = controlledSignal();
  const pending = gate();
  const work = f.runner.run(() => pending.promise, { signal: signal.signal });
  await microtasks();
  signal.signal.removeEventListener = () => assert.fail("replacement must not run");
  pending.resolve("ready");
  assert.equal(await work, "ready");
  assert.equal(signal.listeners.size, 0);
  assert.equal(signal.removed.length, 1);
});

test("signal cleanup exceptions cannot replace a successful value", async () => {
  const f = fixture();
  const signal = { aborted: false, addEventListener() {}, removeEventListener() { throw Error("cleanup"); } };
  assert.equal(await f.runner.run(() => 42, { signal }), 42);
  assert.equal(f.runner.busy(), false);
});

test("signal getter failures reject with a static code", async () => {
  const f = fixture();
  const signal = { get aborted() { throw Error("private content"); },
    addEventListener() {}, removeEventListener() {} };
  await assert.rejects(f.runner.run(() => assert.fail(), { signal }), code("SECURE_INTERNAL"));
  assert(!JSON.stringify(f.runner.state()).includes("private content"));
});

for (const bad of [0, "false", null, undefined]) {
  test("nonboolean abort state rejected: " + String(bad), async () => {
    const f = fixture();
    const signal = { aborted: bad, addEventListener() {}, removeEventListener() {} };
    await assert.rejects(f.runner.run(() => assert.fail(), { signal }), code("SECURE_INTERNAL"));
    assert.equal(f.runner.busy(), false);
  });
}

for (const schedule of [() => { throw Error("timer"); }, () => null, fn => { fn(); return 1; }]) {
  test("timer setup fault prevents native dispatch", async () => {
    const f = fixture({ schedule });
    await assert.rejects(f.runner.run(() => assert.fail()), code("SECURE_TIMER"));
    assert.equal(f.runner.state().started, 0);
    assert.equal(f.runner.busy(), false);
  });
}

test("timer cleanup failure leaves only invalidated callbacks", async () => {
  const f = fixture({ unschedule() { throw Error("timer cleanup"); } });
  assert.equal(await f.runner.run(() => 1), 1);
  const ids = f.time.allIds();
  f.time.advance(1000);
  ids.forEach(id => f.time.fire(id, { stale: true }));
  assert.equal(f.runner.state().timedOut, 0);
  assert.equal(f.runner.state().completed, 1);
});

test("old timer cannot cancel subsequent operation", async () => {
  const f = fixture();
  assert.equal(await f.runner.run(() => 1), 1);
  const old = f.time.allIds()[0];
  const pending = gate();
  const work = f.runner.run(() => pending.promise);
  await microtasks();
  f.time.fire(old, { stale: true });
  assert.equal(f.runner.state().phase, "running");
  pending.resolve(2);
  assert.equal(await work, 2);
});

for (const bad of [NaN, -1, Infinity, "100"]) {
  test("invalid runner clock blocks start " + String(bad), async () => {
    const f = fixture({ now: () => bad });
    await assert.rejects(f.runner.run(() => assert.fail()), code("SECURE_CLOCK"));
    assert.equal(f.runner.state().clockFault, true);
    assert.equal(f.runner.busy(), false);
  });
}

test("clock rollback across successive operations is latched", async () => {
  const f = fixture();
  assert.equal(await f.runner.run(() => 1), 1);
  f.time.advance(-1);
  await assert.rejects(f.runner.run(() => assert.fail()), code("SECURE_CLOCK"));
  f.time.advance(1000);
  await assert.rejects(f.runner.run(() => assert.fail()), code("SECURE_CLOCK"));
  assert.equal(f.runner.state().started, 1);
});

test("clock failure during native work drops result and releases only on settlement", async () => {
  const f = fixture();
  const pending = gate();
  const work = f.runner.run(() => pending.promise);
  await microtasks();
  f.time.set(NaN);
  pending.resolve("private result");
  await assert.rejects(work, code("SECURE_CLOCK"));
  assert.equal(f.runner.busy(), false);
  assert.equal(f.runner.state().completed, 0);
});

for (const value of [undefined, null, false, 0, "", 42]) {
  test("legitimate falsy success and failures remain distinguishable: " + String(value), async () => {
    const f = fixture();
    assert.equal(await f.runner.run(() => value), value);
    let rejected = false;
    await f.runner.run(() => Promise.reject(value)).catch(error => {
      rejected = true;
      assert.equal(error, value);
    });
    assert.equal(rejected, true);
    assert.equal(f.runner.state().completed, 1);
    assert.equal(f.runner.state().failed, 1);
  });
}

test("thenable can settle once without duplicating release or counters", async () => {
  const f = fixture();
  assert.equal(await f.runner.run(() => ({ then(resolve, reject) {
    resolve(7); reject(Error("ignored")); resolve(8);
  } })), 7);
  assert.equal(f.runner.state().completed, 1);
  assert.equal(f.runner.state().failed, 0);
  assert.equal(await f.runner.run(() => 9), 9);
});

test("throwing then getter is observed and frees the native slot", async () => {
  const f = fixture();
  const failure = Error("then getter");
  await assert.rejects(f.runner.run(() => ({ get then() { throw failure; } })), failure);
  assert.equal(f.runner.busy(), false);
});

test("status is frozen, aggregate-only and has no backend error or result", async () => {
  const f = fixture();
  const initial = f.runner.state();
  assert(Object.isFrozen(initial));
  assert.equal(await f.runner.run(() => "synthetic secret"), "synthetic secret");
  await assert.rejects(f.runner.run(() => { throw Error("synthetic private error"); }));
  const state = f.runner.state();
  assert.equal(initial.started, 0);
  assert.equal(state.started, 2);
  assert(!JSON.stringify(state).includes("synthetic"));
  assert.equal(f.time.pending, 0);
});
