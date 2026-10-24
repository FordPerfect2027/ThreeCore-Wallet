import test from "node:test";
import assert from "node:assert/strict";
import { createTabGuard } from "../src/tab-guard-controller.js";
import { clockFixture, transportFixture, deterministicCrypto, signal, EPOCH } from "./helpers/tab-guard-fixtures.js";

function fixture({ wireOptions = {}, ...options } = {}) {
  const wire = transportFixture(wireOptions), clock = clockFixture(), stops = [], states = [];
  const guard = createTabGuard({ transport: wire.transport, ...clock.options,
    crypto: deterministicCrypto(), onStop(reason) { stops.push(reason); return true; },
    onChange(state) { states.push(state); }, ...options });
  return { wire, clock, guard, stops, states, close: () => guard.dispose() };
}

for (const [label, result] of [["false", false], ["missing", undefined], ["truthy", 1], ["text", "true"]]) {
  test("subscribe must explicitly succeed, not " + label, () => {
    const f = fixture({ wireOptions: { subscribe: () => result } });
    assert.equal(f.guard.start(), false);
    assert.equal(f.guard.state().errorCode, "TAB_TRANSPORT");
    assert.equal(f.guard.state().available, false);
    assert.equal(f.wire.posts.length, 0);
    assert.equal(f.stops.length, 0);
    f.close();
  });

  for (const transition of ["stop", "receive"]) {
    test(transition + " cannot claim delivery when post returns " + label, () => {
      const f = fixture({ wireOptions: { post: () => result } });
      assert(f.guard.start());
      if (transition === "stop") assert.equal(f.guard.stop(), false);
      else f.wire.deliver(signal());
      assert.equal(f.guard.state().errorCode, "TAB_TRANSPORT");
      assert.equal(f.guard.state().available, false);
      assert.equal(f.guard.state().sent, 0);
      assert.equal(f.guard.state().pending, false);
      assert(f.stops.includes("channel-error"));
      f.close();
    });
  }
}

for (const operation of ["subscribe", "post"]) {
  for (const rejected of [false, true]) {
    test(operation + " rejects asynchronous capability; promise rejection=" + rejected, async () => {
      const f = fixture({ wireOptions: { [operation]() {
        return rejected ? Promise.reject(Error("private fixture")) : Promise.resolve(true);
      } } });
      if (operation === "subscribe") assert.equal(f.guard.start(), false);
      else { f.guard.start(); assert.equal(f.guard.stop(), false); }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(f.guard.state().errorCode, "TAB_TRANSPORT");
      assert.equal(f.guard.state().available, false);
      assert(!JSON.stringify(f.states).includes("private fixture"));
      f.close();
    });
  }
}

test("fault during subscription prevents ready state and posting", () => {
  const f = fixture({ wireOptions: { subscribe(message, error) { error(); return true; } } });
  assert.equal(f.guard.start(), false);
  assert.equal(f.guard.state().phase, "error");
  assert.equal(f.guard.state().available, false);
  assert.equal(f.wire.posts.length, 0);
  f.close();
});

test("a cleanup that reports another transport fault cannot recursively run itself", () => {
  let f, calls = 0;
  f = fixture({ onStop() { calls++; f.wire.error(); return true; } });
  f.guard.start(); f.wire.error();
  assert.equal(calls, 1);
  assert.equal(f.guard.state().phase, "error");
  for (let i = 0; i < 20; i++) f.wire.error();
  assert.equal(calls, 1);
  f.close();
});

test("a close callback that reports another fault does not recurse", () => {
  let f, closed = 0;
  f = fixture({ wireOptions: { close() { closed++; f.wire.error(); } } });
  f.guard.start(); f.wire.error();
  assert.equal(closed, 1);
  assert.deepEqual(f.stops, ["channel-error"]);
  f.close();
  assert.equal(closed, 2);
});

test("a failing close operation cannot keep a pending notification alive", () => {
  const f = fixture({ wireOptions: { close() { throw Error("private close failure"); } } });
  f.guard.start(); f.guard.stop(); f.wire.error();
  assert.equal(f.guard.state().pending, false);
  assert.equal(f.clock.pending().length, 0);
  assert.equal(f.guard.state().errorCode, "TAB_TRANSPORT");
  assert(!JSON.stringify(f.states).includes("private close failure"));
  f.close();
});

test("observer-triggered disposal during ready prevents any later send", () => {
  let f;
  f = fixture({ onChange(state) { if (state.phase === "ready") f.guard.dispose(); } });
  assert.equal(f.guard.start(), false);
  assert.equal(f.guard.state().phase, "disposed");
  assert.equal(f.guard.stop(), false);
  assert.equal(f.wire.posts.length, 0);
});

test("clock exception while sending protects locally and exposes no thrown text", () => {
  let broken = false;
  const f = fixture({ now() { if (broken) throw Error("synthetic clock private"); return EPOCH; } });
  f.guard.start(); broken = true;
  assert.equal(f.guard.stop(), false);
  assert.equal(f.guard.state().errorCode, "TAB_CLOCK");
  assert.deepEqual(f.stops, ["broadcast-stop", "channel-error"]);
  assert.equal(f.wire.posts.length, 0);
  assert(!JSON.stringify(f.states).includes("synthetic clock private"));
  f.close();
});

test("an early scheduler callback keeps waiting until the actual receipt deadline", () => {
  const f = fixture(); f.guard.start(); f.guard.stop();
  const first = f.clock.pending()[0];
  f.clock.advance(100, false); f.clock.invoke(first);
  assert.equal(f.guard.state().phase, "waiting");
  assert.equal(f.guard.state().pending, true);
  f.clock.advance(1899);
  assert.equal(f.guard.state().pending, true);
  f.clock.advance(1);
  assert.equal(f.guard.state().phase, "complete");
  assert.equal(f.guard.state().pending, false);
  f.close();
});

test("a suspended timer closes its window on return without accepting late receipts", () => {
  const f = fixture(); f.guard.start(); f.guard.stop();
  f.clock.advance(60000);
  assert.equal(f.guard.state().phase, "complete");
  assert.equal(f.guard.state().receiptCount, 0);
  assert.equal(f.guard.state().available, true);
  assert.equal(f.wire.posts.length, 1);
  f.close();
});

test("a synchronous scheduler is refused without posting or recursive scheduling", () => {
  let schedules = 0, cancelled = 0;
  const f = fixture({ schedule(callback) { schedules++; callback(); return 42; },
    unschedule() { cancelled++; } });
  f.guard.start();
  assert.equal(f.guard.stop(), false);
  assert.equal(schedules, 1);
  assert.equal(cancelled, 1);
  assert.equal(f.guard.state().errorCode, "TAB_CONFIG");
  assert.equal(f.wire.posts.length, 0);
  f.close();
});

test("scheduler exceptions cannot leave a pending confirmation on screen", () => {
  const f = fixture({ schedule() { throw Error("private scheduling error"); } });
  f.guard.start();
  assert.equal(f.guard.stop(), false);
  assert.equal(f.guard.state().pending, false);
  assert.equal(f.guard.state().errorCode, "TAB_TRANSPORT");
  assert.equal(f.wire.posts.length, 0);
  f.close();
});

test("failed timer cancellation cannot revive a request after local resume", () => {
  const clock = clockFixture();
  const f = fixture({ ...clock.options, unschedule() { throw Error("timer fixture"); } });
  f.guard.start(); f.guard.stop();
  const handle = clock.pending()[0];
  clock.advance(1, false); assert(f.guard.noteResume());
  const after = f.guard.state();
  clock.advance(4000); clock.invoke(handle);
  assert.deepEqual(f.guard.state(), after);
  f.close();
});

test("early rescheduling failure closes the channel and protects locally", () => {
  const clock = clockFixture(); let scheduled = 0;
  const f = fixture({ ...clock.options, schedule(callback, delay) {
    if (++scheduled === 2) throw Error("timer fixture");
    return clock.options.schedule(callback, delay);
  } });
  f.guard.start(); f.guard.stop();
  clock.advance(1, false); clock.invoke(clock.pending()[0]);
  assert.equal(f.guard.state().errorCode, "TAB_TRANSPORT");
  assert.equal(f.guard.state().pending, false);
  assert.equal(f.stops.at(-1), "channel-error");
  f.close();
});

test("malicious error accessors are not read or displayed", () => {
  let accesses = 0;
  const error = Object.defineProperty({}, "code", { get() { accesses++; throw Error("private"); } });
  const f = fixture({ wireOptions: { post() { throw error; } } });
  f.guard.start(); f.guard.stop();
  assert.equal(accesses, 0);
  assert.equal(f.guard.state().errorCode, "TAB_TRANSPORT");
  f.close();
});

test("local stop remains available after a channel fault without reopening the channel", () => {
  const f = fixture(); f.guard.start(); f.wire.error();
  const subscriptions = f.wire.calls.filter(value => value === "subscribe").length;
  f.clock.advance(1); assert(f.guard.noteResume());
  assert.equal(f.guard.stop(), false);
  assert.equal(f.stops.at(-1), "broadcast-stop");
  assert.equal(f.wire.calls.filter(value => value === "subscribe").length, subscriptions);
  assert.equal(f.guard.state().available, false);
  f.close();
});
