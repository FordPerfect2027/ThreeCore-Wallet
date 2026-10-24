import test from "node:test";
import assert from "node:assert/strict";
import { fixture, bytes, tick, code, outcome, fakeClock, stalledFile, streamFile, fallbackFile } from "./helpers/file-boundary-fixtures.js";

for (const mode of ["readText", "readBytes"]) {
  for (const time of [100, 101, 1_000_000]) {
    test(`file deadline: delayed timer cannot accept late fallback ${mode}/${time}`, async t => {
      const clock = fakeClock();
      const service = fixture(t, clock.options);
      const input = stalledFile({ stream: false, size: 2 });
      const pending = outcome(service[mode](input.file, { timeoutMs: 100 }));
      await tick();
      clock.set(time);
      input.gate.resolve(bytes("ok").buffer);
      assert.deepEqual(await pending, { code: "FILE_TIMEOUT" });
      assert.equal(service.state().timedOut, 1);
      assert.equal(service.state().completed, 0);
      assert.equal(clock.timers.size, 0);
    });
  }

  test("file deadline: exact boundary applies before terminal packet " + mode, async t => {
    const clock = fakeClock();
    const service = fixture(t, clock.options);
    const input = streamFile([bytes("ok")], { onRead(index) {
      if (!index) return { done: false, value: bytes("ok") };
      clock.set(100);
      return { done: true };
    } });
    await assert.rejects(service[mode](input.file, { timeoutMs: 100 }), code("FILE_TIMEOUT"));
    assert.equal(input.calls.cancel, 1);
    assert.equal(input.calls.release, 1);
    assert.equal(service.state().completed, 0);
  });

  test("file deadline: final copy still checks the current clock " + mode, async t => {
    let calls = 0;
    const clock = fakeClock();
    const service = fixture(t, { ...clock.options, now() { return ++calls >= 7 ? 100 : 0; } });
    await assert.rejects(service[mode](fallbackFile("ok").file, { timeoutMs: 100 }), code("FILE_TIMEOUT"));
    assert.equal(service.state().active, 0);
    assert.equal(service.state().completed, 0);
  });
}

test("file deadline: early timer rearms against elapsed time", async t => {
  const clock = fakeClock(100);
  const service = fixture(t, clock.options);
  const input = stalledFile();
  const pending = outcome(service.readText(input.file, { timeoutMs: 100 }));
  await tick();
  clock.set(140); clock.fire();
  assert.equal(service.state().waiting, 1);
  assert.equal(clock.timers.size, 1);
  assert.equal([...clock.timers.values()][0].delay, 60);
  clock.set(199); clock.fire();
  assert.equal([...clock.timers.values()][0].delay, 1);
  clock.set(200); clock.fire();
  assert.deepEqual(await pending, { code: "FILE_TIMEOUT" });
  assert.equal(service.state().retained, 1);
  input.settle(); await tick();
});

test("file deadline: cancelled timer cannot stop a newer file", async t => {
  const clock = fakeClock();
  const service = fixture(t, clock.options);
  const a = stalledFile();
  const first = outcome(service.readText(a.file, { timeoutMs: 20 }));
  const obsolete = [...clock.timers.values()][0].action;
  await tick(); service.cancelAll(); await first;
  a.settle(); await tick();
  const b = stalledFile();
  const second = outcome(service.readText(b.file, { timeoutMs: 100 }));
  await tick();
  clock.set(30); obsolete();
  assert.equal(service.state().waiting, 1);
  assert.equal(service.state().timedOut, 0);
  service.cancelAll(); b.settle(); await second; await tick();
});

for (const invalid of [-1, NaN, Infinity, "100", null, undefined]) {
  test("file clock: invalid timestamp fails before inspecting source " + String(invalid), async t => {
    const service = fixture(t, { now: () => invalid });
    const input = new Proxy({}, { get() { throw Error("file inspected"); } });
    await assert.rejects(service.readText(input), code("FILE_CLOCK"));
    assert.equal(service.state().clockFault, true);
    assert.equal(service.state().accepted, 0);
    assert.equal(service.state().canStart, false);
  });
}

test("file clock: rollback stops every current waiter and latches", async t => {
  const clock = fakeClock(100);
  const service = fixture(t, clock.options);
  const files = Array.from({ length: 3 }, () => stalledFile());
  const pending = files.map(item => outcome(service.readText(item.file)));
  await tick();
  clock.set(99); clock.fire();
  assert.deepEqual(await Promise.all(pending), files.map(() => ({ code: "FILE_CLOCK" })));
  assert.equal(service.state().clockFault, true);
  assert.equal(service.state().retained, 3);
  clock.set(101);
  await assert.rejects(service.readText(fallbackFile().file), code("FILE_CLOCK"));
  files.forEach(item => item.settle()); await tick();
  assert.equal(service.state().active, 0);
  assert.equal(service.state().canStart, false);
});

test("file clock: thrown clock error is sanitized and terminal", async t => {
  const service = fixture(t, { now() { throw Error("secret clock state"); } });
  await assert.rejects(service.readText(fallbackFile().file), code("FILE_CLOCK"));
  assert(!JSON.stringify(service.state()).includes("secret"));
});

test("file deadline: slow metadata cannot reset the deadline", async t => {
  const clock = fakeClock();
  const service = fixture(t, clock.options);
  const input = fallbackFile("ok");
  Object.defineProperty(input.file, "size", { get() { clock.set(100); return 2; } });
  await assert.rejects(service.readText(input.file, { timeoutMs: 100 }), code("FILE_TIMEOUT"));
  assert.equal(input.calls(), 0);
  assert.equal(service.state().active, 0);
});

test("file deadline: stream setup time counts toward total deadline", async t => {
  const clock = fakeClock();
  const service = fixture(t, clock.options);
  const input = streamFile([bytes("ok")]);
  input.stream.getReader = () => { clock.set(100); return input.reader; };
  await assert.rejects(service.readText(input.file, { timeoutMs: 100 }), code("FILE_TIMEOUT"));
  assert.equal(input.calls.read, 0);
  assert.equal(input.calls.cancel, 1);
  assert.equal(input.calls.release, 1);
});

test("file deadline: native fallback remains counted after timer expiry", async t => {
  const clock = fakeClock();
  const service = fixture(t, clock.options);
  const input = stalledFile({ stream: false, size: 2 });
  const pending = outcome(service.readText(input.file, { timeoutMs: 10 }));
  await tick(); clock.set(10); clock.fire();
  assert.deepEqual(await pending, { code: "FILE_TIMEOUT" });
  assert.equal(service.state().reservedBytes, 2);
  assert.equal(service.state().retained, 1);
  input.gate.resolve(bytes("ok").buffer); await tick();
  assert.equal(service.state().completed, 0);
  assert.equal(service.state().active, 0);
});

test("file deadline: timer installation failure prevents all IO", async t => {
  const service = fixture(t, { schedule() { throw Error("timer private"); } });
  const input = fallbackFile();
  await assert.rejects(service.readText(input.file), code("FILE_READ"));
  assert.equal(input.calls(), 0);
  assert.equal(service.state().active, 0);
});

test("file deadline: timer cleanup rejection does not replace successful output", async t => {
  const clock = fakeClock();
  const service = fixture(t, { ...clock.options, unschedule() { return Promise.reject(Error("cleanup")); } });
  assert.equal(await service.readText(fallbackFile().file), "ok");
  clock.set(100_000); clock.fire(); await tick();
  assert.equal(service.state().completed, 1);
  assert.equal(service.state().timedOut, 0);
});
