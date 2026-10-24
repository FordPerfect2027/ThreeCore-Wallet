import test from "node:test";
import assert from "node:assert/strict";
import { fixture, outcome, saveOperation, microtasks, document } from "./helpers/storage-guard-fixtures.js";

for (const elapsed of [100, 101, 1000, 1_000_000]) {
  test("delayed read event past deadline cannot enqueue writes: " + elapsed, async t => {
    const f = fixture(t);
    const pending = outcome(f.storage.change(0, saveOperation()));
    const tx = await f.open();
    f.time.advance(elapsed);
    tx.read();
    assert.equal((await pending).code, "CHECKPOINT_TIMEOUT");
    assert.equal(f.effects.puts, 0);
    await microtasks();
    assert.equal(f.guard.state().active, 0);
  });
}

test("a read immediately before the deadline is accepted only if completion is in time", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.read());
  const tx = await f.open();
  f.time.advance(99);
  tx.read();
  tx.complete();
  assert((await pending).ok);
});

test("expiry between read and completion cannot publish a late result", async t => {
  const f = fixture(t, { initial: document(1) });
  const pending = outcome(f.storage.read());
  const tx = await f.open();
  tx.read();
  f.time.advance(100);
  tx.complete();
  assert.equal((await pending).code, "CHECKPOINT_TIMEOUT");
  assert.equal(f.guard.state().completed, 0);
  assert.equal(f.guard.state().uncertain, 0);
});

test("commit arriving after deadline is marked uncertain rather than falsely unsaved", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.change(0, saveOperation()));
  const tx = await f.open();
  tx.read();
  f.time.advance(100);
  tx.complete();
  assert.equal((await pending).code, "CHECKPOINT_TIMEOUT");
  assert.equal(f.current().revision, 1);
  assert.equal(f.guard.state().uncertain, 1);
  assert.equal(f.guard.state().completed, 0);
});

test("timer cancellation aborts the pending native transaction", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.change(0, saveOperation()));
  const tx = await f.open();
  tx.read();
  f.time.advance(100);
  f.time.flush();
  assert.equal((await pending).code, "CHECKPOINT_TIMEOUT");
  await microtasks();
  assert.equal(f.effects.commits, 0);
  assert.equal(f.current(), undefined);
  assert.equal(f.guard.state().uncertain, 0);
});

test("a silent native abort retains capacity but does not retain the caller", async t => {
  const f = fixture(t, { hooks: { silentAbort: true } });
  const abort = new AbortController();
  const pending = outcome(f.storage.change(0, saveOperation(), { signal: abort.signal }));
  const tx = await f.open();
  tx.read();
  abort.abort();
  assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
  assert.equal(f.guard.state().draining, 1);
  assert.equal(f.effects.aborts, 1);
  tx.abortEvent();
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.effects.commits, 0);
});

test("an abort exception is not mistaken for native termination", async t => {
  const f = fixture(t, { hooks: { abortThrows: true } });
  const abort = new AbortController();
  const pending = outcome(f.storage.read({ signal: abort.signal }));
  const tx = await f.open();
  abort.abort();
  assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
  assert.equal(f.guard.state().active, 1);
  tx.abortEvent();
  assert.equal(f.guard.state().active, 0);
});

test("commit after an unsuccessful abort requires explicit readback", async t => {
  const f = fixture(t, { hooks: { abortThrows: true } });
  const pending = outcome(f.storage.change(0, saveOperation()));
  const tx = await f.open();
  tx.read();
  f.guard.cancelAll();
  assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
  tx.complete();
  assert.equal(f.guard.state().uncertain, 1);
  assert.equal(f.current().entries.length, 1);
  const readback = await f.read();
  assert(readback.ok);
  assert.equal(readback.value.revision, 1);
  assert.equal(f.guard.state().uncertain, 1);
});

for (const value of [99, NaN, Infinity, -1]) {
  test("clock rollback or invalid reading stops all shared operations: " + String(value), async t => {
    const f = fixture(t);
    const first = outcome(f.storage.read());
    const second = outcome(f.storage.read());
    await f.open();
    f.time.set(value);
    f.transactions[0].read();
    assert.equal((await first).code, "CHECKPOINT_CLOCK");
    assert.equal((await second).code, "CHECKPOINT_CLOCK");
    await microtasks();
    assert.equal(f.guard.state().clockFault, true);
    assert.equal((await outcome(f.storage.read())).code, "CHECKPOINT_CLOCK");
  });
}

test("an early timer cannot extend the original transaction deadline", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.read());
  const tx = await f.open();
  const handle = f.time.ids()[0];
  f.time.advance(20);
  f.time.fire(handle);
  assert.equal(f.time.delays.at(-1), 80);
  f.time.advance(80);
  tx.read();
  assert.equal((await pending).code, "CHECKPOINT_TIMEOUT");
});

test("a stale open timer cannot cancel the subsequent transaction", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.read());
  const openTimer = f.time.ids()[0];
  const tx = await f.open();
  f.time.fire(openTimer, { stale: true });
  tx.read();
  tx.complete();
  assert((await pending).ok);
});

test("a stale transaction timer cannot cancel a later operation", async t => {
  const f = fixture(t);
  const first = outcome(f.storage.read());
  const tx = await f.open();
  const timer = f.time.ids()[0];
  tx.read();
  tx.complete();
  await first;
  const second = outcome(f.storage.read());
  await microtasks();
  f.time.fire(timer, { stale: true });
  f.transactions[1].read();
  f.transactions[1].complete();
  assert((await second).ok);
});

for (const schedule of [
  () => { throw Error("private timer error"); },
  () => undefined,
  fn => { fn(); return 1; },
]) {
  test("broken deadline setup prevents native open: " + schedule.toString(), async t => {
    const f = fixture(t, { deadlineOptions: { now: () => 1, schedule, unschedule() {} } });
    assert.equal((await outcome(f.storage.read())).code, "CHECKPOINT_TIMER");
    assert.equal(f.requests.length, 0);
    assert.equal(f.guard.state().active, 0);
  });
}

test("a timer setup failure on transaction entry starts no native transaction", async t => {
  let calls = 0;
  const f = fixture(t, { deadlineOptions: { now: () => 1,
    schedule() { if (++calls === 2) throw Error("private"); return calls; }, unschedule() {} } });
  const pending = outcome(f.storage.read());
  f.succeed();
  await microtasks();
  assert.equal((await pending).code, "CHECKPOINT_TIMER");
  assert.equal(f.transactions.length, 0);
  assert.equal(f.guard.state().active, 0);
});

test("timer cleanup failure cannot grant a cancelled operation new authority", async t => {
  const f = fixture(t, { deadlineOptions: { now: () => 100,
    schedule: () => 1, unschedule() { throw Error("private cleanup"); } } });
  const abort = new AbortController();
  const pending = outcome(f.storage.read({ signal: abort.signal }));
  const tx = await f.open();
  abort.abort();
  assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
  tx.read();
  await microtasks();
  assert.equal(f.effects.puts, 0);
});
