import test from "node:test";
import assert from "node:assert/strict";
import { fixture, outcome, saveOperation, microtasks, invariant } from "./helpers/storage-guard-fixtures.js";
import { checkpointStorageError } from "../src/checkpoint-storage.js";
import { encryptedLibraryStorageError } from "../src/encrypted-library-storage.js";

test("shadowed signal aborted accessor is never evaluated", async t => {
  const f = fixture(t);
  const controller = new AbortController();
  let reads = 0;
  Object.defineProperty(controller.signal, "aborted", { get() { reads++; throw Error("private"); } });
  const pending = outcome(f.storage.read({ signal: controller.signal }));
  const tx = await f.open();
  tx.read();
  tx.complete();
  assert((await pending).ok);
  assert.equal(reads, 0);
});

test("a missing event listener cannot conceal native cancellation behind an own false property", async t => {
  const f = fixture(t);
  const controller = new AbortController();
  controller.signal.addEventListener = () => {};
  Object.defineProperty(controller.signal, "aborted", { value: false });
  const pending = outcome(f.storage.change(0, saveOperation(), { signal: controller.signal,
    canCommit() { controller.abort(); return true; } }));
  const tx = await f.open();
  tx.read();
  assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
  assert.equal(f.effects.puts, 0);
  await microtasks();
  assert.equal(f.guard.state().active, 0);
});

for (const boundary of ["opening", "transaction"]) {
  for (const action of ["close", "cancel"]) {
    test(`deadline scheduler reentry ${action} at ${boundary} leaves no timer or work`, async t => {
      let f;
      let scheduled = 0;
      const timers = new Set();
      const controller = new AbortController();
      const schedule = () => {
        const key = ++scheduled;
        timers.add(key);
        if (key === (boundary === "opening" ? 1 : 2)) {
          if (action === "close") f.storage.close();
          else controller.abort();
        }
        return key;
      };
      f = fixture(t, { deadlineOptions: { now: () => 1, schedule, unschedule: key => timers.delete(key) } });
      const result = outcome(f.storage.read({ signal: controller.signal }));
      if (boundary === "transaction") { f.succeed(); await microtasks(); }
      assert.equal((await result).ok, false);
      assert.equal(timers.size, 0, "deadline disposed despite synchronous reentry");
      assert.equal(f.transactions.length, 0);
      assert.equal(f.effects.puts, 0);
      assert.equal(f.guard.state().active, 0);
    });
  }
}

test("closing while the clock is first sampled cannot start a native open", async t => {
  let f;
  f = fixture(t, { deadlineOptions: { now() { f.storage.close(); return 1; }, schedule: () => 1, unschedule() {} } });
  assert.equal((await outcome(f.storage.read())).code, "CHECKPOINT_CLOSED");
  assert.equal(f.requests.length, 0);
  assert.equal(f.guard.state().active, 0);
});

test("signal listener registration cannot recursively admit a second call on one adapter", async t => {
  const f = fixture(t);
  const controller = new AbortController();
  const original = controller.signal.addEventListener;
  let nested;
  controller.signal.addEventListener = function (...args) {
    nested = outcome(f.storage.read());
    return original.apply(this, args);
  };
  const first = outcome(f.storage.read({ signal: controller.signal }));
  assert.equal((await nested).code, "CHECKPOINT_BUSY");
  const tx = await f.open();
  tx.read();
  tx.complete();
  assert((await first).ok);
  assert.equal(f.requests.length, 1);
});

test("signal cleanup reentry does not allow a cancelled transaction to resolve", async t => {
  const f = fixture(t, { hooks: { silentAbort: true } });
  const controller = new AbortController();
  const original = controller.signal.removeEventListener;
  let tx;
  controller.signal.removeEventListener = function (...args) {
    tx?.complete({ force: true });
    return original.apply(this, args);
  };
  const pending = outcome(f.storage.change(0, saveOperation(), { signal: controller.signal }));
  tx = await f.open();
  tx.read();
  controller.abort();
  assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
  assert.equal(f.guard.state().completed, 0);
  assert.equal(f.guard.state().uncertain, 1, "a racing completion remains uncertain");
  invariant(f.guard, assert);
});

test("observer reentry after acquisition cancels before any database read", async t => {
  const f = fixture(t);
  f.guard.subscribe(value => { if (value.opening) f.guard.cancelAll(); });
  const pending = outcome(f.storage.read());
  await microtasks();
  assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
  f.succeed();
  await microtasks();
  assert.equal(f.transactions.length, 0);
  assert.equal(f.effects.gets, 0);
  assert.equal(f.guard.state().active, 0);
});

for (const mapper of [checkpointStorageError, encryptedLibraryStorageError]) {
  test(mapper.name + " tolerates a hostile prototype trap without exposing its prose", () => {
    const value = new Proxy({}, { getPrototypeOf() { throw Error("private prototype text"); } });
    const result = mapper(value);
    assert(result instanceof Error);
    assert(!result.message.includes("private"));
  });

  test(mapper.name + " never reads a shadowed native DOMException name accessor", () => {
    let reads = 0;
    const value = new DOMException("private message", "QuotaExceededError");
    Object.defineProperty(value, "name", { get() { reads++; throw Error("getter"); } });
    const result = mapper(value);
    assert.match(result.code, /QUOTA$/);
    assert.equal(reads, 0);
    assert(!result.message.includes("private"));
  });
}

test("a late open error cannot reject an already successful operation twice", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.read());
  const tx = await f.open();
  tx.read();
  tx.complete();
  assert((await pending).ok);
  const before = f.guard.state();
  f.fail("QuotaExceededError");
  await microtasks();
  assert.deepEqual(f.guard.state(), before);
});

test("a native abort received after completion cannot increment cancellation counters", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.change(0, saveOperation()));
  const tx = await f.open();
  tx.read();
  tx.complete();
  assert((await pending).ok);
  const before = f.guard.state();
  tx.abortEvent(new DOMException("late", "AbortError"));
  assert.deepEqual(f.guard.state(), before);
});

test("put callback cancellation followed by forced complete never produces a success receipt", async t => {
  const controller = new AbortController();
  const f = fixture(t, { hooks: { silentAbort: true, onPut() { controller.abort(); } } });
  const pending = outcome(f.storage.change(0, saveOperation(), { signal: controller.signal }));
  const tx = await f.open();
  tx.read();
  assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
  tx.complete({ force: true });
  assert.equal(f.guard.state().completed, 0);
  assert.equal(f.guard.state().uncertain, 1);
  assert.equal(f.guard.state().active, 0);
});
