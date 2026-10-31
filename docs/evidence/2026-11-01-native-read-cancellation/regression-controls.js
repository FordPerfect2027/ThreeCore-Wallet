import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { readTokenIdentity } from "../src/token-identity-reader.js";
import { readTransferSnapshot } from "../src/transfer-reader.js";
import { readAllowanceSnapshot } from "../src/allowance-reader.js";
import { collectPeriod } from "../src/period-reader.js";
import { readerSession } from "./helpers/identity-fixtures.js";
import { readerFixture, REQUEST } from "./helpers/transfer-fixtures.js";
import { fakeReader, targets } from "./helpers/allowance-fixtures.js";
import { periodSession, plan } from "./helpers/period-fixtures.js";

const entries = [
  ["IDENTITY", readerSession, (f, o) => readTokenIdentity(f.session, o)],
  ["TRANSFER", readerFixture, (f, o) => readTransferSnapshot(f.session, REQUEST, o)],
  ["ALLOWANCE", fakeReader, (f, o) => readAllowanceSnapshot(f.session, targets(), o)],
  ["PERIOD", periodSession, (f, o) => collectPeriod(f.session, plan(), o)],
];

for (const [name, fixture, read] of entries) {
  for (const revoked of [false, true]) {
    test(`${name}: unusable signal proxy has a typed failure, revoked=${revoked}`, async () => {
      const f = fixture(), controller = new AbortController();
      const proxy = Proxy.revocable(controller.signal, { get() { throw Error("private proxy detail"); } });
      if (revoked) proxy.revoke();
      await assert.rejects(read(f, { signal: proxy.proxy, timeoutMs: 1000 }), { code: name + "_SIGNAL" });
      assert.deepEqual(f.calls, []);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    });
  }
  for (const field of ["aborted", "addEventListener", "removeEventListener"]) {
    test(`${name}: native cancellation ignores instance override ${field}`, async () => {
      const f = fixture(), controller = new AbortController();
      let touched = 0;
      Object.defineProperty(controller.signal, field, { configurable: true, get() { touched++; throw Error("private adapter detail"); } });
      await read(f, { signal: controller.signal, timeoutMs: 1000 });
      assert.equal(touched, 0);
      assert(f.calls.length > 0);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    });
  }
  test(`${name}: borrowed signal prototype is rejected before reads`, async () => {
    const f = fixture();
    await assert.rejects(read(f, { signal: Object.create(AbortSignal.prototype), timeoutMs: 1000 }), { code: name + "_SIGNAL" });
    assert.deepEqual(f.calls, []);
  });
  test(`${name}: dispatched abort event alone is not native cancellation`, async () => {
    const f = fixture(), controller = new AbortController();
    let dispatched = false;
    await read(f, { signal: controller.signal, onProgress() {
      if (!dispatched) { dispatched = true; controller.signal.dispatchEvent(new Event("abort")); }
    } });
    assert(dispatched);
    assert.equal(controller.signal.aborted, false);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
  test(`${name}: real cancellation still works after a dispatched event`, async () => {
    const f = fixture(), controller = new AbortController();
    let progress = 0;
    await assert.rejects(read(f, { signal: controller.signal, onProgress() {
      progress++;
      if (progress === 1) controller.signal.dispatchEvent(new Event("abort"));
      else controller.abort();
    } }), { code: name + "_CANCELLED" });
    assert.equal(progress, 2);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
  test(`${name}: already cancelled native signal cannot be hidden by own property`, async () => {
    const f = fixture(), controller = new AbortController();
    controller.abort();
    Object.defineProperty(controller.signal, "aborted", { value: false });
    await assert.rejects(read(f, { signal: controller.signal, timeoutMs: 1000 }), { code: name + "_CANCELLED" });
    assert.deepEqual(f.calls, []);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
  test(`${name}: cancelled provider wait cannot issue subsequent calls`, async () => {
    const f = fixture(), controller = new AbortController();
    let release;
    const original = f.session.getBlockSnapshot;
    let calls = 0;
    f.session.getBlockSnapshot = async (...args) => { calls++; await new Promise(resolve => { release = resolve; }); return original(...args); };
    const result = read(f, { signal: controller.signal, timeoutMs: 1000 });
    await new Promise(resolve => setImmediate(resolve));
    controller.abort();
    await assert.rejects(result, { code: name + "_CANCELLED" });
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(f.calls.length, 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });
}
