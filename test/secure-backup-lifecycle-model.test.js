import test from "node:test";
import assert from "node:assert/strict";
import { createSecureBackupRunner } from "../src/secure-backup-runner.js";
import { createSecureBackupController } from "../src/secure-backup-controller.js";
import { createSecureDeadline } from "../src/secure-deadline.js";
import { draft, fakePrepared, fakeDecoded, encryptedText, PASSWORD, gate } from "./helpers/secure-backup-fixtures.js";
import { manualTime, microtasks } from "./helpers/secure-lifecycle-time.js";

function random(seed) {
  let state = seed >>> 0;
  return maximum => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maximum;
  };
}

// Repeatable interleavings explore independently mounted panels sharing one
// native slot, with successful, failed and cancelled operations finishing late.
for (const seed of [1, 9, 17, 31, 58, 91, 132, 251, 347, 509, 1013, 65537]) {
  test("shared backup panels preserve lifecycle invariants, trace " + seed, async () => {
    const choose = random(seed);
    const time = manualTime();
    const runner = createSecureBackupRunner({ ...time.options, timeoutMs: 200 });
    const native = [];
    const promises = [];
    const actions = [];
    let held = 0;
    let maximumHeld = 0;
    function backend(kind) {
      held++;
      maximumHeld = Math.max(maximumHeld, held);
      const pending = gate();
      const entry = { pending, settled: false, kind };
      native.push(entry);
      return pending.promise.finally(() => { held--; });
    }
    function make() {
      const staged = [];
      const downloaded = [];
      const controller = createSecureBackupController({ readDraft: () => draft(),
        onStage(text) { staged.push(text); return true; }, runner,
        encrypt: () => backend("encrypt"), decrypt: () => backend("decrypt"),
        resultLifetimeMs: 100, lifetimeOptions: time.options });
      return { controller, staged, downloaded };
    }
    const panels = [make(), make()];
    function resolveOne(reject = false) {
      const pending = native.find(entry => !entry.settled);
      if (!pending) return;
      pending.settled = true;
      if (reject) pending.pending.reject(Error("synthetic late failure"));
      else pending.pending.resolve(pending.kind === "encrypt" ? fakePrepared() : fakeDecoded());
    }
    try {
      for (let step = 0; step < 96; step++) {
        const f = panels[choose(2)];
        const controller = f.controller;
        const action = choose(11);
        actions.push(action);
        if (action === 0) promises.push(controller.seal(PASSWORD, PASSWORD));
        if (action === 1) controller.selectText(encryptedText());
        if (action === 2) promises.push(controller.unlock(PASSWORD));
        if (action === 3) controller.cancel();
        if (action === 4) controller.invalidate();
        if (action === 5) time.advance(choose(180));
        if (action === 6) resolveOne(false);
        if (action === 7) resolveOne(true);
        if (action === 8) time.flush();
        if (action === 9) {
          const before = controller.state();
          const count = f.staged.length;
          const result = controller.stage();
          assert.equal(f.staged.length - count, result ? 1 : 0);
          if (result) assert.equal(before.canStage, true);
        }
        if (action === 10) {
          const before = controller.state();
          const count = f.downloaded.length;
          const result = controller.offer(value => { f.downloaded.push(value); });
          assert.equal(f.downloaded.length - count, result ? 1 : 0);
          if (result) assert.equal(before.canDownload, true);
        }
        await microtasks();
        assert(held >= 0 && held <= 1, "native capacity: " + actions.join());
        for (const panel of panels) {
          const state = panel.controller.state();
          assert([state.canDownload, state.canDecrypt, state.canStage].filter(Boolean).length <= 1);
          if (state.phase === "cancelled" || state.phase === "error" || state.phase === "idle") {
            assert.equal(state.canDownload || state.canDecrypt || state.canStage, false);
            assert.equal(state.summary, null);
            assert.equal(state.encryptedBytes, 0);
          }
          assert.equal(state.diskSaved, false);
          assert(!JSON.stringify(state).includes(PASSWORD));
        }
        assert.equal(runner.busy(), held > 0, "slot tracks actual backend settlement");
      }
    } finally {
      panels.forEach(f => f.controller.dispose());
      runner.dispose();
      for (const entry of native) {
        if (!entry.settled) { entry.settled = true; entry.pending.resolve({}); }
      }
      await Promise.allSettled(promises);
      await microtasks();
    }
    assert(maximumHeld <= 1);
    assert.equal(held, 0);
    assert.equal(runner.busy(), false);
    assert.equal(time.pending, 0);
    for (const panel of panels) {
      assert.equal(panel.controller.state().phase, "disposed");
      for (const value of panel.downloaded) assert.equal(value.filename, "ThreeCore-workspace-encrypted.json");
      for (const text of panel.staged) assert.deepEqual(JSON.parse(text).entries.map(row => row.agent), ["DAT", "EMA", "CAWELON"]);
    }
  });
}

// An independent model uses only start time and revocation, rather than the
// implementation's timer versions. Stale callback delivery must match it.
for (const seed of [3, 7, 19, 37, 101, 211, 997, 4093]) {
  test("deadline follows absolute-time model across stale callback traces " + seed, () => {
    const choose = random(seed);
    const time = manualTime();
    let armedAt = null;
    let disposed = false;
    let expectedExpirations = 0;
    let actualExpirations = 0;
    const deadline = createSecureDeadline({ ...time.options, timeoutMs: 80,
      onExpire() { actualExpirations++; } });
    function modelCheck() {
      if (disposed || armedAt === null) return false;
      if (time.value - armedAt >= 80) {
        expectedExpirations++;
        armedAt = null;
        return false;
      }
      return true;
    }
    for (let step = 0; step < 160; step++) {
      const action = choose(7);
      if (action === 0 && !disposed) { armedAt = time.value; assert.equal(deadline.arm(), true); }
      if (action === 1) { armedAt = null; deadline.clear(); }
      if (action === 2) time.advance(choose(90));
      if (action === 3) {
        const ids = time.allIds();
        // Deliver callbacks from revoked lifetimes; only active timers can expire.
        const live = new Set(time.ids());
        const old = ids.filter(id => !live.has(id));
        if (old.length) time.fire(old[choose(old.length)], { stale: true });
      }
      if (action === 4) { modelCheck(); time.flush(); }
      if (action === 5 && step > 140) { disposed = true; armedAt = null; deadline.dispose(); }
      if (action === 6) {
        assert(Object.isFrozen(deadline.state()));
      }
      assert.equal(deadline.check(), modelCheck(), "trace step " + step);
      assert.equal(actualExpirations, expectedExpirations);
      assert(time.pending <= 1);
    }
    deadline.dispose();
    assert.equal(time.pending, 0);
  });
}
