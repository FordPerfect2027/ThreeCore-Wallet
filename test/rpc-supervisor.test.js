import test from "node:test";
import assert from "node:assert/strict";
import { createRpcSupervisor, RpcSupervisorError } from "../src/rpc-supervisor.js";
import { fixture, drain, deferred } from "./helpers/rpc-supervisor-fixtures.js";

test("supervisor dispatch begins only after caller receives its cancellation handle", async () => {
  const f = fixture();
  const operation = f.pending();
  assert.equal(operation.calls(), 0);
  assert.equal(operation.state().dispatched, false);
  assert.equal(operation.cancel(), true);
  await drain();
  assert.equal(operation.calls(), 0);
  assert.equal((await operation.outcome).code, "SESSION_CHANGED");
  assert.equal(f.supervisor.state().pending, 0);
  assert.equal(f.clock.timers().length, 0);
  await f.cleanup();
});

test("fulfilled request releases native capacity and local timer exactly once", async () => {
  const f = fixture();
  const operation = f.pending();
  await drain();
  assert.equal(operation.calls(), 1);
  assert.equal(f.supervisor.state().pending, 1);
  operation.result.resolve("0x1");
  assert.deepEqual(await operation.outcome, { ok: true, value: "0x1" });
  assert.equal(f.supervisor.state().pending, 0);
  assert.equal(f.supervisor.state().completed, 1);
  assert.equal(operation.cancel(), false);
  assert.equal(f.clock.timers().length, 0);
  await f.cleanup();
});

test("provider rejection is sanitized and clears transport capacity", async () => {
  const f = fixture();
  const operation = f.pending();
  await drain();
  operation.result.reject(Object.assign(Error("seed phrase private payload"), { code: 4001 }));
  const outcome = await operation.outcome;
  assert.equal(outcome.code, 4001);
  assert(!outcome.error.message.includes("seed"));
  assert.equal(f.supervisor.state().failed, 1);
  assert.equal(f.supervisor.state().pending, 0);
  await f.cleanup();
});

for (const code of ["READ_TIMEOUT", "CONNECT_TIMEOUT", "PERMISSION_TIMEOUT"]) {
  test("a " + code + " keeps unresolved provider work charged", async () => {
    const f = fixture({ perProvider: 1, perPage: 2 });
    const operation = f.pending({ timeoutCode: code });
    await drain();
    f.clock.advance(100); f.clock.run();
    assert.equal((await operation.outcome).code, code);
    const next = f.pending();
    assert.equal((await next.outcome).code, "RPC_CAPACITY");
    assert.equal(next.calls(), 0);
    assert.equal(f.supervisor.state().abandoned, 1);
    assert.equal(f.supervisor.state().waiting, 0);
    assert.equal(f.supervisor.state().timedOut, 1);
    operation.result.resolve("late private value");
    await drain();
    assert.equal(f.supervisor.state().pending, 0);
    assert.equal(f.supervisor.state().late, 1);
    const replacement = f.pending();
    await drain(); replacement.result.resolve("fresh");
    assert.equal((await replacement.outcome).value, "fresh");
    await f.cleanup();
  });
}

for (const code of ["SESSION_CHANGED", "SESSION_CANCELLED"]) {
  test("local " + code + " never pretends that native work was cancelled", async () => {
    const f = fixture();
    const operation = f.pending({ cancelCode: code });
    await drain();
    assert(operation.cancel());
    assert.equal((await operation.outcome).code, code);
    assert.equal(f.supervisor.state().abandoned, 1);
    assert.equal(f.supervisor.state().cancelled, 1);
    operation.result.reject(Error("late provider secret"));
    await drain();
    assert.equal(f.supervisor.state().pending, 0);
    assert.equal(f.supervisor.state().late, 1);
    assert.equal(f.supervisor.state().failed, 0);
    await f.cleanup();
  });
}

for (const offset of [100, 101, 1000, 300_000]) {
  test("late result cannot beat a throttled timer at elapsed " + offset, async () => {
    const f = fixture();
    const operation = f.pending();
    await drain();
    f.clock.advance(offset);
    // No timer callback executes before the native result settles.
    operation.result.resolve("too late");
    const result = await operation.outcome;
    assert.equal(result.code, "READ_TIMEOUT");
    assert.equal(f.supervisor.state().timedOut, 1);
    assert.equal(f.supervisor.state().late, 1);
    assert.equal(f.clock.timers().length, 0);
    await f.cleanup();
  });
}

test("a result immediately before its deadline is accepted", async () => {
  const f = fixture();
  const operation = f.pending();
  await drain();
  f.clock.advance(99.999);
  operation.result.resolve("within deadline");
  assert.equal((await operation.outcome).value, "within deadline");
  assert.equal(f.supervisor.state().timedOut, 0);
  await f.cleanup();
});

test("early timer callback re-arms only the remaining interval", async () => {
  const f = fixture();
  const operation = f.pending();
  await drain();
  const original = f.clock.timers()[0];
  f.clock.advance(40);
  f.clock.fire(original.id);
  assert.equal(f.clock.timers().length, 1);
  assert.equal(f.clock.timers()[0].delay, 60);
  f.clock.fire(original.id); // obsolete callbacks cannot create extra timers
  assert.equal(f.clock.timers().length, 1);
  f.clock.advance(60); f.clock.run();
  assert.equal((await operation.outcome).code, "READ_TIMEOUT");
  assert.equal(f.clock.timers().length, 0);
  await f.cleanup();
});

test("cancelled operation's old timer cannot terminate a fresh operation", async () => {
  const f = fixture();
  const one = f.pending();
  await drain();
  const old = f.clock.timers()[0].id;
  one.cancel();
  const two = f.pending();
  await drain();
  f.clock.fire(old);
  assert.equal(two.state().finished, false);
  two.result.resolve("fresh");
  assert.equal((await two.outcome).value, "fresh");
  await f.cleanup();
});

test("page capacity counts all provider identities after local cancellation", async () => {
  const f = fixture({ perProvider: 1, perPage: 3 });
  const operations = Array.from({ length: 3 }, () => f.pending({ provider: {} }));
  await drain();
  for (const operation of operations) operation.cancel();
  const extra = f.pending({ provider: {} });
  assert.equal((await extra.outcome).code, "RPC_CAPACITY");
  assert.equal(extra.calls(), 0);
  assert.equal(f.supervisor.state().pending, 3);
  operations[0].result.resolve("old");
  await drain();
  const fresh = f.pending({ provider: {} });
  await drain();
  assert.equal(fresh.calls(), 1);
  await f.cleanup();
});

test("same-turn bursts are bounded before any provider function executes", async () => {
  const f = fixture({ perProvider: 2, perPage: 2 });
  const one = f.pending(), two = f.pending(), three = f.pending();
  assert.equal(f.supervisor.state().pending, 2);
  assert.equal((await three.outcome).code, "RPC_CAPACITY");
  await drain();
  assert.equal(one.calls() + two.calls() + three.calls(), 2);
  assert.equal(f.supervisor.state().denied, 1);
  await f.cleanup();
});

test("cancelling a queued request restores a slot without recording late work", async () => {
  const f = fixture({ perProvider: 1, perPage: 1 });
  const one = f.pending();
  one.cancel();
  const two = f.pending();
  await drain();
  assert.equal(one.calls(), 0);
  assert.equal(two.calls(), 1);
  assert.equal(f.supervisor.state().started, 1);
  assert.equal(f.supervisor.state().late, 0);
  await f.cleanup();
});

test("disposed supervisor settles local waits but retains native accounting", async () => {
  const f = fixture();
  const one = f.pending(), two = f.pending();
  await drain();
  f.supervisor.dispose();
  assert.equal((await one.outcome).code, "RPC_SUPERVISOR_CLOSED");
  assert.equal((await two.outcome).code, "RPC_SUPERVISOR_CLOSED");
  assert.equal(f.supervisor.state().abandoned, 2);
  assert.equal(f.supervisor.state().canStart, false);
  assert.equal(f.clock.timers().length, 0);
  const denied = f.pending();
  assert.equal((await denied.outcome).code, "RPC_SUPERVISOR_CLOSED");
  one.result.resolve("late"); two.result.reject(Error("late"));
  await drain();
  assert.equal(f.supervisor.state().pending, 0);
  assert.equal(f.supervisor.state().late, 2);
  await f.cleanup();
});

test("synchronous provider throw releases capacity without leaking its message", async () => {
  const f = fixture();
  const operation = f.pending({ invoke() { throw Error("secret credentials"); } });
  const outcome = await operation.outcome;
  assert.equal(outcome.code, "PROVIDER_FAILURE");
  assert(!outcome.error.message.includes("credentials"));
  assert.equal(f.supervisor.state().pending, 0);
  assert.equal(f.supervisor.state().failed, 1);
  await f.cleanup();
});

test("thenable throwing while assimilated is consumed and sanitized", async () => {
  const f = fixture();
  const operation = f.pending({ invoke: () => Object.defineProperty({}, "then", {
    get() { throw Error("private then getter"); },
  }) });
  assert.equal((await operation.outcome).code, "PROVIDER_FAILURE");
  assert.equal(f.supervisor.state().pending, 0);
  await f.cleanup();
});

test("malicious thenable cannot settle or release a lease twice", async () => {
  const f = fixture();
  const operation = f.pending({ invoke: () => ({ then(resolve, reject) {
    resolve("first"); reject(Error("second")); resolve("third");
  } }) });
  assert.equal((await operation.outcome).value, "first");
  await drain();
  assert.equal(f.supervisor.state().completed, 1);
  assert.equal(f.supervisor.state().failed, 0);
  assert.equal(f.supervisor.state().late, 0);
  await f.cleanup();
});

test("provider reentrant cancellation cannot publish a successful response", async () => {
  const f = fixture();
  let operation;
  operation = f.pending({ invoke() { operation.cancel(); return "stale"; } });
  assert.equal((await operation.outcome).code, "SESSION_CHANGED");
  await drain();
  assert.equal(f.supervisor.state().pending, 0);
  assert.equal(f.supervisor.state().completed, 0);
  assert.equal(f.supervisor.state().late, 1);
  await f.cleanup();
});

test("unsubscribed observers and throwing observers cannot affect requests", async () => {
  const f = fixture();
  let removedCalls = 0, healthyCalls = 0;
  const remove = f.supervisor.subscribe(() => { removedCalls++; });
  f.supervisor.subscribe(() => { throw Error("observer failure"); });
  f.supervisor.subscribe(() => Promise.reject(Error("async observer failure")));
  f.supervisor.subscribe(() => { healthyCalls++; });
  remove();
  const operation = f.pending();
  await drain(); operation.result.resolve("ok");
  assert.equal((await operation.outcome).value, "ok");
  await drain();
  assert.equal(removedCalls, 0);
  assert(healthyCalls >= 1);
  await f.cleanup();
});

test("observer payload is immutable and has no account or response data", async () => {
  const f = fixture();
  const states = [];
  f.supervisor.subscribe(value => states.push(value));
  const operation = f.pending({ provider: { account: "synthetic private identifier" } });
  await drain(); operation.result.resolve({ balance: "synthetic private balance" });
  await operation.outcome; await drain();
  assert(states.every(Object.isFrozen));
  assert(!JSON.stringify(states).includes("synthetic"));
  assert(!JSON.stringify(states).includes("balance"));
  await f.cleanup();
});

test("subscriber count is bounded and an unsubscribe frees a subscription slot", async () => {
  const f = fixture();
  const subscriptions = Array.from({ length: 16 }, () => f.supervisor.subscribe(() => {}));
  assert.throws(() => f.supervisor.subscribe(() => {}), TypeError);
  subscriptions[0]();
  const replacement = f.supervisor.subscribe(() => {});
  replacement();
  await f.cleanup();
  assert.throws(() => f.supervisor.subscribe(() => {}), TypeError);
});

test("identical observer identity is not notified twice", async () => {
  const f = fixture();
  let calls = 0;
  const observer = () => { calls++; };
  const remove = f.supervisor.subscribe(observer);
  f.supervisor.subscribe(observer);
  f.pending();
  await drain();
  assert.equal(calls, 1);
  remove();
  await f.cleanup();
});

test("reentrant observer disposal cancels waits without restarting them", async () => {
  const f = fixture();
  f.supervisor.subscribe(() => f.supervisor.dispose());
  const operation = f.pending();
  assert.equal((await operation.outcome).code, "RPC_SUPERVISOR_CLOSED");
  await drain();
  assert.equal(operation.calls(), 1);
  assert.equal(f.supervisor.state().abandoned, 1);
  await f.cleanup();
});
