import test from "node:test";
import assert from "node:assert/strict";
import { createFileReadService } from "../src/file-read-service.js";
import { FILE_SECURITY_LIMIT, FILE_READ_RESERVED_LIMIT } from "../src/file-read-policy.js";
import { fixture, fakeClock, fallbackFile, stalledFile, outcome, code, tick } from "./helpers/file-boundary-fixtures.js";

for (const name of ["now", "schedule", "unschedule"]) {
  for (const value of [null, 0, "function", {}, []]) {
    test(`file policy: invalid scheduler dependency ${name}/${String(value)}`, () => {
      assert.throws(() => createFileReadService({ [name]: value }), code("FILE_OPTIONS"));
    });
  }
}

for (const mode of ["readText", "readBytes"]) {
  for (const value of [null, false, 0, "options", []]) {
    test(`file policy: non-object options ${mode}/${String(value)}`, async t => {
      const service = fixture(t);
      const source = fallbackFile();
      await assert.rejects(service[mode](source.file, value), code("FILE_OPTIONS"));
      assert.equal(source.calls(), 0);
      assert.equal(service.state().accepted, 0);
      assert.equal(service.state().rejected, 1);
    });
  }

  for (const field of ["timeoutMs", "maxBytes"]) {
    for (const value of [0, -1, 1.5, NaN, Infinity, "1", null, 1n, Number.MAX_SAFE_INTEGER]) {
      test(`file policy: invalid bound ${mode}/${field}/${String(value)}`, async t => {
        const service = fixture(t);
        const input = fallbackFile();
        await assert.rejects(service[mode](input.file, { [field]: value }), code("FILE_OPTIONS"));
        assert.equal(input.calls(), 0);
        assert.equal(service.state().active, 0);
        assert.equal(service.state().reservedBytes, 0);
      });
    }
  }
}

test("file policy: options getters are captured once", async t => {
  const clock = fakeClock();
  const service = fixture(t, clock.options);
  const calls = { maxBytes: 0, timeoutMs: 0, signal: 0 };
  const options = {
    get maxBytes() { calls.maxBytes++; return 2; },
    get timeoutMs() { calls.timeoutMs++; return 100; },
    get signal() { calls.signal++; return undefined; },
  };
  assert.equal(await service.readText(fallbackFile().file, options), "ok");
  assert.deepEqual(calls, { maxBytes: 1, timeoutMs: 1, signal: 1 });
});

for (const key of ["maxBytes", "timeoutMs", "signal"]) {
  test("file policy: throwing option getter is sanitized " + key, async t => {
    const service = fixture(t);
    const input = fallbackFile();
    const options = Object.defineProperty({}, key, { get() { throw Error("private policy path"); } });
    await assert.rejects(service.readText(input.file, options), code("FILE_READ"));
    assert.equal(input.calls(), 0);
    assert(!JSON.stringify(service.state()).includes("private"));
  });
}

test("file policy: cancellation during option extraction prevents dispatch", async t => {
  const service = fixture(t);
  const input = fallbackFile();
  const options = { get maxBytes() { service.cancelAll(); return 2; } };
  await assert.rejects(service.readText(input.file, options), code("FILE_CANCELLED"));
  assert.equal(input.calls(), 0);
  assert.equal(service.state().accepted, 0);
});

test("file policy: default options support both text and detached bytes", async t => {
  const service = fixture(t);
  const input = fallbackFile("ok");
  assert.equal(await service.readText(input.file), "ok");
  assert.deepEqual(await service.readBytes(input.file), Uint8Array.of(111, 107));
  assert.equal(service.state().completed, 2);
});

test("file policy: timeout maximum accepted without altering global byte cap", async t => {
  const clock = fakeClock();
  const service = fixture(t, clock.options);
  const input = stalledFile();
  const pending = outcome(service.readText(input.file, { timeoutMs: 120_000 }));
  assert.equal([...clock.timers.values()][0].delay, 120_000);
  assert.equal(service.state().maxReservedBytes, FILE_READ_RESERVED_LIMIT);
  await tick(); service.cancelAll(); input.settle(); await pending; await tick();
});

test("file policy: per-file ceiling does not allocate declaration-sized buffers before IO", async t => {
  const service = fixture(t);
  const input = stalledFile({ size: FILE_SECURITY_LIMIT });
  const pending = outcome(service.readBytes(input.file));
  await tick();
  assert.equal(service.state().reservedBytes, FILE_SECURITY_LIMIT);
  assert.equal(input.calls.read, 1);
  service.cancelAll(); await pending;
  input.settle(); await tick();
  assert.equal(service.state().reservedBytes, 0);
});

test("file policy: observer registration validates functions", t => {
  const service = fixture(t);
  for (const listener of [undefined, null, {}, [], "listener", 1]) {
    assert.throws(() => service.subscribe(listener), code("FILE_OPTIONS"));
  }
  assert.equal(service.state().accepted, 0);
});

test("file policy: repeated observer identity does not duplicate later deliveries", async t => {
  const service = fixture(t);
  let callbacks = 0;
  const observer = () => callbacks++;
  const first = service.subscribe(observer);
  const second = service.subscribe(observer);
  assert.equal(callbacks, 2); // Each explicit subscription supplies an initial snapshot.
  const before = callbacks;
  assert.equal(await service.readText(fallbackFile().file), "ok");
  assert.equal(callbacks - before, 2); // Start and completion, one observer identity.
  first(); second();
});

test("file policy: disposed service subscriptions are inert", t => {
  const service = fixture(t);
  service.dispose();
  let callbacks = 0;
  const unsubscribe = service.subscribe(() => callbacks++);
  assert.equal(typeof unsubscribe, "function");
  unsubscribe(); unsubscribe();
  assert.equal(callbacks, 0);
});

test("file policy: read API and status are immutable capability surfaces", t => {
  const service = fixture(t);
  assert(Object.isFrozen(service));
  assert(Object.isFrozen(service.state()));
  assert.deepEqual(Object.keys(service).sort(), ["cancelAll", "dispose", "readBytes", "readText", "state", "subscribe"]);
  assert.throws(() => { service.cancelAll = () => {}; }, TypeError);
  for (const forbidden of ["save", "write", "sign", "send", "connect", "resetBudget", "retry"]) {
    assert.equal(service[forbidden], undefined);
  }
});

for (const time of [Number.MAX_SAFE_INTEGER, Number.MAX_VALUE]) {
  test("file policy: timestamp too large for an accurate deadline is terminal " + time, async t => {
    const service = fixture(t, { now: () => time });
    const input = fallbackFile();
    await assert.rejects(service.readText(input.file), code("FILE_CLOCK"));
    assert.equal(input.calls(), 0);
    assert.equal(service.state().clockFault, true);
  });
}
