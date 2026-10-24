import test from "node:test";
import assert from "node:assert/strict";
import { fixture, bytes, tick, code, outcome, fakeClock, stalledFile, streamFile, fallbackFile } from "./helpers/file-boundary-fixtures.js";

for (const key of ["size", "stream", "arrayBuffer"]) {
  test("file reentrancy: cancelAll during metadata inspection " + key, async t => {
    const service = fixture(t);
    const input = fallbackFile("ok");
    const original = input.file[key];
    Object.defineProperty(input.file, key, { get() { service.cancelAll(); return original; } });
    await assert.rejects(service.readText(input.file), code("FILE_CANCELLED"));
    assert.equal(input.calls(), 0);
    assert.equal(service.state().active, 0);
    assert.equal(service.state().accepted, 0);
  });
}

for (const key of ["size", "stream", "arrayBuffer"]) {
  test("file reentrancy: dispose during metadata inspection " + key, async t => {
    const service = fixture(t);
    const input = fallbackFile("ok");
    const original = input.file[key];
    Object.defineProperty(input.file, key, { get() { service.dispose(); return original; } });
    await assert.rejects(service.readText(input.file), code("FILE_DISPOSED"));
    assert.equal(input.calls(), 0);
    assert.equal(service.state().active, 0);
  });
}

test("file reentrancy: observer cancellation precedes initial IO", async t => {
  const service = fixture(t);
  let seen = 0;
  service.subscribe(state => { seen++; if (state.waiting) service.cancelAll(); });
  const input = fallbackFile();
  await assert.rejects(service.readText(input.file), code("FILE_CANCELLED"));
  assert.equal(input.calls(), 0);
  assert(seen >= 2 && seen < 10);
  assert.equal(service.state().active, 0);
});

test("file reentrancy: observer disposal prevents dispatch and terminates subscriptions", async t => {
  const service = fixture(t);
  let notifications = 0;
  service.subscribe(state => {
    notifications++;
    if (state.waiting) service.dispose();
  });
  await assert.rejects(service.readText(fallbackFile().file), code("FILE_DISPOSED"));
  const after = notifications;
  service.cancelAll();
  await tick();
  assert.equal(notifications, after);
  assert.equal(service.state().active, 0);
});

test("file reentrancy: a throwing observer cannot change a successful result", async t => {
  const service = fixture(t);
  service.subscribe(() => { throw Error("private observer"); });
  service.subscribe(() => Promise.reject(Error("private async observer")));
  assert.equal(await service.readText(fallbackFile("kept").file), "kept");
  await tick();
  assert.equal(service.state().completed, 1);
});

test("file reentrancy: source read can stop itself without exposing returned bytes", async t => {
  const service = fixture(t);
  const input = streamFile([bytes("x")], { onRead() {
    service.cancelAll();
    return { done: false, value: bytes("x") };
  } });
  await assert.rejects(service.readBytes(input.file), code("FILE_CANCELLED"));
  assert.equal(input.calls.read, 1);
  assert.equal(input.calls.cancel, 1);
  assert.equal(service.state().completed, 0);
});

test("file reentrancy: packet descriptor trap can stop without subsequent processing", async t => {
  const service = fixture(t);
  let calls = 0;
  const packet = new Proxy({ done: false, value: bytes("x") }, {
    getOwnPropertyDescriptor(target, key) {
      calls++; service.cancelAll();
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  const input = streamFile([bytes("x")], { onRead: () => packet });
  await assert.rejects(service.readText(input.file), code("FILE_CANCELLED"));
  assert.equal(input.calls.read, 1);
  assert.equal(service.state().completed, 0);
  assert(calls <= 2);
});

test("file reentrancy: read-method capture failure releases acquired stream", async t => {
  const service = fixture(t);
  const input = streamFile([bytes("x")]);
  Object.defineProperty(input.reader, "read", { get() {
    service.cancelAll(); return () => ({ done: true });
  } });
  await assert.rejects(service.readText(input.file), code("FILE_CANCELLED"));
  assert.equal(input.calls.read, 0);
  assert.equal(input.calls.cancel, 1);
  assert.equal(input.calls.release, 1);
});

test("file reentrancy: metadata starts nested work without exceeding capacity", async t => {
  const service = fixture(t);
  const files = Array.from({ length: 4 }, () => stalledFile());
  const nested = [];
  const input = fallbackFile("ok");
  Object.defineProperty(input.file, "size", { get() {
    for (const f of files) nested.push(outcome(service.readText(f.file)));
    return 2;
  } });
  await assert.rejects(service.readText(input.file), code("FILE_BUSY"));
  assert.equal(service.state().active, 4);
  assert.equal(input.calls(), 0);
  service.cancelAll(); files.forEach(f => f.settle());
  await Promise.all(nested); await tick();
  assert.equal(service.state().active, 0);
});

test("file reentrancy: cancelling from clock callback prevents source dispatch", async t => {
  let service;
  let reads = 0;
  const clock = fakeClock();
  service = fixture(t, { ...clock.options, now() {
    if (++reads === 2) service.cancelAll();
    return 0;
  } });
  const input = fallbackFile();
  await assert.rejects(service.readText(input.file), code("FILE_CANCELLED"));
  assert.equal(input.calls(), 0);
});

test("file reentrancy: synchronous scheduler callback fails without recursion", async t => {
  let schedules = 0;
  const service = fixture(t, { now: () => 0, schedule(action) { schedules++; action(); return 1; } });
  const input = fallbackFile();
  await assert.rejects(service.readText(input.file), code("FILE_READ"));
  assert.equal(schedules, 1);
  assert.equal(input.calls(), 0);
  assert.equal(service.state().active, 0);
});

test("file reentrancy: unsubscription during notification prevents stale listener", async t => {
  const service = fixture(t);
  let secondCalls = 0;
  let removeSecond = () => {};
  service.subscribe(state => { if (state.waiting) removeSecond(); });
  removeSecond = service.subscribe(() => secondCalls++);
  assert.equal(await service.readText(fallbackFile().file), "ok");
  assert.equal(secondCalls, 1);
});

test("file reentrancy: subscriber capacity can be restored by unsubscription", t => {
  const service = fixture(t);
  const removals = Array.from({ length: 64 }, () => service.subscribe(() => {}));
  assert.throws(() => service.subscribe(() => {}), code("FILE_BUSY"));
  removals[0]();
  const remove = service.subscribe(() => {});
  remove(); remove();
  removals.forEach(fn => fn());
});

test("file reentrancy: immutable aggregate cannot be used to alter budgets", async t => {
  const service = fixture(t);
  const states = [];
  service.subscribe(state => states.push(state));
  const input = stalledFile();
  const pending = outcome(service.readText(input.file));
  await tick();
  assert(states.every(Object.isFrozen));
  assert.throws(() => { states.at(-1).active = 0; }, TypeError);
  assert.equal(service.state().active, 1);
  service.cancelAll(); input.settle(); await pending; await tick();
});
