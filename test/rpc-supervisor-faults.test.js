import test from "node:test";
import assert from "node:assert/strict";
import { createRpcSupervisor, RpcSupervisorError } from "../src/rpc-supervisor.js";
import { fixture, drain, clockFixture } from "./helpers/rpc-supervisor-fixtures.js";

test("scheduler reentrant disposal clears the handle returned after disposal", async () => {
  let supervisor, calls = 0;
  const removed = [];
  supervisor = createRpcSupervisor({ now: () => 1,
    schedule() { supervisor.dispose(); return 42; },
    unschedule: handle => removed.push(handle) });
  const operation = supervisor.start({ provider: {}, invoke() { calls++; } });
  await assert.rejects(operation.promise, { code: "RPC_SUPERVISOR_CLOSED" });
  await drain();
  assert.deepEqual(removed, [42]);
  assert.equal(calls, 0);
  assert.equal(supervisor.state().pending, 0);
});

test("error inspection expiration counts the discarded result exactly once", async () => {
  const f = fixture();
  const operation = f.pending();
  await drain();
  operation.result.reject(Object.defineProperty({}, "code", { get() {
    f.clock.advance(100);
    return 4001;
  } }));
  assert.equal((await operation.outcome).code, "READ_TIMEOUT");
  assert.equal(f.supervisor.state().late, 1);
  assert.equal(f.supervisor.state().timedOut, 1);
  assert.equal(f.supervisor.state().failed, 0);
  await f.cleanup();
  assert.equal(f.supervisor.state().late, 1);
});

for (const value of [undefined, null, "now", 1, {}, []]) {
  for (const name of ["now", "schedule", "unschedule"]) {
    if (value === undefined) continue; // undefined selects the documented default
    test("invalid clock service " + name + " / " + String(value), () => {
      assert.throws(() => createRpcSupervisor({ [name]: value }), TypeError);
    });
  }
}
for (const timeout of [0, -1, 300001, 1.5, Infinity, NaN, "100", false, null]) {
  test("invalid waiting deadline is rejected before scheduling: " + String(timeout), async () => {
    const f = fixture();
    assert.throws(() => f.pending({ timeoutMs: timeout }), TypeError);
    assert.equal(f.clock.timers().length, 0);
    assert.equal(f.supervisor.state().started, 0);
    await f.cleanup();
  });
}
for (const code of ["eth_sendTransaction", "RPC_CAPACITY", "SESSION_CHANGED", "", null, 4001]) {
  test("timeout code allowlist rejects " + String(code), async () => {
    const f = fixture();
    assert.throws(() => f.pending({ timeoutCode: code }), TypeError);
    assert.equal(f.supervisor.state().pending, 0);
    await f.cleanup();
  });
}
for (const code of ["READ_TIMEOUT", "", null, 4001, "user-private-data"]) {
  test("cancellation code allowlist rejects " + String(code), async () => {
    const f = fixture();
    assert.throws(() => f.pending({ cancelCode: code }), TypeError);
    await f.cleanup();
  });
}

for (const badTime of [-1, NaN, Infinity, -Infinity, "1000", null]) {
  test("invalid initial clock refuses all extension calls: " + String(badTime), async () => {
    const f = fixture({ now: () => badTime });
    const operation = f.pending();
    assert.equal((await operation.outcome).code, "RPC_CLOCK");
    assert.equal(operation.calls(), 0);
    assert.equal(f.supervisor.state().fault, "RPC_CLOCK");
    assert.equal(f.supervisor.state().canStart, false);
    assert.equal(f.clock.timers().length, 0);
    await f.cleanup();
  });
}

test("clock exception never echoes its message or starts a provider", async () => {
  const f = fixture({ now() { throw Error("private clock detail"); } });
  const operation = f.pending();
  const result = await operation.outcome;
  assert.equal(result.code, "RPC_CLOCK");
  assert.equal(result.error.message, "RPC_CLOCK");
  assert.equal(operation.calls(), 0);
  await f.cleanup();
});

test("backward clock closes every current wait and cannot be reset by reconnect", async () => {
  const f = fixture();
  const one = f.pending(), two = f.pending({ provider: {} });
  await drain();
  f.clock.set(999);
  one.result.resolve("old clock result");
  assert.equal((await one.outcome).code, "RPC_CLOCK");
  assert.equal((await two.outcome).code, "RPC_CLOCK");
  assert.equal(f.supervisor.state().abandoned, 1);
  f.clock.set(5000);
  const next = f.pending();
  assert.equal((await next.outcome).code, "RPC_CLOCK");
  assert.equal(next.calls(), 0);
  assert.equal(f.clock.timers().length, 0);
  await f.cleanup();
});

test("clock rollback between two concurrent starts invalidates the first", async () => {
  const f = fixture();
  const one = f.pending();
  f.clock.set(900);
  const two = f.pending();
  assert.equal((await one.outcome).code, "RPC_CLOCK");
  assert.equal((await two.outcome).code, "RPC_CLOCK");
  await drain();
  assert.equal(one.calls() + two.calls(), 0);
  assert.equal(f.supervisor.state().pending, 0);
  await f.cleanup();
});

test("clock rollback inside provider result inspection cannot produce success", async () => {
  const f = fixture();
  const operation = f.pending();
  await drain();
  operation.result.reject(Object.defineProperty({}, "code", { get() {
    f.clock.set(500);
    return 4001;
  } }));
  assert.equal((await operation.outcome).code, "RPC_CLOCK");
  assert.equal(f.supervisor.state().completed, 0);
  await f.cleanup();
});

test("expired dispatch does not call the provider even when its timer is delayed", async () => {
  const f = fixture();
  const operation = f.pending();
  f.clock.advance(101);
  assert.equal((await operation.outcome).code, "READ_TIMEOUT");
  assert.equal(operation.calls(), 0);
  assert.equal(f.supervisor.state().pending, 0);
  assert.equal(f.supervisor.state().started, 0);
  assert.equal(f.supervisor.state().late, 0);
  await f.cleanup();
});

test("clock error while rearming refuses later results without freeing native work", async () => {
  const f = fixture();
  const operation = f.pending();
  await drain();
  const timer = f.clock.timers()[0].id;
  f.clock.set(NaN); f.clock.fire(timer);
  assert.equal((await operation.outcome).code, "RPC_CLOCK");
  assert.equal(f.supervisor.state().pending, 1);
  operation.result.resolve("discarded"); await drain();
  assert.equal(f.supervisor.state().pending, 0);
  assert.equal(f.supervisor.state().late, 1);
  await f.cleanup();
});

for (const mode of ["throw", "null", "undefined", "synchronous"]) {
  test("broken scheduling refuses provider access: " + mode, async () => {
    const f = fixture({ schedule(fn) {
      if (mode === "throw") throw Error("private timer payload");
      if (mode === "synchronous") { fn(); return 8; }
      return mode === "null" ? null : undefined;
    } });
    const operation = f.pending();
    assert.equal((await operation.outcome).code, "RPC_TIMER");
    await drain();
    assert.equal(operation.calls(), 0);
    assert.equal(f.supervisor.state().pending, 0);
    await f.cleanup();
  });
}

test("rearm scheduling failure ends local wait while retaining native lease", async () => {
  const clock = clockFixture();
  let calls = 0;
  const f = fixture({ ...clock.options, schedule(fn, delay) {
    if (++calls > 1) throw Error("rearm failure");
    return clock.options.schedule(fn, delay);
  } });
  const operation = f.pending();
  await drain();
  clock.advance(1); clock.fire(clock.timers()[0].id);
  assert.equal((await operation.outcome).code, "RPC_TIMER");
  assert.equal(f.supervisor.state().abandoned, 1);
  await f.cleanup();
});

test("timer cleanup exceptions do not prevent settlement or retain accounting", async () => {
  const f = fixture({ unschedule() { throw Error("cannot clear native timer"); } });
  const operation = f.pending();
  await drain();
  const timer = f.clock.timers()[0].id;
  operation.result.resolve("ok");
  assert.equal((await operation.outcome).value, "ok");
  f.clock.advance(101); f.clock.fire(timer);
  assert.equal(f.supervisor.state().completed, 1);
  assert.equal(f.supervisor.state().timedOut, 0);
  assert.equal(f.supervisor.state().pending, 0);
  await f.cleanup();
});

test("unknown supervisor error codes cannot echo their input", () => {
  const error = new RpcSupervisorError("private signing request details");
  assert.equal(error.code, "RPC_SUPERVISOR_CLOSED");
  assert.equal(error.message, "RPC_SUPERVISOR_CLOSED");
});

test("error code getter reentrant cancellation wins over provider rejection", async () => {
  const f = fixture();
  const operation = f.pending();
  await drain();
  operation.result.reject(Object.defineProperty({}, "code", { get() {
    operation.cancel();
    return 4001;
  } }));
  assert.equal((await operation.outcome).code, "SESSION_CHANGED");
  assert.equal(f.supervisor.state().cancelled, 1);
  assert.equal(f.supervisor.state().failed, 0);
  await f.cleanup();
});

test("error code getter consuming the entire deadline cannot turn timeout into rejection", async () => {
  const f = fixture();
  const operation = f.pending();
  await drain();
  operation.result.reject(Object.defineProperty({}, "code", { get() {
    f.clock.advance(100);
    return 4001;
  } }));
  assert.equal((await operation.outcome).code, "READ_TIMEOUT");
  assert.equal(f.supervisor.state().failed, 0);
  assert.equal(f.supervisor.state().pending, 0);
  await f.cleanup();
});

test("provider-supplied supervisor-like errors cannot forge trusted timeout codes", async () => {
  const f = fixture();
  const operation = f.pending();
  await drain();
  operation.result.reject(new RpcSupervisorError("RPC_CLOCK"));
  assert.equal((await operation.outcome).code, "PROVIDER_FAILURE");
  assert.equal(f.supervisor.state().fault, null);
  await f.cleanup();
});

test("observer removal during publication suppresses the removed listener", async () => {
  const f = fixture();
  let secondCalls = 0;
  let removeSecond;
  f.supervisor.subscribe(() => removeSecond());
  removeSecond = f.supervisor.subscribe(() => { secondCalls++; });
  f.pending(); await drain();
  assert.equal(secondCalls, 0);
  await f.cleanup();
});

test("observer registration during publication takes effect on the next snapshot", async () => {
  const f = fixture();
  let secondCalls = 0, subscribed = false;
  f.supervisor.subscribe(() => {
    if (!subscribed) {
      subscribed = true;
      f.supervisor.subscribe(() => { secondCalls++; });
    }
  });
  const operation = f.pending(); await drain();
  assert.equal(secondCalls, 0);
  operation.result.resolve("done"); await operation.outcome; await drain();
  assert.equal(secondCalls, 1);
  await f.cleanup();
});

test("all native outcomes after disposal remain consumed", async () => {
  const f = fixture();
  const operations = Array.from({ length: 8 }, () => f.pending());
  await drain(); f.supervisor.dispose();
  for (const [index, operation] of operations.entries()) {
    assert.equal((await operation.outcome).code, "RPC_SUPERVISOR_CLOSED");
    if (index % 2) operation.result.reject(Error("late failure"));
    else operation.result.resolve({ private: "late value" });
  }
  await drain();
  assert.equal(f.supervisor.state().late, 8);
  assert.equal(f.supervisor.state().pending, 0);
  assert.equal(f.supervisor.state().waiting, 0);
  await f.cleanup();
});
