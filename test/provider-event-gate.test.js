import test from "node:test";
import assert from "node:assert/strict";
import { createProviderEventGate, PROVIDER_EVENT_LIMITS } from "../src/provider-event-gate.js";
import { observeWalletProvider } from "../src/provider-events.js";

test("event ingress has fixed bounded defaults and immutable snapshots", () => {
  const gate = createProviderEventGate({ now: () => 0 });
  assert.deepEqual(gate.state(), { blocked: false, reason: null, count: 0, limit: 256, windowMs: 1000 });
  assert(Object.isFrozen(gate));
  assert(Object.isFrozen(gate.state()));
  assert(Object.isFrozen(PROVIDER_EVENT_LIMITS));
  assert.deepEqual(Object.keys(gate), ["accept", "state"]);
});
for (const limit of [0, -1, 257, 1.5, "256", null, Infinity, NaN]) {
  test("invalid event count limit refused: " + String(limit), () => {
    assert.throws(() => createProviderEventGate({ limit }), TypeError);
  });
}
for (const windowMs of [0, -1, 999, 60_001, 1000.5, "1000", null, Infinity, NaN]) {
  test("invalid event budget window refused: " + String(windowMs), () => {
    assert.throws(() => createProviderEventGate({ windowMs }), TypeError);
  });
}
test("exactly 256 event inspections are permitted in one window", () => {
  const gate = createProviderEventGate({ now: () => 0 });
  for (let i = 0; i < 256; i++) assert(gate.accept());
  assert.equal(gate.accept(), false);
  assert.deepEqual(gate.state(), { blocked: true, reason: "limit", count: 256, limit: 256, windowMs: 1000 });
});
test("blocked event gate never resets automatically", () => {
  let now = 0;
  const gate = createProviderEventGate({ now: () => now, limit: 2 });
  assert(gate.accept()); assert(gate.accept()); assert.equal(gate.accept(), false);
  for (const time of [1000, 60_000, 86400000]) {
    now = time;
    assert.equal(gate.accept(), false);
    assert.equal(gate.state().count, 2);
    assert.equal(gate.state().reason, "limit");
  }
});
test("healthy window renews at its exact boundary", () => {
  let now = 0;
  const gate = createProviderEventGate({ now: () => now, limit: 2 });
  assert(gate.accept()); assert(gate.accept());
  now = 1000;
  assert(gate.accept());
  assert.equal(gate.state().count, 1);
  assert.equal(gate.state().blocked, false);
});
test("one millisecond before renewal cannot reset an exhausted budget", () => {
  let now = 0;
  const gate = createProviderEventGate({ now: () => now, limit: 2 });
  gate.accept(); gate.accept(); now = 999;
  assert.equal(gate.accept(), false);
  assert.equal(gate.state().reason, "limit");
});
test("constant monotonic time is valid but remains within the same budget", () => {
  const gate = createProviderEventGate({ now: () => 123.5, limit: 2 });
  assert(gate.accept()); assert(gate.accept()); assert.equal(gate.accept(), false);
  assert.equal(gate.state().reason, "limit");
});
test("rollback within the current window fails closed", () => {
  let now = 100;
  const gate = createProviderEventGate({ now: () => now });
  assert(gate.accept()); now = 99;
  assert.equal(gate.accept(), false);
  assert.equal(gate.state().reason, "clock");
});
test("rollback after renewing a window is still detected", () => {
  let now = 0;
  const gate = createProviderEventGate({ now: () => now });
  assert(gate.accept()); now = 2000; assert(gate.accept());
  now = 1999;
  assert.equal(gate.accept(), false);
  assert.equal(gate.state().reason, "clock");
});
for (const bad of [NaN, Infinity, -Infinity, -1, "1000", null, undefined]) {
  test("non-finite or non-numeric event time closes inspection: " + String(bad), () => {
    const gate = createProviderEventGate({ now: () => bad });
    assert.equal(gate.accept(), false);
    assert.equal(gate.state().reason, "clock");
    assert.equal(gate.state().count, 0);
  });
}
test("clock exception is contained without exposing detail", () => {
  const gate = createProviderEventGate({ now() { throw Error("private provider identity"); } });
  assert.equal(gate.accept(), false);
  assert(!JSON.stringify(gate.state()).includes("private"));
});
test("blocked gate does not continue calling an untrusted clock", () => {
  let calls = 0;
  const gate = createProviderEventGate({ now() { calls++; return 0; }, limit: 1 });
  gate.accept(); gate.accept();
  for (let i = 0; i < 100; i++) assert.equal(gate.accept(), false);
  assert.equal(calls, 2);
});
test("detached gate snapshots retain earlier values", () => {
  const gate = createProviderEventGate({ now: () => 0, limit: 1 });
  const empty = gate.state(); gate.accept(); const full = gate.state(); gate.accept();
  assert.equal(empty.count, 0);
  assert.equal(full.blocked, false);
  assert.equal(gate.state().blocked, true);
});

function observerFixture(gateOptions = {}) {
  const active = new Map(), retained = [], removed = [], seen = [];
  const provider = {
    on(name, fn) { active.set(name, fn); retained.push([name, fn]); },
    removeListener(name) { removed.push(name); active.delete(name); },
  };
  const observation = observeWalletProvider(provider, {
    accountsChanged: value => seen.push(["accounts", value]),
    chainChanged: value => seen.push(["chain", value]),
    disconnect: () => seen.push(["disconnect"]),
  }, () => true, gateOptions);
  return { active, retained, removed, seen, observation,
    emit(name, value) { active.get(name)?.(value); } };
}
test("observer bounds a storm before reading rejected account descriptors", () => {
  const f = observerFixture({ now: () => 0, limit: 2 });
  let reads = 0;
  const payload = new Proxy(["0x" + "11".repeat(20)], {
    getOwnPropertyDescriptor(target, key) { reads++; return Reflect.getOwnPropertyDescriptor(target, key); },
  });
  f.emit("accountsChanged", payload); f.emit("accountsChanged", payload);
  const acceptedReads = reads;
  f.emit("accountsChanged", payload);
  assert.equal(reads, acceptedReads);
  assert.deepEqual(f.seen.map(row => row[0]), ["accounts", "accounts", "disconnect"]);
  assert.equal(f.active.size, 0);
  assert.equal(f.removed.length, 3);
  f.observation.dispose();
});
test("event storm disconnect is delivered once even when extension retains callbacks", () => {
  const f = observerFixture({ now: () => 0, limit: 1 });
  f.emit("chainChanged", "0x2105"); f.emit("chainChanged", "0x2105");
  for (const [name, fn] of f.retained) {
    for (let i = 0; i < 20; i++) fn(name === "accountsChanged" ? [] : "0x2105");
  }
  assert.equal(f.seen.filter(row => row[0] === "disconnect").length, 1);
  assert.equal(f.removed.length, 3);
  f.observation.dispose();
});
test("different event names share the same observer ingress budget", () => {
  const f = observerFixture({ now: () => 0, limit: 2 });
  f.emit("accountsChanged", []); f.emit("chainChanged", "0x2105"); f.emit("disconnect");
  assert.deepEqual(f.seen.map(row => row[0]), ["accounts", "chain", "disconnect"]);
  assert.equal(f.active.size, 0);
  f.observation.dispose();
});
test("healthy lower-frequency provider notifications do not trigger a stop", () => {
  let now = 0;
  const f = observerFixture({ now: () => now, limit: 2 });
  for (let i = 0; i < 10; i++) {
    f.emit("chainChanged", "0x2105"); f.emit("accountsChanged", []);
    now += 1000;
  }
  assert.equal(f.seen.length, 20);
  assert.equal(f.active.size, 3);
  assert(!f.seen.some(row => row[0] === "disconnect"));
  f.observation.dispose();
});
test("observer clock failure closes listeners before calling disconnect handler", () => {
  const active = new Map();
  let disconnected = 0;
  const provider = { on(name, fn) { active.set(name, fn); }, removeListener(name) { active.delete(name); } };
  const observation = observeWalletProvider(provider, {
    accountsChanged() { assert.fail("payload must not be delivered"); },
    chainChanged() { assert.fail("payload must not be delivered"); },
    disconnect() { assert.equal(active.size, 0); disconnected++; },
  }, () => true, { now: () => NaN });
  active.get("chainChanged")("0x2105");
  assert.equal(disconnected, 1);
  observation.dispose();
});
