import test from "node:test";
import assert from "node:assert/strict";
import { sha256Hex } from "../src/security-data.js";
const input = new TextEncoder().encode("abc");
const tick = () => new Promise(resolve => setImmediate(resolve));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const outcome = promise => promise.then(value => ({ value }), error => ({ code: error.code }));

test("pre-cancelled digest does not invoke the crypto adapter", async () => {
  const aborter = new AbortController(); aborter.abort(); let calls = 0;
  assert.deepEqual(await outcome(sha256Hex(input, { digest() { calls++; return new ArrayBuffer(32); } }, { signal: aborter.signal })), { code: "CHECKSUM_CANCELLED" });
  assert.equal(calls, 0);
});

for (const late of ["resolve", "reject"]) {
  test(`cancel releases the local digest wait before late ${late}`, async () => {
    const gate = deferred(), aborter = new AbortController(); let settled = false;
    const pending = outcome(sha256Hex(input, { digest: () => gate.promise }, { signal: aborter.signal })).then(value => { settled = true; return value; });
    try {
      await tick(); aborter.abort(); await tick();
      assert.equal(settled, true);
      assert.deepEqual(await pending, { code: "CHECKSUM_CANCELLED" });
    } finally { late === "resolve" ? gate.resolve(new ArrayBuffer(32)) : gate.reject(Error("synthetic late failure")); await pending; await tick(); }
  });
}

test("cancel from a digest getter prevents dispatch", async () => {
  const aborter = new AbortController(); let calls = 0;
  const subtle = { get digest() { aborter.abort(); return () => { calls++; return new ArrayBuffer(32); }; } };
  assert.deepEqual(await outcome(sha256Hex(input, subtle, { signal: aborter.signal })), { code: "CHECKSUM_CANCELLED" });
  assert.equal(calls, 0);
});

test("native aborted state cannot be shadowed by an instance field", async () => {
  const aborter = new AbortController(); aborter.abort();
  Object.defineProperty(aborter.signal, "aborted", { value: false });
  assert.deepEqual(await outcome(sha256Hex(input, undefined, { signal: aborter.signal })), { code: "CHECKSUM_CANCELLED" });
});

test("timeout ends a stalled digest wait", async () => {
  const gate = deferred(); let settled = false;
  const pending = outcome(sha256Hex(input, { digest: () => gate.promise }, { timeoutMs: 5 })).then(value => { settled = true; return value; });
  try { await delay(25); assert.equal(settled, true); assert.deepEqual(await pending, { code: "CHECKSUM_TIMEOUT" }); }
  finally { gate.resolve(new ArrayBuffer(32)); await pending; await tick(); }
});

test("late completion checks elapsed time even before a delayed timer runs", async () => {
  const gate = deferred(); const pending = outcome(sha256Hex(input, { digest: () => gate.promise }, { timeoutMs: 5 }));
  const until = performance.now() + 15;
  while (performance.now() < until) { /* Model a blocked main thread. */ }
  gate.resolve(new ArrayBuffer(32));
  assert.deepEqual(await pending, { code: "CHECKSUM_TIMEOUT" });
});

test("cancelled native work retains bounded admission until it settles", async () => {
  const jobs = [], gates = []; let overflowCalls = 0, overflowSettled = false, overflow;
  try {
    for (let index = 0; index < 8; index++) {
      const gate = deferred(), aborter = new AbortController(); gates.push(gate);
      jobs.push(outcome(sha256Hex(input, { digest: () => gate.promise }, { signal: aborter.signal })));
      aborter.abort();
    }
    const gate = deferred(); gates.push(gate);
    overflow = outcome(sha256Hex(input, { digest() { overflowCalls++; return gate.promise; } })).then(value => { overflowSettled = true; return value; });
    await tick(); assert.equal(overflowSettled, true);
    assert.deepEqual(await overflow, { code: "CHECKSUM_BUSY" }); assert.equal(overflowCalls, 0);
    assert.deepEqual(await Promise.all(jobs), Array.from({ length: 8 }, () => ({ code: "CHECKSUM_CANCELLED" })));
  } finally { gates.forEach(gate => gate.resolve(new ArrayBuffer(32))); await Promise.all(jobs); await overflow; await tick(); }
  assert.equal((await sha256Hex(input)).length, 64);
});

test("input-byte admission remains occupied by cancelled crypto work", async () => {
  const bytes = new Uint8Array(70 * 1024 * 1024), gate = deferred(), aborter = new AbortController(); let calls = 0;
  const pending = outcome(sha256Hex(bytes, { digest: () => gate.promise }, { signal: aborter.signal })); aborter.abort();
  try {
    assert.deepEqual(await outcome(sha256Hex(bytes, { digest() { calls++; return new ArrayBuffer(32); } })), { code: "CHECKSUM_BUSY" });
    assert.equal(calls, 0);
  } finally { gate.resolve(new ArrayBuffer(32)); await pending; await tick(); }
});

test("one cancelled digest does not cancel another", async () => {
  const gate = deferred(), other = deferred(), aborter = new AbortController();
  const first = outcome(sha256Hex(input, { digest: () => gate.promise }, { signal: aborter.signal }));
  const second = sha256Hex(input, { digest: () => other.promise });
  aborter.abort(); other.resolve(new ArrayBuffer(32));
  try { assert.equal(await second, "0".repeat(64)); }
  finally { gate.resolve(new ArrayBuffer(32)); await first; await tick(); }
});

test("digest option accessors are not executed", async () => {
  let reads = 0;
  assert.deepEqual(await outcome(sha256Hex(input, undefined, { get signal() { reads++; return null; } })), { code: "CHECKSUM_OPTIONS" });
  assert.equal(reads, 0);
});

for (const timeoutMs of [0, -1, 30_001, Infinity, "5"]) {
  test(`invalid digest deadline is rejected: ${timeoutMs}`, async () => {
    let calls = 0;
    assert.deepEqual(await outcome(sha256Hex(input, { digest() { calls++; return new ArrayBuffer(32); } }, { timeoutMs })), { code: "CHECKSUM_OPTIONS" });
    assert.equal(calls, 0);
  });
}

test("cancellation during an adapter state read cannot dispatch work", async () => {
  let listener, calls = 0, removes = 0;
  const signal = { get aborted() { listener?.(); return false; },
    addEventListener(_event, value) { listener = value; }, removeEventListener() { removes++; listener = null; } };
  assert.deepEqual(await outcome(sha256Hex(input, { digest() { calls++; return new ArrayBuffer(32); } }, { signal })), { code: "CHECKSUM_CANCELLED" });
  assert.equal(calls, 0); assert.equal(removes, 1);
});

test("asynchronous listener installation is rejected and its late registration is removed", async () => {
  const gate = deferred(); let removes = 0, calls = 0;
  const signal = { aborted: false, addEventListener() { return gate.promise; }, removeEventListener() { removes++; } };
  assert.deepEqual(await outcome(sha256Hex(input, { digest() { calls++; return new ArrayBuffer(32); } }, { signal })), { code: "CHECKSUM_OPTIONS" });
  assert.equal(calls, 0); assert.equal(removes, 1);
  gate.resolve(); await tick(); assert.equal(removes, 2);
});

test("failed adapter setup releases its admission reservation", async () => {
  for (let index = 0; index < 12; index++) {
    const signal = { aborted: false, addEventListener() { throw Error("synthetic detail"); }, removeEventListener() {} };
    assert.deepEqual(await outcome(sha256Hex(input, undefined, { signal })), { code: "CHECKSUM_OPTIONS" });
  }
  assert.equal((await sha256Hex(input)).length, 64);
});

test("invalid native inputs cannot understate the reserved byte size", async () => {
  const detached = new Uint8Array(1); structuredClone(detached.buffer, { transfer: [detached.buffer] });
  const resizable = new Uint8Array(new ArrayBuffer(1, { maxByteLength: 1024 }));
  for (const bytes of [detached, resizable, new Uint8Array(new SharedArrayBuffer(1)), new Uint16Array(1)]) {
    assert.deepEqual(await outcome(sha256Hex(bytes)), { code: "CHECKSUM_OPTIONS" });
  }
  const tooLarge = new Uint8Array(96 * 1024 * 1024 + 1);
  Object.defineProperty(tooLarge, "byteLength", { value: 1 });
  assert.deepEqual(await outcome(sha256Hex(tooLarge)), { code: "CHECKSUM_SIZE" });
});

test("empty fixed input remains a valid SHA-256 message", async () => {
  assert.equal(await sha256Hex(new Uint8Array()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
});
