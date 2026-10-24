import test from "node:test";
import assert from "node:assert/strict";
import { fixture, outcome, saveOperation, microtasks } from "./helpers/storage-guard-fixtures.js";

test("cancellation during opening settles promptly before native open finishes", async t => {
  const f = fixture(t);
  const abort = new AbortController();
  const pending = outcome(f.storage.read({ signal: abort.signal }));
  abort.abort();
  assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
  assert.equal(f.transactions.length, 0);
  assert.equal(f.guard.state().draining, 1);
  f.succeed();
  await microtasks();
  assert.equal(f.effects.closes, 1);
  assert.equal(f.guard.state().active, 0);
});

test("a peer still waiting on the shared open survives another caller's cancellation", async t => {
  const f = fixture(t);
  const abort = new AbortController();
  const first = outcome(f.storage.read({ signal: abort.signal }));
  const second = outcome(f.storage.read());
  assert.equal(f.requests.length, 1);
  abort.abort();
  assert.equal((await first).code, "CHECKPOINT_CANCELLED");
  await f.open();
  assert.equal(f.transactions.length, 1);
  const tx = f.transactions[0];
  tx.read();
  tx.complete();
  assert((await second).ok);
  assert.equal(f.effects.closes, 0);
  assert.equal(f.guard.state().active, 0);
});

test("an abandoned open is quarantined instead of creating another request", async t => {
  const f = fixture(t);
  const abort = new AbortController();
  const first = outcome(f.storage.read({ signal: abort.signal }));
  abort.abort();
  await first;
  const second = await outcome(f.storage.read());
  assert.equal(second.code, "CHECKPOINT_BLOCKED");
  assert.equal(f.requests.length, 1);
  assert.equal(f.guard.state().active, 1);
  f.fail("AbortError");
  assert.equal(f.guard.state().active, 0);
  const third = outcome(f.storage.read());
  assert.equal(f.requests.length, 2);
  const tx = await f.open();
  tx.read();
  tx.complete();
  assert((await third).ok);
});

test("open-timeout without timer delivery rejects a late success", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.change(0, saveOperation()));
  f.time.advance(100);
  f.succeed();
  assert.equal((await pending).code, "CHECKPOINT_TIMEOUT");
  await microtasks();
  assert.equal(f.transactions.length, 0);
  assert.equal(f.effects.closes, 1);
  assert.equal(f.guard.state().active, 0);
});

test("a timed-out open retains capacity until its late error arrives", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.read());
  f.time.advance(100);
  f.time.flush();
  assert.equal((await pending).code, "CHECKPOINT_TIMEOUT");
  assert.equal(f.guard.state().draining, 1);
  assert.equal(f.guard.state().timedOut, 1);
  f.fail("AbortError");
  assert.equal(f.guard.state().active, 0);
  assert.equal(f.guard.state().timedOut, 1);
});

test("blocked opens reject all callers but do not release unknown native work", async t => {
  const f = fixture(t);
  const first = outcome(f.storage.read());
  const second = outcome(f.storage.read());
  f.requests[0].onblocked();
  assert.equal((await first).code, "CHECKPOINT_BLOCKED");
  assert.equal((await second).code, "CHECKPOINT_BLOCKED");
  assert.equal(f.guard.state().draining, 2);
  f.succeed();
  await microtasks();
  assert.equal(f.effects.closes, 1);
  assert.equal(f.transactions.length, 0);
  assert.equal(f.guard.state().active, 0);
});

test("late upgrade after all callers cancel creates no object store", async t => {
  const f = fixture(t, { hooks: { hasStore: false } });
  const abort = new AbortController();
  const pending = outcome(f.storage.read({ signal: abort.signal }));
  abort.abort();
  await pending;
  const request = f.requests[0];
  request.result = f.db;
  request.onupgradeneeded();
  assert.equal(f.effects.creates, 0);
  assert.equal(f.effects.aborts, 1);
  f.fail("AbortError");
});

test("expired callers cannot create a store during delayed upgrade", async t => {
  const f = fixture(t, { hooks: { hasStore: false } });
  const pending = outcome(f.storage.read());
  f.time.advance(101);
  f.requests[0].result = f.db;
  f.requests[0].onupgradeneeded();
  assert.equal((await pending).code, "CHECKPOINT_TIMEOUT");
  assert.equal(f.effects.creates, 0);
  f.fail("AbortError");
});

test("existing invalid schema is closed and never repaired outside upgrade", async t => {
  const f = fixture(t, { hooks: { hasStore: false } });
  const pending = outcome(f.storage.read());
  f.succeed();
  assert.equal((await pending).code, "CHECKPOINT_SCHEMA");
  assert.equal(f.effects.creates, 0);
  assert.equal(f.effects.closes, 1);
  assert.equal(f.transactions.length, 0);
});

test("a failed schema-create request remains quarantined until native terminal event", async t => {
  const f = fixture(t, { hooks: { hasStore: false, onCreate() { throw Error("private schema failure"); } } });
  const pending = outcome(f.storage.read());
  f.requests[0].result = f.db;
  f.requests[0].onupgradeneeded();
  assert.equal((await pending).code, "CHECKPOINT_STORAGE");
  assert.equal(f.guard.state().draining, 1);
  f.fail("AbortError");
  assert.equal(f.guard.state().active, 0);
});

test("version-change invalidates the handle and aborts active writes", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.change(0, saveOperation()));
  const tx = await f.open();
  tx.read();
  f.db.onversionchange();
  assert.equal((await pending).code, "CHECKPOINT_CLOSED");
  await microtasks();
  assert.equal(f.effects.commits, 0);
  assert.equal(f.effects.closes, 1);
  const next = outcome(f.storage.read());
  assert.equal(f.requests.length, 2);
  const retry = await f.open();
  retry.read();
  retry.complete();
  assert((await next).ok);
});

test("unexpected connection close cancels a pending transaction", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.read());
  await f.open();
  f.db.onclose();
  assert.equal((await pending).code, "CHECKPOINT_CLOSED");
  await microtasks();
  assert.equal(f.guard.state().active, 0);
});

test("a version change between open success and dispatch starts no transaction", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.read());
  f.succeed();
  f.db.onversionchange();
  await microtasks();
  assert.equal((await pending).code, "CHECKPOINT_CANCELLED");
  assert.equal(f.transactions.length, 0);
});

test("duplicate successful open events cannot close the live shared handle", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.read());
  f.succeed();
  f.succeed();
  await microtasks();
  assert.equal(f.effects.closes, 0);
  assert.equal(f.transactions.length, 1);
  const tx = f.transactions[0];
  tx.read();
  tx.complete();
  assert((await pending).ok);
});

test("a late success after open failure closes its handle without attaching it", async t => {
  const f = fixture(t);
  const pending = outcome(f.storage.read());
  f.fail("SecurityError");
  assert.equal((await pending).code, "CHECKPOINT_UNAVAILABLE");
  f.succeed();
  assert.equal(f.effects.closes, 1);
  assert.equal(f.transactions.length, 0);
});

test("normal reuse requires no additional database open", async t => {
  const f = fixture(t);
  assert((await f.read()).ok);
  assert((await f.read()).ok);
  assert.equal(f.requests.length, 1);
  assert.equal(f.transactions.length, 2);
  assert.equal(f.guard.state().completed, 2);
});
