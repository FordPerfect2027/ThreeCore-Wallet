import test from "node:test";
import assert from "node:assert/strict";
import { createStorageGuard } from "../src/storage-guard.js";
import { validateStorageStatus } from "../src/storage-guard-status.js";
import { fixture, outcome, saveOperation, microtasks, invariant, document } from "./helpers/storage-guard-fixtures.js";

/** Deterministic state-machine traces. Each seed is one test; individual steps
 * are assertions, not inflated test counts. Reference counters are independent
 * of the guard's internal implementation. */
function random(seed) {
  let state = seed >>> 0;
  return maximum => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) % maximum;
  };
}

for (const seed of [1, 7, 19, 43, 101, 257, 1021, 65537, 912367, 0x9e3779b9]) {
  test("storage guard mixed admission lifecycle reference trace seed=" + seed, () => {
    const choose = random(seed);
    const guard = createStorageGuard();
    const rows = [];
    const expected = { accepted: 0, completed: 0, failed: 0, cancelled: 0, timedOut: 0, rejected: 0,
      late: 0, uncertain: 0 };
    let disposed = false;
    let clockFault = false;
    function current() { return rows.filter(row => !row.finished); }
    function stopRow(row, code) {
      if (row.finished || row.stopped) return;
      row.stopped = true;
      row.phase = "draining";
      expected[code === "CHECKPOINT_TIMEOUT" ? "timedOut" : code === "CHECKPOINT_CLOCK" ? "failed" : "cancelled"]++;
    }
    function check() {
      const state = invariant(guard, assert);
      assert(validateStorageStatus(state));
      for (const [key, value] of Object.entries(expected)) assert.equal(state[key], value, key);
      assert.equal(state.active, current().length);
      assert.equal(state.disposed, disposed);
      assert.equal(state.clockFault, clockFault);
      for (const phase of ["opening", "reading", "writing", "draining"]) {
        assert.equal(state[phase], current().filter(row => row.phase === phase).length, phase);
      }
      assert.equal(state.canStart, !disposed && !clockFault && current().length < 4);
    }
    for (let step = 0; step < 240; step++) {
      const operation = choose(10);
      if (operation < 3) {
        if (disposed || clockFault || current().length === 4) {
          assert.throws(() => guard.acquire(() => {}));
          expected.rejected++;
        } else {
          const row = { phase: "opening", stopped: false, finished: false, callbacks: 0, lease: null };
          row.lease = guard.acquire(() => { row.callbacks++; });
          rows.push(row);
          expected.accepted++;
        }
      } else if (operation === 3 && current().length) {
        const row = current()[choose(current().length)];
        const phase = ["opening", "reading", "writing"][choose(3)];
        const result = row.lease.phase(phase);
        assert.equal(result, !row.stopped);
        if (!row.stopped) row.phase = phase;
      } else if (operation === 4 && current().length) {
        const row = current()[choose(current().length)];
        const code = choose(2) ? "CHECKPOINT_CANCELLED" : "CHECKPOINT_TIMEOUT";
        const wasStopped = row.stopped;
        assert.equal(row.lease.stop(code), !wasStopped);
        stopRow(row, code);
        assert.equal(row.callbacks, 1);
      } else if (operation === 5 && rows.length) {
        const row = rows[choose(rows.length)];
        const success = choose(2) === 1;
        const late = row.stopped;
        const uncertain = late && choose(4) === 0;
        assert.equal(row.lease.finish({ success, late, uncertain }), !row.finished);
        if (!row.finished) {
          row.finished = true;
          if (!row.stopped) expected[success ? "completed" : "failed"]++;
          if (late) expected.late++;
          if (uncertain) expected.uncertain++;
        }
      } else if (operation === 6) {
        const targets = current().filter(row => !row.stopped);
        assert.equal(guard.cancelAll(), targets.length);
        targets.forEach(row => stopRow(row, "CHECKPOINT_CANCELLED"));
      } else if (operation === 7 && step > 180) {
        guard.tripClock();
        clockFault = true;
        current().forEach(row => stopRow(row, "CHECKPOINT_CLOCK"));
      } else if (operation === 8 && step > 220) {
        guard.dispose();
        disposed = true;
        current().forEach(row => stopRow(row, "CHECKPOINT_CLOSED"));
      }
      check();
    }
    for (const row of current()) {
      row.lease.finish();
      row.finished = true;
      if (!row.stopped) expected.failed++;
    }
    check();
    guard.dispose();
  });
}

const events = [
  { name: "read -> complete", steps: ["read", "complete"], success: true, writes: 1 },
  { name: "read -> read -> complete", steps: ["read", "read", "complete"], success: true, writes: 1 },
  { name: "read -> complete -> complete", steps: ["read", "complete", "complete"], success: true, writes: 1 },
  { name: "cancel -> read -> abort", steps: ["cancel", "read", "abort"], success: false, writes: 0 },
  { name: "read -> cancel -> abort", steps: ["read", "cancel", "abort"], success: false, writes: 1 },
  { name: "expire -> read -> abort", steps: ["expire", "read", "abort"], success: false, writes: 0 },
  { name: "read -> expire -> abort", steps: ["read", "expire", "abort"], success: false, writes: 1 },
  { name: "close -> read -> abort", steps: ["close", "read", "abort"], success: false, writes: 0 },
  { name: "read -> close -> abort", steps: ["read", "close", "abort"], success: false, writes: 1 },
  { name: "complete -> read", steps: ["complete", "read"], success: false, writes: 0 },
  { name: "abort -> read -> complete", steps: ["abort", "read", "complete"], success: false, writes: 0 },
  { name: "read -> abort -> read", steps: ["read", "abort", "read"], success: false, writes: 1 },
  { name: "error -> read -> abort", steps: ["error", "read", "abort"], success: false, writes: 0 },
  { name: "read -> error -> abort", steps: ["read", "error", "abort"], success: false, writes: 1 },
  { name: "read -> cancel -> force", steps: ["read", "cancel", "force"], success: false, writes: 1, uncertain: 1 },
  { name: "read -> expire -> force", steps: ["read", "expire", "force"], success: false, writes: 1, uncertain: 1 },
  { name: "read -> close -> force", steps: ["read", "close", "force"], success: false, writes: 1, uncertain: 1 },
  { name: "cancel -> force -> read", steps: ["cancel", "force", "read"], success: false, writes: 0 },
];

for (const scenario of events) {
  test("guarded transaction event trace: " + scenario.name, async t => {
    const f = fixture(t, { initial: document(1), hooks: { silentAbort: true } });
    const controller = new AbortController();
    let settlements = 0;
    const pending = outcome(f.storage.change(1, saveOperation(2), { signal: controller.signal }))
      .then(result => { settlements++; return result; });
    const tx = await f.open();
    for (const event of scenario.steps) {
      if (event === "read") tx.read();
      if (event === "complete") tx.complete();
      if (event === "force") tx.complete({ force: true });
      if (event === "abort") tx.abortEvent();
      if (event === "cancel") controller.abort();
      if (event === "close") f.storage.close();
      if (event === "expire") { f.time.advance(100); f.time.flush(); }
      if (event === "error") {
        tx.error = new DOMException("synthetic sensitive payload", "QuotaExceededError");
        tx.onerror();
      }
      invariant(f.guard, assert);
    }
    assert.equal((await pending).ok, scenario.success);
    assert.equal(settlements, 1);
    assert.equal(f.effects.puts, scenario.writes);
    if (!tx.terminal) tx.abortEvent();
    await microtasks();
    assert.equal(f.guard.state().active, 0);
    assert.equal(f.guard.state().completed, scenario.success ? 1 : 0);
    assert.equal(f.guard.state().uncertain, scenario.uncertain ?? 0);
    if (!scenario.success && !scenario.uncertain) assert.deepEqual(f.current(), document(1));
    if (scenario.success) assert.equal(f.current().revision, 2);
    assert.equal(f.time.pending, 0);
  });
}

test("clock continuity is checked between opening and transaction phases", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.read());
  f.time.advance(30);
  f.succeed();
  f.time.set(0);
  await microtasks();
  assert.equal((await pending).code, "CHECKPOINT_CLOCK");
  assert.equal(f.transactions.length, 0);
  assert.equal(f.guard.state().clockFault, true);
});

test("clock continuity is checked between successfully finished operations", async t => {
  const f = fixture(t);
  assert((await f.read()).ok);
  f.time.set(0);
  assert.equal((await outcome(f.storage.read())).code, "CHECKPOINT_CLOCK");
  assert.equal(f.transactions.length, 1);
  assert.equal(f.guard.state().active, 0);
});

test("one completed old transaction cannot supply a newer operation result", async t => {
  const f = fixture(t);
  const first = outcome(f.storage.change(0, saveOperation(1)));
  const old = await f.open();
  old.read();
  old.complete();
  assert((await first).ok);
  const next = outcome(f.storage.change(1, saveOperation(2)));
  await microtasks();
  old.read();
  old.complete({ force: true });
  const tx = f.transactions[1];
  tx.read();
  tx.complete();
  const result = await next;
  assert(result.ok);
  assert.equal(result.value.revision, 2);
  assert.equal(result.value.entries.length, 2);
  assert.equal(f.guard.state().completed, 2);
});

test("successful storage can be reused after repeated cancellation with real terminal events", async t => {
  const f = fixture(t, { initial: document(1) });
  for (let attempt = 0; attempt < 12; attempt++) {
    const controller = new AbortController();
    const pending = outcome(f.storage.change(1, saveOperation(2), { signal: controller.signal }));
    if (!f.requests.length || f.requests[0].result === null) f.succeed();
    await microtasks();
    const tx = f.transactions.at(-1);
    controller.abort();
    assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
    tx.read();
    await microtasks();
    assert.equal(f.guard.state().active, 0);
    assert.deepEqual(f.current(), document(1));
  }
  const pending = outcome(f.storage.change(1, saveOperation(2)));
  await microtasks();
  const tx = f.transactions.at(-1);
  tx.read();
  tx.complete();
  assert((await pending).ok);
  assert.equal(f.guard.state().cancelled, 12);
  assert.equal(f.guard.state().completed, 1);
  assert.equal(f.effects.puts, 1);
});
