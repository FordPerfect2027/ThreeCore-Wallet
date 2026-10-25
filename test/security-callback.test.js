import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { observeCallbackResult, consumeCallback, acceptTimerHandle, readSynchronousClock } from "../src/security-callback.js";
import { requireSyncExport } from "../src/export-policy.js";
import { createTabGuard } from "../src/tab-guard-controller.js";
import { deterministicCrypto, transportFixture, EPOCH } from "./helpers/tab-guard-fixtures.js";
import { manualTime, microtasks } from "./helpers/secure-lifecycle-time.js";

for (const value of [undefined, null, false, true, 0, 1, -1, "1", Symbol("synthetic"), 1n]) {
  test(`callback result: primitive ${String(value)} remains synchronous without coercion`, () => {
    assert.equal(observeCallbackResult(value, () => assert.fail("No asynchronous settlement")), "synchronous");
  });
}

test("callback result: getter is captured once and method receives original receiver", async () => {
  let reads = 0, calls = 0;
  const received = [];
  const value = { get then() {
    reads++;
    assert.equal(reads, 1);
    return function(resolve) { assert.equal(this, value); calls++; resolve(12); };
  } };
  assert.equal(observeCallbackResult(value, result => received.push(result)), "asynchronous");
  assert.equal(calls, 0, "Thenable body cannot run inside the registration boundary");
  await microtasks();
  assert.equal(calls, 1);
  assert.deepEqual(received, [12]);
});

test("callback result: throwing getter is unreadable and never exposes its error", () => {
  assert.equal(observeCallbackResult({ get then() { throw Error("private content"); } }), "unreadable");
});

test("callback result: nonfunction then property does not coerce or execute", () => {
  const value = { then: { valueOf() { assert.fail(); } }, valueOf() { assert.fail(); } };
  assert.equal(observeCallbackResult(value), "synchronous");
});

for (const kind of ["reject", "throw", "resolve-twice", "resolve-reject", "nested-promise"]) {
  test("callback result: once-only settlement " + kind, async () => {
    const values = [];
    const value = { then(resolve, reject) {
      if (kind === "reject") { reject(Error("private")); return; }
      if (kind === "throw") throw Error("private");
      resolve(kind === "nested-promise" ? Promise.resolve(7) : 7);
      if (kind === "resolve-twice") resolve(9);
      if (kind === "resolve-reject") reject(Error("ignored"));
    } };
    assert.equal(observeCallbackResult(value, v => values.push(v)), "asynchronous");
    await microtasks();
    assert.deepEqual(values, ["reject", "throw"].includes(kind) ? [] : [7]);
  });
}

test("callback cleanup: thrown action and rejected action remain best effort", async () => {
  consumeCallback(() => { throw Error("private"); });
  consumeCallback(() => Promise.reject(Error("private")));
  await microtasks();
});

for (const value of [0, 1, Object.freeze({ nativeHandle: true }), function handle() {}]) {
  test("timer handle: synchronous native identity retained " + typeof value, () => {
    assert.equal(acceptTimerHandle(value, () => assert.fail("No release for accepted handle")), true);
  });
}
for (const value of [undefined, null, false]) {
  test("timer handle: missing registration " + String(value), () => {
    assert.equal(acceptTimerHandle(value, () => assert.fail()), false);
  });
}

test("timer handle: opaque broken handle is released once with the same identity", () => {
  const value = { get then() { throw Error("private"); } }, releases = [];
  assert.equal(acceptTimerHandle(value, handle => releases.push(handle)), false);
  assert.deepEqual(releases, [value]);
});

test("timer handle: late native zero is released even though it is falsy", async () => {
  const releases = [];
  assert.equal(acceptTimerHandle(Promise.resolve(0), handle => releases.push(handle)), false);
  await microtasks();
  assert.deepEqual(releases, [0]);
});

test("timer handle: delayed cleanup failure does not leak a rejection", async () => {
  let releases = 0;
  assert.equal(acceptTimerHandle(Promise.resolve(19), () => {
    releases++; return Promise.reject(Error("private cleanup"));
  }), false);
  await microtasks();
  assert.equal(releases, 1);
});

for (const value of ["100", { valueOf() { assert.fail("No coercion"); } }, Promise.resolve(100), false]) {
  test("clock adapter: non-number response is never a current timestamp " + typeof value, async () => {
    assert(Number.isNaN(readSynchronousClock(() => value)));
    await microtasks();
  });
}
test("clock adapter: numeric policy remains with the consumer", () => {
  for (const value of [0, 100, -1, Infinity, NaN]) assert(Object.is(readSynchronousClock(() => value), value));
});

test("export callback: asynchronous getter is read exactly once", async () => {
  let reads = 0, calls = 0;
  const value = { get then() { reads++; return resolve => { calls++; resolve(); }; } };
  assert.throws(() => requireSyncExport(value), error => error.code === "EXPORT_FAILED");
  await microtasks();
  assert.equal(reads, 1);
  assert.equal(calls, 1);
});

for (const point of ["subscribe", "post", "stop"]) {
  test(`tab callback: ${point} cannot change its then method during validation`, async () => {
    let reads = 0, calls = 0;
    const invalid = { get then() { reads++; return resolve => { calls++; resolve(true); }; } };
    const wire = transportFixture();
    if (point === "subscribe") wire.transport.subscribe = () => invalid;
    if (point === "post") wire.transport.post = () => invalid;
    const time = manualTime(EPOCH);
    const guard = createTabGuard({ ...time.options, transport: wire.transport, crypto: deterministicCrypto(),
      onStop: () => point === "stop" ? invalid : true });
    try {
      const ready = guard.start();
      const result = point === "subscribe" ? ready : guard.stop();
      assert.equal(result, false);
      await microtasks();
      assert.equal(reads, 1);
      assert.equal(calls, 1);
      assert.equal(guard.state().phase, "error");
    } finally { guard.dispose(); }
  });
}

for (const kind of ["then-method", "on-resolved", "cleanup"]) {
  test("callback rejection: native asynchronous " + kind + " is contained", () => {
    const url = new URL("../src/security-callback.js", import.meta.url).href;
    const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", `
      import { observeCallbackResult, consumeCallback } from ${JSON.stringify(url)};
      const kind=${JSON.stringify(kind)};
      if(kind==='then-method')observeCallbackResult({async then(){throw Error('private');}});
      if(kind==='on-resolved')observeCallbackResult(Promise.resolve(1),async()=>{throw Error('private');});
      if(kind==='cleanup')consumeCallback(()=>({async then(){throw Error('private');}}));
      setTimeout(()=>console.log('contained'),15);
    `], { timeout: 10000, encoding: "utf8", windowsHide: true });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, "");
    assert.equal(child.stdout.trim(), "contained");
  });
}
