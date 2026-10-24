import test from "node:test";
import assert from "node:assert/strict";
import { inspectExportStatus, describeExportStatus } from "../src/export-status.js";
import { EXPORT_LIMITS } from "../src/export-policy.js";
import { guardFixture, PRIVATE } from "./helpers/export-fixtures.js";

const snapshot = changes => ({ ...guardFixture().guard.state(), ...changes });

test("status accepts every snapshot in a normal offer lifecycle", () => {
  const f = guardFixture(), seen = [];
  f.guard.subscribe(state => seen.push(state));
  f.offer(); f.expire(); f.guard.dispose();
  assert(seen.length >= 4);
  for (const state of seen) assert(inspectExportStatus(state));
  assert.equal(describeExportStatus(seen[0]).kind, "ready");
  assert.equal(describeExportStatus(seen.at(-1)).kind, "closed");
});

test("status exposes retained and capacity-limited phases separately", () => {
  const f = guardFixture();
  f.offer();
  assert.equal(describeExportStatus(f.guard.state()).kind, "retaining");
  for (let i = 0; i < 3; i++) f.offer();
  assert.equal(describeExportStatus(f.guard.state()).kind, "limited");
  f.guard.clear();
});

test("status cleanup and clock faults are distinct and never claim saved completion", () => {
  const cleanup = guardFixture({ createResource: () => ({ activate() {}, release: () => false }) });
  cleanup.offer(); cleanup.guard.clear();
  assert.equal(describeExportStatus(cleanup.guard.state()).kind, "cleanup");
  const clock = guardFixture({ now: () => NaN });
  assert.throws(() => clock.offer());
  assert.equal(describeExportStatus(clock.guard.state()).kind, "clock");
  assert(describeExportStatus(cleanup.guard.state()).detail.includes("追加の保存開始を止めています"));
});

for (const field of ["schema", "disposed", "clockFault", "cleanupBlocked", "canOffer", "active",
  "pendingCleanup", "reservedBytes", "maxActive", "maxReservedBytes", "accepted", "offered", "rejected", "failed", "released"]) {
  test("status rejects missing field " + field, () => {
    const state = snapshot(); delete state[field];
    assert.equal(inspectExportStatus(state), null);
    assert.equal(describeExportStatus(state).kind, "unavailable");
  });
  test("status rejects accessor without reading it " + field, () => {
    const state = snapshot(); let reads = 0;
    Object.defineProperty(state, field, { get() { reads++; throw Error(PRIVATE); } });
    assert.equal(inspectExportStatus(state), null);
    assert.equal(reads, 0);
  });
}

for (const field of ["active", "pendingCleanup", "reservedBytes", "maxActive", "maxReservedBytes", "accepted", "offered", "rejected", "failed", "released"]) {
  for (const value of [-1, 1.5, NaN, Infinity, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
    test("status rejects non-counter " + field + "/" + String(value), () => {
      assert.equal(inspectExportStatus(snapshot({ [field]: value })), null);
    });
  }
}

for (const field of ["disposed", "clockFault", "cleanupBlocked", "canOffer"]) {
  for (const value of [0, 1, "false", null, undefined]) {
    test("status does not coerce boolean " + field + "/" + String(value), () => {
      assert.equal(inspectExportStatus(snapshot({ [field]: value })), null);
    });
  }
}

for (const changes of [
  { schema: "unknown" }, { active: 1 }, { reservedBytes: 1 },
  { active: 5, accepted: 5, reservedBytes: 5, canOffer: false },
  { active: 1, accepted: 1, reservedBytes: EXPORT_LIMITS.totalBytes + 1, canOffer: false },
  { active: 2, accepted: 2, reservedBytes: 1 },
  { pendingCleanup: 1, cleanupBlocked: true, canOffer: false },
  { offered: 1 }, { failed: 1 }, { released: 1 }, { maxActive: 5 },
  { maxReservedBytes: 1 }, { cleanupBlocked: true, canOffer: false },
  { disposed: true }, { clockFault: true }, { canOffer: false },
]) {
  test("status rejects inconsistent state " + JSON.stringify(changes), () => {
    assert.equal(inspectExportStatus(snapshot(changes)), null);
  });
}

test("status rejects extra fields that could carry filenames or private content", () => {
  const state = snapshot({ filename: PRIVATE });
  assert.equal(inspectExportStatus(state), null);
  assert.equal(JSON.stringify(describeExportStatus(state)).includes(PRIVATE), false);
});

test("status rejects symbol fields and inherited records", () => {
  const state = snapshot(); state[Symbol("hidden")] = PRIVATE;
  assert.equal(inspectExportStatus(state), null);
  assert.equal(inspectExportStatus(Object.create(snapshot())), null);
});

test("status safely handles revoked and throwing proxies", () => {
  const pair = Proxy.revocable(snapshot(), {}); pair.revoke();
  assert.equal(inspectExportStatus(pair.proxy), null);
  for (const trap of ["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"]) {
    const value = new Proxy(snapshot(), { [trap]() { throw Error(PRIVATE); } });
    assert.equal(inspectExportStatus(value), null);
    assert.equal(describeExportStatus(value).kind, "unavailable");
  }
});

test("status accepts null-prototype data and freezes the normalized snapshot", () => {
  const state = inspectExportStatus(Object.assign(Object.create(null), snapshot()));
  assert(state); assert(Object.isFrozen(state));
  assert.throws(() => { state.active = 4; }, TypeError);
});

test("status display never serializes input fields into its error message", () => {
  const hostile = snapshot({ schema: '<img src=x onerror="' + PRIVATE + '">' });
  const text = JSON.stringify(describeExportStatus(hostile));
  assert(!text.includes("<img")); assert(!text.includes(PRIVATE));
});

test("status permits saturated counters without numeric overflow", () => {
  const state = snapshot({ accepted: Number.MAX_SAFE_INTEGER, offered: Number.MAX_SAFE_INTEGER,
    rejected: Number.MAX_SAFE_INTEGER, failed: Number.MAX_SAFE_INTEGER, released: Number.MAX_SAFE_INTEGER });
  assert(inspectExportStatus(state));
  assert(!describeExportStatus(state).counts.includes("Infinity"));
});
