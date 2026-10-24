import test from "node:test";
import assert from "node:assert/strict";
import { createExportGuard } from "../src/export-guard.js";
import { EXPORT_LIMITS } from "../src/export-policy.js";
import { inspectExportStatus } from "../src/export-status.js";
import { guardFixture, prepared, PRIVATE, assertPrivate } from "./helpers/export-fixtures.js";

const code = (action, expected) => assert.throws(action, error => error.code === expected && error.message === expected);

test("export offer is synchronous and never asserts that a file was saved", () => {
  const f = guardFixture();
  const receipt = f.offer();
  assert.deepEqual(receipt, { schema: "threecore-export-offer-v1", offered: true,
    downloadComplete: false, byteLength: 16, kind: "json" });
  assert(Object.isFrozen(receipt));
  assert.deepEqual(f.events, ["activate"]);
  assert.equal(f.guard.state().active, 1);
  assert.equal(f.guard.state().reservedBytes, 16);
  assert.equal(f.resources[0].current(), true);
  f.expire();
  assert.deepEqual(f.events, ["activate", "release"]);
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.guard.state().released, 1);
  assert.equal(f.resources[0].current(), false);
});

test("export reserves quota before calling the resource factory", () => {
  const f = guardFixture();
  let observed;
  f.factory(payload => {
    observed = f.guard.state();
    return { activate() {}, release() {} };
  });
  f.offer();
  assert.equal(observed.active, 1);
  assert.equal(observed.reservedBytes, 16);
  f.guard.dispose();
});

test("four simultaneous offers reject a fifth before allocating", () => {
  const f = guardFixture();
  for (let i = 0; i < 4; i++) f.offer();
  code(() => f.offer(), "EXPORT_BUSY");
  assert.equal(f.resources.length, 4);
  assert.equal(f.guard.state().rejected, 1);
  assert.equal(f.guard.state().canOffer, false);
  assert.equal(f.guard.state().reservedBytes, 64);
  f.expire();
  assert.equal(f.guard.state().canOffer, true);
  f.offer();
  assert.equal(f.guard.state().offered, 5);
  f.guard.clear();
});

test("aggregate bytes reject a second large offer below the count limit", () => {
  const f = guardFixture();
  const text = "x".repeat(65 * 1024 * 1024);
  f.offer(prepared({ text }));
  code(() => f.offer(prepared({ text })), "EXPORT_BUSY");
  assert.equal(f.resources.length, 1);
  assert.equal(f.guard.state().active, 1);
  assert.equal(f.guard.state().reservedBytes, text.length);
  f.guard.clear();
});

test("aggregate exact byte boundary accepts two 64 MiB payloads", () => {
  const f = guardFixture();
  const text = "x".repeat(64 * 1024 * 1024);
  f.offer(prepared({ text }));
  f.offer(prepared({ text }));
  assert.equal(f.guard.state().reservedBytes, EXPORT_LIMITS.totalBytes);
  assert.equal(f.guard.state().canOffer, false);
  code(() => f.offer(prepared({ text: "x" })), "EXPORT_BUSY");
  f.guard.clear();
  assert.equal(f.guard.state().reservedBytes, 0);
});

test("a single over-limit file allocates no resource or timer", () => {
  const f = guardFixture();
  code(() => f.offer(prepared({ text: "x".repeat(EXPORT_LIMITS.fileBytes + 1) })), "EXPORT_SIZE");
  assert.equal(f.resources.length, 0);
  assert.equal(f.clock.installed.length, 0);
  assert.equal(f.guard.state().accepted, 0);
  assert.equal(f.guard.state().rejected, 1);
});

test("invalid input has no allocation, byte reservation or activation", () => {
  const f = guardFixture();
  code(() => f.offer(prepared({ filename: "../private.json" })), "EXPORT_NAME");
  assert.equal(f.resources.length, 0);
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.guard.state().accepted, 0);
  assert.equal(f.guard.state().failed, 0);
});

test("a factory exception drops the reservation without leaking its message", () => {
  const f = guardFixture({ createResource() { throw Error(PRIVATE); } });
  code(() => f.offer(), "EXPORT_FAILED");
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.guard.state().failed, 1);
  assert.equal(f.guard.state().released, 1);
  assertPrivate(assert, f.guard.state());
});

test("activation exception releases the captured resource and cancels its timer", () => {
  let released = 0;
  const f = guardFixture({ createResource: () => ({
    activate() { throw Error(PRIVATE); }, release() { released++; },
  }) });
  code(() => f.offer(), "EXPORT_FAILED");
  assert(released >= 1);
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.clock.timers.size, 0);
  assert.equal(f.guard.state().offered, 0);
});

test("activation getter exception still invokes the previously captured release", () => {
  let released = 0;
  const f = guardFixture({ createResource: () => ({
    get activate() { throw Error(PRIVATE); }, release() { released++; },
  }) });
  code(() => f.offer(), "EXPORT_FAILED");
  assert(released >= 1);
  assert.equal(f.guard.state().reservedBytes, 0);
});

for (const resource of [null, undefined, {}, { activate() {} }, { release() {} },
  { activate: 1, release() {} }, { activate() {}, release: 1 }]) {
  test("incomplete resource contract is rejected: " + JSON.stringify(resource), () => {
    const f = guardFixture({ createResource: () => resource });
    code(() => f.offer(), "EXPORT_UNAVAILABLE");
    assert.equal(f.guard.state().active, 0);
    assert.equal(f.guard.state().offered, 0);
  });
}

for (const field of ["createResource", "now", "schedule", "unschedule"]) {
  for (const value of [null, false, 1, {}, "callback"]) {
    test("export requires callable dependency " + field + "/" + typeof value, () => {
      code(() => createExportGuard({ createResource() {}, [field]: value }), "EXPORT_OPTIONS");
    });
  }
}

test("late replacement of activate and release does not change captured functions", () => {
  const events = [], resource = {
    activate() { events.push("original-activate"); resource.release = () => { throw Error(PRIVATE); }; },
    release() { events.push("original-release"); },
  };
  const f = guardFixture({ createResource: () => resource });
  f.offer();
  f.expire();
  assert.deepEqual(events, ["original-activate", "original-release"]);
});

test("caller mutations after handoff do not change a resource's immutable snapshot", () => {
  const f = guardFixture(), input = prepared();
  f.offer(input);
  input.text = "replacement";
  input.filename = "replacement.html";
  assert.equal(f.resources[0].payload.text, '{"example":true}');
  assert(Object.isFrozen(f.resources[0].payload));
  f.guard.clear();
});

test("published state is immutable, valid and contains aggregate diagnostics only", () => {
  const f = guardFixture();
  f.offer(prepared({ text: PRIVATE }));
  const state = f.guard.state();
  assert(Object.isFrozen(state));
  assert(inspectExportStatus(state));
  assertPrivate(assert, state);
  f.guard.clear();
  assert.equal(state.active, 1);
  assert.equal(f.guard.state().active, 0);
});

test("clear stops all offers, releases all bytes and remains idempotent", () => {
  const f = guardFixture();
  for (let i = 0; i < 4; i++) f.offer();
  assert.equal(f.guard.clear(), true);
  assert.equal(f.guard.clear(), true);
  assert.equal(f.guard.state().released, 4);
  assert.equal(f.guard.state().reservedBytes, 0);
  assert.equal(f.clock.timers.size, 0);
  assert(f.resources.every(item => item.releases === 1 && !item.live));
});

test("dispose refuses future offers and leaves an immutable closed status", () => {
  const f = guardFixture();
  f.offer();
  f.guard.dispose();
  f.guard.dispose();
  code(() => f.offer(), "EXPORT_DISPOSED");
  assert.equal(f.guard.state().disposed, true);
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.guard.state().canOffer, false);
  assert(inspectExportStatus(f.guard.state()));
});

test("independent guard budgets cannot release each other's resources", () => {
  const first = guardFixture(), second = guardFixture();
  first.offer(); second.offer();
  first.guard.dispose();
  assert.equal(second.guard.state().active, 1);
  assert.equal(second.resources[0].releases, 0);
  second.guard.clear();
});

test("observer count is bounded and unsubscribing makes room", () => {
  const f = guardFixture(), unsubscribe = [];
  for (let i = 0; i < EXPORT_LIMITS.observers; i++) unsubscribe.push(f.guard.subscribe(() => {}));
  code(() => f.guard.subscribe(() => {}), "EXPORT_BUSY");
  unsubscribe[0]();
  assert.equal(typeof f.guard.subscribe(() => {}), "function");
  f.guard.dispose();
});

test("duplicate listener does not consume another observer slot", () => {
  const f = guardFixture(), callback = () => {};
  for (let i = 0; i < 100; i++) f.guard.subscribe(callback);
  f.offer();
  f.guard.dispose();
});

test("subscriber removal during publication prevents later invocation", () => {
  const f = guardFixture();
  let unsubscribe = () => {}, count = 0;
  f.guard.subscribe(state => { if (state.offered) unsubscribe(); });
  unsubscribe = f.guard.subscribe(() => count++);
  assert.equal(count, 1);
  f.offer();
  assert.equal(count, 1);
  f.guard.dispose();
});

test("subscriber exceptions cannot prevent another listener or cleanup", async () => {
  const f = guardFixture(), states = [];
  f.guard.subscribe(() => { throw Error(PRIVATE); });
  f.guard.subscribe(() => Promise.reject(Error(PRIVATE)));
  f.guard.subscribe(state => states.push(state));
  f.offer(); f.guard.clear();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(states.at(-1).active, 0);
  assert.equal(f.guard.state().released, 1);
  assertPrivate(assert, states);
});

test("subscription after disposal is inert", () => {
  const f = guardFixture();
  f.guard.dispose();
  let count = 0;
  const unsubscribe = f.guard.subscribe(() => count++);
  unsubscribe();
  assert.equal(count, 0);
});

test("invalid subscriber cannot change the guard", () => {
  const f = guardFixture();
  code(() => f.guard.subscribe(null), "EXPORT_OPTIONS");
  assert.equal(f.guard.state().active, 0);
});
