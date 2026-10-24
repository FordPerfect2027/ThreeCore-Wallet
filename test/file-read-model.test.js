import test from "node:test";
import assert from "node:assert/strict";
import { validateFileReadStatus } from "../src/file-read-status.js";
import { fixture, fakeClock, deferred, bytes, tick, outcome } from "./helpers/file-boundary-fixtures.js";

function random(seed) {
  let state = seed >>> 0;
  return max => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
}

/**
 * Independent reference model: it knows only admission, local settlement and
 * native settlement. It never imports the service's internal implementation.
 */
for (const seed of [1, 7, 19, 43, 101, 211, 509, 1021, 4099, 8191, 16381, 32749]) {
  test("file model: shuffled starts, aborts, timeout and late settlement seed " + seed, async t => {
    const choose = random(seed);
    const clock = fakeClock();
    const service = fixture(t, clock.options);
    const entries = [];
    const counts = { accepted: 0, completed: 0, failed: 0, cancelled: 0, timedOut: 0, rejected: 0 };
    let time = 0;
    const active = () => entries.filter(item => !item.settled);
    const waiting = () => active().filter(item => !item.local);

    function verify(label) {
      const state = service.state();
      assert(validateFileReadStatus(state), label);
      assert.equal(state.active, active().length, label + " active");
      assert.equal(state.waiting, waiting().length, label + " waiting");
      assert.equal(state.retained, active().length - waiting().length, label + " retained");
      assert.equal(state.reservedBytes, active().reduce((sum, item) => sum + item.size, 0), label + " bytes");
      for (const [key, value] of Object.entries(counts)) assert.equal(state[key], value, label + " " + key);
    }

    async function begin() {
      const gate = deferred();
      const abort = new AbortController();
      const size = 1 + choose(12);
      const text = "x".repeat(size);
      const byteMode = Boolean(choose(2));
      let calls = 0;
      const promise = outcome(service[byteMode ? "readBytes" : "readText"]({
        size, arrayBuffer() { calls++; return gate.promise; },
      }, { signal: abort.signal, timeoutMs: 30 }));
      if (active().length === 4) {
        counts.rejected++;
        assert.deepEqual(await promise, { code: "FILE_BUSY" });
        assert.equal(calls, 0);
        return;
      }
      counts.accepted++;
      entries.push({ gate, abort, size, text, byteMode, promise, deadline: time + 30,
        local: null, settled: false });
      await tick();
      assert.equal(calls, 1);
    }

    async function abortOne() {
      const candidates = waiting();
      if (!candidates.length) return;
      const item = candidates[choose(candidates.length)];
      item.local = "FILE_CANCELLED";
      counts.cancelled++;
      item.abort.abort();
      assert.deepEqual(await item.promise, { code: item.local });
    }

    async function cancelAll() {
      const candidates = waiting();
      for (const item of candidates) item.local = "FILE_CANCELLED";
      counts.cancelled += candidates.length;
      assert.equal(service.cancelAll(), candidates.length);
      for (const item of candidates) assert.deepEqual(await item.promise, { code: "FILE_CANCELLED" });
    }

    async function settleOne() {
      const candidates = active();
      if (!candidates.length) return;
      const item = candidates[choose(candidates.length)];
      const reject = choose(3) === 0;
      if (reject) item.gate.reject(Error("synthetic hidden failure"));
      else item.gate.resolve(bytes(item.text).buffer);
      if (!item.local) {
        if (reject) { counts.failed++; item.local = "FILE_READ"; }
        else { counts.completed++; item.local = "success"; }
      }
      const result = await item.promise;
      if (item.local === "success") {
        assert.equal(item.byteMode ? new TextDecoder().decode(result.value) : result.value, item.text);
      } else assert.equal(result.code, item.local);
      await tick();
      item.settled = true;
    }

    async function advanceTime() {
      time += 1 + choose(45);
      clock.set(time);
      const expired = waiting().filter(item => time >= item.deadline);
      for (const item of expired) item.local = "FILE_TIMEOUT";
      counts.timedOut += expired.length;
      for (const id of [...clock.timers.keys()]) clock.fire(id);
      for (const item of expired) assert.deepEqual(await item.promise, { code: "FILE_TIMEOUT" });
    }

    const operations = [begin, begin, abortOne, cancelAll, settleOne, settleOne, advanceTime];
    for (let step = 0; step < 80; step++) {
      await operations[choose(operations.length)]();
      verify("seed=" + seed + " step=" + step);
    }
    await cancelAll();
    while (active().length) await settleOne();
    verify("final");
    assert.equal(clock.timers.size, 0);
    assert.equal(service.state().canStart, true);
  });
}

test("file model: immediate source failures do not accumulate phantom reservations", async t => {
  const service = fixture(t);
  const sources = [
    () => { throw Error("synchronous private value"); },
    () => Promise.reject(Error("asynchronous private value")),
    () => ({ then(resolve, reject) { reject(Error("thenable private value")); } }),
  ];
  for (let round = 0; round < 40; round++) {
    const results = await Promise.all(sources.map(arrayBuffer => outcome(service.readText({ size: 1, arrayBuffer }))));
    assert(results.every(item => item.code === "FILE_READ"));
    assert.equal(service.state().active, 0);
    assert.equal(service.state().reservedBytes, 0);
    assert.equal(service.state().failed, (round + 1) * sources.length);
    assert(validateFileReadStatus(service.state()));
  }
});

test("file model: declaration quota stays conserved across every cancellation order", async t => {
  const orders = [[0, 1, 2, 3], [3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]];
  for (const order of orders) {
    const service = fixture(t);
    const entries = [3, 7, 11, 19].map(size => {
      const gate = deferred(), abort = new AbortController();
      return { size, gate, abort, promise: outcome(service.readBytes({ size, arrayBuffer: () => gate.promise }, { signal: abort.signal })) };
    });
    await tick();
    let reserved = 40;
    for (const index of order) {
      const item = entries[index];
      item.abort.abort();
      assert.equal((await item.promise).code, "FILE_CANCELLED");
      assert.equal(service.state().reservedBytes, reserved);
      item.gate.resolve(new ArrayBuffer(item.size)); await tick();
      reserved -= item.size;
      assert.equal(service.state().reservedBytes, reserved);
      assert(validateFileReadStatus(service.state()));
    }
    assert.equal(service.state().completed, 0);
    assert.equal(service.state().cancelled, 4);
  }
});
