import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createSecureDeadline } from "../src/secure-deadline.js";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { manualTime, microtasks } from "./helpers/secure-lifecycle-time.js";
import { controllerFixture, encryptedText } from "./helpers/secure-backup-fixtures.js";
import { fixture as storageFixture, outcome, saveOperation } from "./helpers/storage-guard-fixtures.js";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("timer contract: an asynchronous handle never authorizes protected work", async t => {
  const time = manualTime(), gate = deferred(), expired = [];
  let id;
  const deadline = createSecureDeadline({ ...time.options,
    schedule(fn, ms) { id = time.schedule(fn, ms); return gate.promise; },
    onExpire: code => expired.push(code) });
  t.after(() => deadline.dispose());
  const armed = deadline.arm();
  const allowed = deadline.check();
  gate.resolve(id);
  await microtasks();
  time.fire(id, { stale: true });
  assert.equal(armed, false);
  assert.equal(allowed, false);
  assert.deepEqual(expired, ["SECURE_TIMER"]);
  assert.equal(deadline.state().fault, "SECURE_TIMER");
  assert.equal(time.pending, 0, "A late synchronous handle must be released");
  assert.equal(deadline.arm(), false, "A failed timer cannot silently recover");
});

test("timer contract: a thenable getter is read once and its rejection is consumed", async t => {
  let reads = 0, subscriptions = 0, receiver;
  const handle = { get then() {
    reads++;
    return function (_resolve, reject) {
      receiver = this;
      subscriptions++;
      reject(Error("synthetic private scheduler failure"));
    };
  } };
  const deadline = createSecureDeadline({ now: () => 1, schedule: () => handle, unschedule() {} });
  t.after(() => deadline.dispose());
  const armed = deadline.arm();
  await microtasks();
  assert.equal(armed, false);
  assert.equal(reads, 1);
  assert.equal(subscriptions, 1);
  assert.equal(receiver, handle);
  assert.equal(deadline.state().code, "SECURE_TIMER");
  assert(!JSON.stringify(deadline.state()).includes("private"));
});

test("timer contract: a throwing then getter closes access without leaking its error", t => {
  const handle = { get then() { throw Error("synthetic private getter"); } };
  const deadline = createSecureDeadline({ now: () => 1, schedule: () => handle, unschedule() {} });
  t.after(() => deadline.dispose());
  assert.equal(deadline.arm(), false);
  assert.equal(deadline.check(), false);
  assert.equal(deadline.state().code, "SECURE_TIMER");
  assert(!JSON.stringify(deadline.state()).includes("private"));
});

for (const action of ["clear", "dispose"]) {
  test(`timer contract: a late handle after ${action} releases without reviving access`, async t => {
    const gate = deferred(), time = manualTime();
    let id;
    const deadline = createSecureDeadline({ ...time.options,
      schedule(fn, ms) { id = time.schedule(fn, ms); return gate.promise; } });
    t.after(() => deadline.dispose());
    deadline.arm();
    deadline[action]();
    gate.resolve(id);
    await microtasks();
    assert(time.removed.includes(id), "Late handle is removed before a stale callback is delivered");
    time.fire(id, { stale: true });
    assert.equal(time.pending, 0);
    assert.equal(deadline.check(), false);
    assert.equal(deadline.state().phase, action === "clear" ? "idle" : "disposed");
    assert.equal(deadline.arm(), false);
  });
}

test("timer contract: an early callback must validate its replacement timer", async t => {
  const time = manualTime();
  let calls = 0;
  const deadline = createSecureDeadline({ ...time.options, timeoutMs: 100,
    schedule(fn, ms) {
      const id = time.schedule(fn, ms);
      return ++calls === 1 ? id : Promise.resolve(id);
    } });
  t.after(() => deadline.dispose());
  assert(deadline.arm());
  time.advance(1);
  time.fire(time.ids()[0]);
  const allowed = deadline.check();
  await microtasks();
  assert.equal(allowed, false);
  assert.equal(deadline.state().fault, "SECURE_TIMER");
  assert.equal(time.pending, 0);
});

test("timer contract: asynchronous installation cannot start a crypto operation", async t => {
  const runner = createSecureBackupRunner({ now: () => 1,
    schedule: () => Promise.resolve(7), unschedule() {} });
  t.after(() => runner.dispose());
  let calls = 0;
  const result = await outcome(runner.run(() => { calls++; return "synthetic output"; }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "SECURE_TIMER");
  assert.equal(calls, 0);
});

test("timer contract: encrypted backup selection fails before granting decrypt access", async t => {
  const f = controllerFixture({ lifetimeOptions: { now: () => 1,
    schedule: () => Promise.resolve(7), unschedule() {} } });
  t.after(() => f.controller.dispose());
  const selected = f.controller.selectText(encryptedText());
  await microtasks();
  assert.equal(selected, false);
  assert.equal(f.controller.state().errorCode, "SECURE_TIMER");
  for (const name of ["canStage", "canDownload", "canDecrypt"]) assert.equal(f.controller.state()[name], false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.staged.length, 0);
});

for (const kind of ["read", "write"]) {
  test(`timer contract: storage ${kind} rejects before opening a database`, async t => {
    const f = storageFixture(t, { deadlineOptions: { now: () => 1,
      schedule: () => Promise.resolve(7), unschedule() {} } });
    const pending = outcome(kind === "read" ? f.storage.read() : f.storage.change(0, saveOperation(1)));
    // Draining keeps the pre-fix regression deterministic instead of waiting forever.
    await microtasks();
    f.drain();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.equal(result.code, "CHECKPOINT_TIMER");
    assert.equal(f.requests.length, 0);
    assert.equal(f.effects.gets, 0);
    assert.equal(f.effects.puts, 0);
  });
}

for (const kind of ["schedule", "cleanup", "late cleanup"]) {
  test(`timer contract: native rejected ${kind} promise does not escape its process`, () => {
    const moduleURL = new URL("../src/secure-deadline.js", import.meta.url).href;
    const script = `
      import { createSecureDeadline } from ${JSON.stringify(moduleURL)};
      const kind = ${JSON.stringify(kind)};
      let expired = 0;
      const deadline = createSecureDeadline({ now: () => 1,
        schedule: () => kind === "schedule" ? Promise.reject(Error("synthetic scheduler failure"))
          : kind === "late cleanup" ? Promise.resolve(7) : 7,
        unschedule: () => kind === "schedule" ? undefined : Promise.reject(Error("synthetic cleanup failure")),
        onExpire: () => { expired++; } });
      const armed = deadline.arm();
      deadline.dispose();
      setTimeout(() => console.log(JSON.stringify({ armed, expired, phase: deadline.state().phase })), 20);
    `;
    const child = spawnSync(process.execPath, ["--unhandled-rejections=strict", "--input-type=module", "-e", script],
      { timeout: 5000, encoding: "utf8", windowsHide: true });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, "");
    const result = JSON.parse(child.stdout);
    assert.deepEqual(result, { armed: kind === "cleanup", expired: kind === "cleanup" ? 0 : 1, phase: "disposed" });
  });
}

test("timer contract: synchronous opaque handles and zero remain supported", () => {
  for (const handle of [0, { nativeTimer: true }, Object.create(null)]) {
    const removed = [];
    const deadline = createSecureDeadline({ now: () => 1, schedule: () => handle,
      unschedule: value => removed.push(value) });
    assert(deadline.arm());
    assert(deadline.check());
    deadline.dispose();
    assert.deepEqual(removed, [handle]);
  }
});
