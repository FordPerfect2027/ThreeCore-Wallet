import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { TAB_GUARD_SCHEMA, TAB_GUARD_TTL, TAB_GUARD_FUTURE, TAB_GUARD_REPLAYS,
  TabGuardError, tabGuardCode, tabGuardId, tabGuardTime, randomTabId,
  createStopSignal, createStopReceipt, validateTabSignal, tabSignalFresh,
  createTabReplayWindow } from "../src/tab-guard-protocol.js";
import { ID_A, ID_B, ID_C, ID_D, EPOCH, idFor, signal } from "./helpers/tab-guard-fixtures.js";

test("stop signal has an exact, immutable metadata-only shape", () => {
  const value = createStopSignal(ID_A, ID_B, EPOCH);
  assert.deepEqual(Object.keys(value), ["schema", "kind", "source", "id", "issuedAt"]);
  assert.equal(value.schema, TAB_GUARD_SCHEMA);
  assert.equal(value.kind, "stop");
  assert(Object.isFrozen(value));
  assert.throws(() => { value.kind = "unlock"; }, TypeError);
});

test("receipt binds receiver, request nonce, original time and original sender", () => {
  const request = createStopSignal(ID_A, ID_B, EPOCH);
  const receipt = createStopReceipt(request, ID_C);
  assert.deepEqual(receipt, { schema: TAB_GUARD_SCHEMA, kind: "receipt", source: ID_C,
    id: ID_B, issuedAt: EPOCH, target: ID_A });
  assert(Object.isFrozen(receipt));
  assert.throws(() => createStopReceipt(receipt, ID_D));
  assert.throws(() => createStopReceipt(request, ID_A));
});

for (const value of [undefined, null, true, 1, "{}", [], new Date(), new Map(), new Set(),
  Object.create({ kind: "stop" })]) {
  test("invalid signal container is refused: " + String(value), () => {
    assert.throws(() => validateTabSignal(value));
  });
}

for (const key of ["schema", "kind", "source", "id", "issuedAt"]) {
  test("missing signal field is refused: " + key, () => {
    const value = signal(); delete value[key];
    assert.throws(() => validateTabSignal(value));
  });
  test("accessor field is refused without invocation: " + key, () => {
    let touched = 0;
    const value = signal();
    Object.defineProperty(value, key, { get() { touched++; return "secret"; } });
    assert.throws(() => validateTabSignal(value));
    assert.equal(touched, 0);
  });
}

for (const key of ["account", "balance", "password", "seed", "address", "payload", "target",
  "__proto__", "constructor", "prototype"]) {
  test("stop never accepts supplemental field: " + key, () => {
    const value = signal();
    Object.defineProperty(value, key, { value: "sensitive fixture", enumerable: true });
    assert.throws(() => validateTabSignal(value));
  });
}

test("symbol and nonenumerable extras cannot hide outside the exact shape", () => {
  const symbol = signal(); symbol[Symbol("hidden")] = 1;
  const hidden = signal(); Object.defineProperty(hidden, "extra", { value: 1 });
  assert.throws(() => validateTabSignal(symbol));
  assert.throws(() => validateTabSignal(hidden));
});

test("a null-prototype record is copied into a normal immutable record", () => {
  const original = Object.assign(Object.create(null), signal());
  const copy = validateTabSignal(original);
  original.id = ID_D;
  assert.equal(copy.id, ID_C);
  assert.equal(Object.getPrototypeOf(copy), Object.prototype);
});

for (const kind of ["unlock", "resume", "connect", "read", "sign", "send", "STOP", "ack", "", 0, null]) {
  test("only stop and receipt kinds exist, refusing " + kind, () => {
    assert.throws(() => validateTabSignal(signal({ kind })));
  });
}

for (const value of ["", "f".repeat(31), "f".repeat(33), "F".repeat(32), "g".repeat(32),
  "0".repeat(32), " " + ID_A, ID_A + "\n", 123, null, {}, [ID_A]]) {
  test("malformed notification identity is refused: " + String(value), () => {
    assert.throws(() => tabGuardId(value));
    assert.throws(() => validateTabSignal(signal({ source: value })));
    assert.throws(() => validateTabSignal(signal({ id: value })));
  });
}

for (const value of [0, -1, 1.2, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER,
  "1780000000000", null, undefined, {}, 8640000000000001]) {
  test("invalid issue time never gets coerced: " + String(value), () => {
    assert.throws(() => tabGuardTime(value));
    assert.throws(() => validateTabSignal(signal({ issuedAt: value })));
  });
}

test("timestamps at representable date limits are accepted without coercion", () => {
  assert.equal(tabGuardTime(1), 1);
  assert.equal(tabGuardTime(8640000000000000), 8640000000000000);
});

test("message lifetime and future tolerance have exact closed/open boundaries", () => {
  const value = signal();
  assert(tabSignalFresh(value, EPOCH));
  assert(tabSignalFresh(value, EPOCH + TAB_GUARD_TTL - 1));
  assert(!tabSignalFresh(value, EPOCH + TAB_GUARD_TTL));
  assert(tabSignalFresh(value, EPOCH - TAB_GUARD_FUTURE));
  assert(!tabSignalFresh(value, EPOCH - TAB_GUARD_FUTURE - 1));
});

test("receipt target is required and must differ from its sender", () => {
  const value = createStopReceipt(signal(), ID_A);
  const missing = { ...value }; delete missing.target;
  assert.throws(() => validateTabSignal(missing));
  assert.throws(() => validateTabSignal({ ...value, target: value.source }));
  let reads = 0;
  const getter = { ...value };
  Object.defineProperty(getter, "target", { get() { reads++; return ID_B; } });
  assert.throws(() => validateTabSignal(getter));
  assert.equal(reads, 0);
});

test("native entropy produces valid fresh 128-bit identifiers", () => {
  const values = new Set(Array.from({ length: 32 }, () => randomTabId(webcrypto)));
  assert.equal(values.size, 32);
  for (const value of values) assert.equal(tabGuardId(value), value);
});

test("entropy buffers are cleared after construction without changing returned ID", () => {
  let buffer;
  const value = randomTabId({ getRandomValues(bytes) { buffer = bytes; bytes.fill(12); } });
  assert.equal(value, "0c".repeat(16));
  assert(buffer.every(byte => byte === 0));
});

for (const crypto of [null, {}, { getRandomValues: false }, { getRandomValues() {} },
  { getRandomValues() { throw Error("private error"); } }]) {
  test("entropy unavailability fails closed without random fallback " + String(crypto), () => {
    assert.throws(() => randomTabId(crypto), { code: "TAB_ENTROPY", message: "TAB_ENTROPY" });
  });
}

test("static errors never echo unknown external codes or prose", () => {
  assert.equal(new TabGuardError("secret").message, "TAB_CONFIG");
  assert.equal(tabGuardCode(Error("password")), "TAB_TRANSPORT");
  assert.equal(tabGuardCode(new TabGuardError("TAB_CLOCK")), "TAB_CLOCK");
});

test("replay window accepts one source-and-nonce pair only once", () => {
  const cache = createTabReplayWindow();
  assert(cache.accept(signal(), EPOCH));
  assert(!cache.accept(signal(), EPOCH + 1));
  assert.equal(cache.size(), 1);
  assert(cache.accept(signal({ source: ID_A }), EPOCH + 1));
  assert(cache.accept(signal({ id: ID_D }), EPOCH + 1));
  assert.equal(cache.size(), 3);
});

test("expired identities are removed while expired payloads remain refused", () => {
  const cache = createTabReplayWindow();
  cache.accept(signal(), EPOCH);
  assert(!cache.accept(signal(), EPOCH + TAB_GUARD_TTL));
  assert.equal(cache.size(), 0);
  assert(cache.accept(signal({ issuedAt: EPOCH + TAB_GUARD_TTL }), EPOCH + TAB_GUARD_TTL));
});

test("future tolerance does not shorten replay retention", () => {
  const cache = createTabReplayWindow();
  const value = signal({ issuedAt: EPOCH + TAB_GUARD_FUTURE });
  assert(cache.accept(value, EPOCH));
  assert(!cache.accept(value, EPOCH + TAB_GUARD_TTL));
  assert.equal(cache.size(), 1);
  assert(!cache.accept(value, EPOCH + TAB_GUARD_TTL + TAB_GUARD_FUTURE));
  assert.equal(cache.size(), 0);
});

test("replay capacity is bounded without evicting still-valid identities", () => {
  const cache = createTabReplayWindow();
  for (let i = 1; i <= TAB_GUARD_REPLAYS; i++) assert(cache.accept(signal({ id: idFor(i) }), EPOCH));
  assert.equal(cache.size(), TAB_GUARD_REPLAYS);
  assert.throws(() => cache.accept(signal({ id: idFor(1000) }), EPOCH), { code: "TAB_FLOOD" });
  assert(!cache.accept(signal({ id: idFor(1) }), EPOCH));
  assert.equal(cache.size(), TAB_GUARD_REPLAYS);
});

test("replay capacity recovers only after expiry or explicit disposal clearing", () => {
  const cache = createTabReplayWindow();
  for (let i = 1; i <= TAB_GUARD_REPLAYS; i++) cache.accept(signal({ id: idFor(i) }), EPOCH);
  assert(cache.accept(signal({ issuedAt: EPOCH + TAB_GUARD_TTL }), EPOCH + TAB_GUARD_TTL));
  assert.equal(cache.size(), 1);
  cache.clear();
  assert.equal(cache.size(), 0);
});

test("replay window refuses clock rollback without accepting the pending message", () => {
  const cache = createTabReplayWindow();
  cache.accept(signal(), EPOCH + 10);
  assert.throws(() => cache.accept(signal({ id: ID_D }), EPOCH), { code: "TAB_CLOCK" });
  assert.equal(cache.size(), 1);
});
