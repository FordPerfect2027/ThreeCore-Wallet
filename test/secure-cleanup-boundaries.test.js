import test from "node:test";
import assert from "node:assert/strict";
import { createSecureDeadline } from "../src/secure-deadline.js";
import { manualTime } from "./helpers/secure-lifecycle-time.js";
import { controllerFixture, encryptedText } from "./helpers/secure-backup-fixtures.js";

function cleanupTime() {
  const time = manualTime();
  let hook = null;
  return { time, setHook(value) { hook = value; }, options: { ...time.options,
    unschedule(id) {
      time.unschedule(id);
      const run = hook; hook = null;
      run?.();
    },
  } };
}

for (const action of ["clear", "dispose"]) {
  test(`deadline: ${action} during old-timer removal defeats an outer rearm`, () => {
    const f = cleanupTime();
    const deadline = createSecureDeadline({ ...f.options, timeoutMs: 100 });
    assert.equal(deadline.arm(), true);
    f.setHook(() => deadline[action]());
    assert.equal(deadline.arm(), false);
    assert.equal(deadline.check(), false);
    assert.equal(deadline.state().phase, action === "clear" ? "idle" : "disposed");
    assert.equal(f.time.pending, 0);
    deadline.dispose();
  });
}

for (const action of ["clear", "expire"]) {
  test(`deadline: timer cleanup cannot rearm from inside ${action}`, () => {
    const f = cleanupTime();
    const deadline = createSecureDeadline({ ...f.options, timeoutMs: 100 });
    let nested;
    assert.equal(deadline.arm(), true);
    f.setHook(() => { nested = deadline.arm(); });
    if (action === "clear") deadline.clear();
    else { f.time.advance(100); assert.equal(deadline.check(), false); }
    assert.equal(nested, false);
    assert.equal(deadline.check(), false);
    assert.equal(f.time.pending, 0);
    deadline.dispose();
  });
}

const stoppedPhase = { cancel: "cancelled", invalidate: "idle", dispose: "disposed" };
for (const action of Object.keys(stoppedPhase)) {
  for (const operation of ["stage", "replace", "fail"]) {
    test(`backup: ${action} during ${operation} cleanup preserves the stop`, async t => {
      const timer = cleanupTime();
      const f = controllerFixture({ lifetimeOptions: timer.options });
      t.after(() => f.controller.dispose());
      if (operation === "stage") { await f.select(); await f.unlock(); }
      else if (operation === "fail") { await f.seal(); f.change(); }
      else await f.select();
      let reached = false, downloads = 0;
      timer.setHook(() => { reached = true; f.controller[action](); });
      const result = operation === "stage" ? f.controller.stage() :
        operation === "replace" ? f.controller.selectText(encryptedText()) :
        f.controller.offer(() => { downloads++; });
      assert(reached, "Timer cleanup boundary must be reached");
      assert.equal(result, false);
      assert.equal(f.staged.length, 0, "Stopped plaintext must never reach the staging callback");
      assert.equal(downloads, 0);
      assert.equal(f.controller.state().phase, stoppedPhase[action]);
      assert.equal(f.controller.state().canStage, false);
      assert.equal(f.controller.state().canDecrypt, false);
      assert.equal(f.controller.state().canDownload, false);
      assert.equal(timer.time.pending, 0);
    });
  }
}

for (const action of ["clear", "dispose"]) {
  test(`deadline: ${action} survives a cleanup exception and every stale timer`, () => {
    const f = cleanupTime();
    const deadline = createSecureDeadline({ ...f.options, timeoutMs: 100 });
    assert(deadline.arm());
    const ids = f.time.allIds();
    f.setHook(() => { deadline[action](); throw Error("synthetic private adapter error"); });
    assert.equal(deadline.arm(), false);
    f.time.advance(1000);
    for (const id of ids) f.time.fire(id, { stale: true });
    assert.equal(deadline.state().phase, action === "dispose" ? "disposed" : "idle");
    assert.equal(deadline.check(), false);
    assert.equal(f.time.pending, 0);
    assert(!JSON.stringify(deadline.state()).includes("private"));
    deadline.dispose();
  });
}

test("deadline: a rejected cleanup rearm does not prevent a later explicit lifetime", () => {
  const f = cleanupTime();
  const deadline = createSecureDeadline({ ...f.options, timeoutMs: 100 });
  assert(deadline.arm());
  const old = f.time.ids()[0];
  let nested;
  f.setHook(() => { nested = deadline.arm(); });
  deadline.clear();
  assert.equal(nested, false);
  f.time.advance(75);
  assert(deadline.arm());
  f.time.fire(old, { stale: true });
  f.time.advance(99);
  assert(deadline.check());
  f.time.advance(1);
  assert.equal(deadline.check(), false);
  assert.equal(f.time.pending, 0);
});

test("deadline: disposal from timer installation cannot be reversed by returned-handle cleanup", () => {
  const f = cleanupTime();
  let deadline, nested;
  deadline = createSecureDeadline({ ...f.options, timeoutMs: 100,
    schedule(fn, delay) {
      const handle = f.time.schedule(fn, delay);
      deadline.dispose();
      f.setHook(() => { nested = deadline.arm(); });
      return handle;
    },
  });
  assert.equal(deadline.arm(), false);
  assert.equal(nested, false);
  assert.equal(deadline.state().phase, "disposed");
  assert.equal(f.time.pending, 0);
});

for (const action of ["cancel", "invalidate"]) {
  test(`backup: a fresh selection works after ${action} interrupted cleanup`, async t => {
    const timer = cleanupTime();
    const f = controllerFixture({ lifetimeOptions: timer.options });
    t.after(() => f.controller.dispose());
    await f.select(); await f.unlock();
    const old = timer.time.allIds();
    timer.setHook(() => f.controller[action]());
    assert.equal(f.controller.stage(), false);
    assert.equal(f.staged.length, 0);
    assert.equal(await f.select(), true);
    for (const id of old) timer.time.fire(id, { stale: true });
    assert.equal(f.controller.state().phase, "selected");
    assert.equal(await f.unlock(), true);
    assert.equal(f.controller.stage(), true);
    assert.equal(f.staged.length, 1);
    assert.equal(timer.time.pending, 0);
  });
}

test("backup: recursive staging from timer removal has no second handoff", async t => {
  const timer = cleanupTime();
  const f = controllerFixture({ lifetimeOptions: timer.options });
  t.after(() => f.controller.dispose());
  await f.select(); await f.unlock();
  let nested;
  timer.setHook(() => { nested = f.controller.stage(); });
  assert.equal(f.controller.stage(), true);
  assert.equal(nested, false);
  assert.equal(f.staged.length, 1);
  assert.equal(f.controller.state().phase, "staged");
});

test("backup: cleanup cannot expose the previous encrypted candidate", async t => {
  const timer = cleanupTime();
  const f = controllerFixture({ lifetimeOptions: timer.options });
  t.after(() => f.controller.dispose());
  await f.seal();
  let attempted = false, readable = false, snapshot;
  timer.setHook(() => {
    attempted = true;
    try { f.controller.encryptedText(); readable = true; } catch {}
    snapshot = f.controller.state();
  });
  f.controller.cancel();
  assert(attempted);
  assert.equal(readable, false);
  assert.equal(snapshot.encryptedBytes, 0);
  assert.equal(f.controller.state().phase, "cancelled");
});
