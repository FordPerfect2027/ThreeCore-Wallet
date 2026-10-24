import test from "node:test";
import assert from "node:assert/strict";
import { createExportGuard } from "../src/export-guard.js";
import { inspectExportStatus } from "../src/export-status.js";
import { clockFixture, prepared } from "./helpers/export-fixtures.js";

function random(seed) {
  let state = seed >>> 0;
  return maximum => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maximum;
  };
}

// This model tracks externally observable allocation/disposal, not private
// guard methods. Varying command order exposes accounting and stale-timer bugs.
for (const seed of [1, 19, 83, 127, 1069, 20261024]) {
  test("deterministic export lifecycle trace preserves quotas, seed " + seed, () => {
    const choose = random(seed), clock = clockFixture(), resources = [];
    let broken = false, activations = 0;
    const guard = createExportGuard({ now: clock.now, schedule: clock.schedule,
      unschedule: clock.unschedule,
      createResource(payload) {
        const item = { bytes: payload.byteLength, retained: true, activated: false };
        resources.push(item);
        return {
          activate() { item.activated = true; activations++; },
          release() {
            if (broken) return false;
            item.retained = false; return true;
          },
        };
      },
    });
    for (let step = 0; step < 500; step++) {
      const operation = choose(9);
      if (operation <= 2) {
        const text = ["x", "日本", "😀", "plain text"][choose(4)];
        try { guard.offer(prepared({ text })); }
        catch (error) { assert(["EXPORT_BUSY", "EXPORT_CLEANUP"].includes(error.code)); }
      } else if (operation === 3) {
        clock.advance(choose(1500)); clock.due();
      } else if (operation === 4) {
        guard.clear();
      } else if (operation === 5) {
        broken = !broken;
      } else if (operation === 6) {
        guard.retryCleanup();
      } else if (operation === 7) {
        const old = clock.cancelled[choose(Math.max(1, clock.cancelled.length))];
        old?.fn();
      } else {
        const state = guard.state();
        assert.throws(() => guard.offer(prepared({ filename: "../bad.json" })));
        assert.equal(guard.state().accepted, state.accepted);
      }
      const state = guard.state(), retained = resources.filter(item => item.retained);
      assert(inspectExportStatus(state), "invalid state at " + step);
      assert.equal(state.active, retained.length, "retained count at " + step);
      assert.equal(state.reservedBytes, retained.reduce((sum, item) => sum + item.bytes, 0));
      assert.equal(state.accepted, resources.length);
      assert.equal(state.offered, activations);
      assert.equal(state.accepted, state.active + state.released);
      assert(state.active <= 4);
      assert(clock.timers.size <= 4);
      if (state.cleanupBlocked) assert.equal(state.canOffer, false);
    }
    broken = false; guard.dispose(); guard.retryCleanup();
    assert.equal(guard.state().active, 0);
    assert.equal(guard.state().reservedBytes, 0);
    assert.equal(clock.timers.size, 0);
    assert(resources.every(item => !item.retained));
  });
}

test("full count budget rejects before inspecting an expensive hostile payload", () => {
  const clock = clockFixture();
  const guard = createExportGuard({ now: clock.now, schedule: clock.schedule,
    unschedule: clock.unschedule, createResource: () => ({ activate() {}, release() {} }) });
  for (let i = 0; i < 4; i++) guard.offer(prepared());
  let reads = 0;
  const input = new Proxy(prepared(), { getPrototypeOf() { reads++; throw Error("must not inspect"); } });
  assert.throws(() => guard.offer(input), { code: "EXPORT_BUSY" });
  assert.equal(reads, 0);
  guard.clear();
});

test("later cleanup failure cannot leave an earlier success message on the panel", async () => {
  const { mountExportGuardPanel } = await import("../examples/export-guard-panel.js");
  const { browserFixture } = await import("./helpers/export-fixtures.js");
  const dom = browserFixture(), clock = clockFixture();
  let broken = false;
  const guard = createExportGuard({ now: clock.now, schedule: clock.schedule,
    unschedule: clock.unschedule, createResource: () => ({ activate() {}, release: () => !broken }) });
  const panel = mountExportGuardPanel({ document: dom.document, parent: dom.body, guard });
  guard.offer(prepared()); dom.body.find("export-guard-clear").click();
  assert(dom.body.find("export-guard-outcome").textContent.includes("解放を確認しました"));
  guard.offer(prepared()); broken = true;
  clock.advance(1000); clock.due();
  assert.equal(dom.body.find("export-guard-panel").dataset.phase, "cleanup");
  assert.equal(dom.body.find("export-guard-outcome").textContent, "");
  broken = false; guard.dispose(); guard.retryCleanup(); panel.dispose();
});

test("disposed guard still describes retained cleanup failure before closed status", async () => {
  const { describeExportStatus } = await import("../src/export-status.js");
  const clock = clockFixture(); let broken = true;
  const guard = createExportGuard({ now: clock.now, schedule: clock.schedule,
    unschedule: clock.unschedule, createResource: () => ({ activate() {}, release: () => !broken }) });
  guard.offer(prepared()); guard.dispose();
  assert.equal(describeExportStatus(guard.state()).kind, "cleanup");
  broken = false; guard.retryCleanup();
  assert.equal(describeExportStatus(guard.state()).kind, "closed");
});
