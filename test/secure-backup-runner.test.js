import test from "node:test";
import assert from "node:assert/strict";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { gate, tick } from "./helpers/secure-backup-fixtures.js";
const failure = code => error => error?.code === code;

test("runner permits one native operation and releases on normal completion", async () => {
  const runner = createSecureBackupRunner();
  const pending = gate();
  let guard;
  const work = runner.run(check => { guard = check; return pending.promise; });
  assert.equal(runner.busy(), true);
  await tick();
  assert.equal(guard(), true);
  pending.resolve("ready");
  assert.equal(await work, "ready");
  assert.equal(runner.busy(), false);
  assert.equal(guard(), false);
  assert.equal(await runner.run(() => 42), 42);
});

test("runner rejects overlap without invoking or queuing new work", async () => {
  const runner = createSecureBackupRunner();
  const pending = gate();
  const first = runner.run(() => pending.promise);
  let calls = 0;
  await assert.rejects(runner.run(() => { calls++; }), failure("SECURE_BUSY"));
  assert.equal(calls, 0);
  pending.resolve();
  await first;
  await tick();
  assert.equal(calls, 0, "rejected work is not silently queued");
});

test("cancellation settles caller promptly but holds native slot until completion", async () => {
  const runner = createSecureBackupRunner();
  const abort = new AbortController();
  const pending = gate();
  let guard;
  const work = runner.run(check => { guard = check; return pending.promise; }, { signal: abort.signal });
  const rejected = assert.rejects(work, failure("SECURE_CANCELLED"));
  await tick();
  abort.abort();
  await rejected;
  assert.equal(guard(), false);
  assert.equal(runner.busy(), true);
  await assert.rejects(runner.run(() => "overlap"), failure("SECURE_BUSY"));
  pending.resolve("late secret");
  await tick();
  assert.equal(runner.busy(), false);
  assert.equal(await runner.run(() => "fresh"), "fresh");
});

test("timeout stops further crypto stages and keeps uncancellable native slot", async () => {
  const runner = createSecureBackupRunner({ timeoutMs: 20 });
  const pending = gate();
  let guard;
  const work = runner.run(check => { guard = check; return pending.promise; });
  await assert.rejects(work, failure("SECURE_TIMEOUT"));
  assert.equal(guard(), false);
  assert.equal(runner.busy(), true);
  await assert.rejects(runner.run(() => null), failure("SECURE_BUSY"));
  pending.resolve();
  await tick();
  assert.equal(runner.busy(), false);
});

test("late native rejection after cancellation is observed and frees slot", async () => {
  const runner = createSecureBackupRunner();
  const abort = new AbortController();
  const pending = gate();
  const work = runner.run(() => pending.promise, { signal: abort.signal });
  const rejected = assert.rejects(work, failure("SECURE_CANCELLED"));
  await tick();
  abort.abort();
  await rejected;
  pending.reject(Error("late backend rejection"));
  await tick();
  assert.equal(runner.busy(), false);
});

test("late rejection after timeout is observed and frees slot", async () => {
  const runner = createSecureBackupRunner({ timeoutMs: 10 });
  const pending = gate();
  await assert.rejects(runner.run(() => pending.promise), failure("SECURE_TIMEOUT"));
  pending.reject(Error("late timeout rejection"));
  await tick();
  assert.equal(runner.busy(), false);
});

test("pre-aborted signal does not reserve a slot or run work", async () => {
  const runner = createSecureBackupRunner();
  const abort = new AbortController();
  abort.abort();
  let calls = 0;
  await assert.rejects(runner.run(() => { calls++; }, { signal: abort.signal }), failure("SECURE_CANCELLED"));
  assert.equal(calls, 0);
  assert.equal(runner.busy(), false);
});

test("abort before the work microtask prevents backend invocation", async () => {
  const runner = createSecureBackupRunner();
  const abort = new AbortController();
  let calls = 0;
  const promise = runner.run(() => { calls++; }, { signal: abort.signal });
  const rejected = assert.rejects(promise, failure("SECURE_CANCELLED"));
  abort.abort();
  await rejected;
  await tick();
  assert.equal(calls, 0);
  assert.equal(runner.busy(), false);
});

test("synchronous backend failure still releases slot", async () => {
  const runner = createSecureBackupRunner();
  const error = Error("backend");
  await assert.rejects(runner.run(() => { throw error; }), error);
  assert.equal(runner.busy(), false);
  assert.equal(await runner.run(() => 7), 7);
});

test("asynchronous backend failure still releases slot", async () => {
  const runner = createSecureBackupRunner();
  await assert.rejects(runner.run(async () => { throw Error("backend"); }));
  assert.equal(runner.busy(), false);
});

for (const timeoutMs of [0, -1, 120001, 1.5, NaN, Infinity, "100", null]) {
  test("invalid runner timeout " + String(timeoutMs), () => {
    assert.throws(() => createSecureBackupRunner({ timeoutMs }), failure("SECURE_INTERNAL"));
  });
}

test("invalid work or signal rejected before occupying slot", async () => {
  const runner = createSecureBackupRunner();
  await assert.rejects(runner.run(null), failure("SECURE_INTERNAL"));
  await assert.rejects(runner.run(() => 1, { signal: {} }), failure("SECURE_INTERNAL"));
  assert.equal(runner.busy(), false);
});

test("abort listeners are removed when normal work completes", async () => {
  let active = 0;
  const signal = { aborted: false, addEventListener() { active++; }, removeEventListener() { active--; } };
  const runner = createSecureBackupRunner();
  await runner.run(() => 1, { signal });
  assert.equal(active, 0);
});

test("a cancelled old operation cannot release a new operation's slot", async () => {
  const runner = createSecureBackupRunner();
  const firstGate = gate();
  const secondGate = gate();
  const abort = new AbortController();
  const first = runner.run(() => firstGate.promise, { signal: abort.signal });
  const rejected = assert.rejects(first, failure("SECURE_CANCELLED"));
  await tick();
  abort.abort();
  await rejected;
  firstGate.resolve();
  await tick();
  const second = runner.run(() => secondGate.promise);
  abort.abort();
  await tick();
  assert.equal(runner.busy(), true);
  secondGate.resolve();
  await second;
  assert.equal(runner.busy(), false);
});
