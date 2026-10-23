import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodController } from "../src/period-controller.js";
import { collectPeriod } from "../src/period-reader.js";
import { periodDraftKey } from "../src/period-draft.js";
import { preparePeriodFile } from "../src/period-file.js";
import { checkpoint, periodSession, fileFrom, deferred } from "./helpers/period-fixtures.js";

function setup(overrides = {}) {
  const session = periodSession();
  const controller = createPeriodController({
    getContext: agent => ({ agent, chainId: session.state.chainId, account: session.state.account }),
    read: (agent, plan, options) => collectPeriod(session.session, plan, options),
    ...overrides,
  });
  const prepare = (laterBlock = "42") => controller.prepare({ earlierBlock: "30", laterBlock, windowSize: 5 });
  return { controller, session, prepare, accept() { prepare(); controller.apply(); } };
}

for (const action of ["cancel", "dispose", "selectAgent"]) {
  test("synchronous export delivery cannot mark a changed lifecycle saved: " + action, async () => {
    const f = setup();
    f.accept();
    let delivered = 0;
    const result = await f.controller.exportFile("draft", () => {
      delivered++;
      f.controller[action]("EMA");
    });
    assert.equal(delivered, 1);
    assert.equal(result, false);
    assert.equal(f.controller.state.savedCurrent, false);
    if (action === "selectAgent") assert.equal(f.controller.state.agent, "EMA");
    if (action === "dispose") assert.equal(f.controller.state.disposed, true);
    else assert.equal(f.controller.state.phase, "ready");
  });
}

test("replacing a draft inside delivery does not mark the replacement saved", async () => {
  const f = setup();
  f.accept();
  let actualFile;
  assert.equal(await f.controller.exportFile("draft", file => {
    actualFile = file;
    f.controller.cancel();
    f.prepare("43");
    f.controller.apply();
  }), false);
  assert.equal(JSON.parse(actualFile.text).draft.plan.laterBlock, "42");
  assert.equal(f.controller.state.draft.plan.laterBlock, "43");
  assert.equal(f.controller.state.savedCurrent, false);
});

for (const phase of ["importing", "exporting"]) {
  for (const action of ["cancel", "dispose"]) {
    test("display-triggered " + action + " before " + phase + " prevents file work", async () => {
      let f;
      let work = 0;
      f = setup({
        onChange(state) { if (state.phase === phase) f.controller[action](); },
        readFile() { work++; return { draft: checkpoint() }; },
        prepareFile() { work++; return { text: "unused" }; },
      });
      f.accept();
      const before = periodDraftKey(f.controller.state.draft);
      const result = phase === "importing"
        ? await f.controller.importFile({})
        : await f.controller.exportFile("draft", () => assert.fail("delivery after cancellation"));
      assert.equal(result, false);
      assert.equal(work, 0);
      assert.equal(periodDraftKey(f.controller.state.draft), before);
    });
  }
}

test("failed recovery preparation removes an older actionable plan review", async () => {
  const f = setup();
  f.accept();
  await f.controller.start();
  const old = periodDraftKey(f.controller.state.draft);
  f.prepare("43");
  assert(f.controller.state.review);
  assert.equal(f.controller.prepareRepair(), false);
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.apply(true), false);
  assert.equal(periodDraftKey(f.controller.state.draft), old);
});

for (const error of ["PERIOD_BLOCK_CHANGED", "IDENTITY_BLOCK_CHANGED", "TRANSFER_BLOCK_CHANGED"]) {
  test("reimporting the same rejected checkpoint retains the recheck block: " + error, async () => {
    const f = setup({ read: async () => { throw { code: error }; } });
    const file = await preparePeriodFile(checkpoint());
    await f.controller.importFile(fileFrom(file.text));
    f.controller.apply();
    assert.equal(await f.controller.start(), false);
    assert.equal(f.controller.state.requiresNewPlan, true);
    // Users can still preserve the rejected evidence for offline examination.
    assert.equal(await f.controller.exportFile("draft", () => {}), true);
    await f.controller.importFile(fileFrom(file.text));
    assert.equal(f.controller.apply(), true);
    assert.equal(f.controller.state.requiresNewPlan, true);
    assert.equal(f.controller.sendToReconciliation(), false);
    assert.equal(await f.controller.exportFile("reconciliation", () => assert.fail()), false);
    assert.equal(await f.controller.start(), false);
    assert.equal(f.controller.state.error, "PERIOD_NEW_PLAN_REQUIRED");
    assert.equal(f.controller.prepareRepair(), true);
    assert.equal(f.controller.apply(true), true);
    assert.equal(f.controller.state.requiresNewPlan, false);
    assert.equal(f.controller.state.draft.earlier, null);
    assert.deepEqual(f.controller.state.draft.records, []);
  });
}

test("late export failure cannot replace a new plan's state", async () => {
  const gate = deferred();
  const f = setup({ prepareFile: () => gate.promise });
  f.accept();
  const pending = f.controller.exportFile("draft", () => assert.fail());
  f.controller.cancel();
  f.prepare("43");
  f.controller.apply();
  const expected = f.controller.state;
  gate.reject({ code: "PERIOD_CHECKSUM" });
  assert.equal(await pending, false);
  assert.deepEqual(f.controller.state, expected);
});

test("rejected JSON delivery keeps the existing checkpoint and saved status", async () => {
  const f = setup();
  f.accept();
  const before = periodDraftKey(f.controller.state.draft);
  assert.equal(await f.controller.exportFile("draft", () => { throw Error("disk unavailable"); }), false);
  assert.equal(periodDraftKey(f.controller.state.draft), before);
  assert.equal(f.controller.state.savedCurrent, false);
  assert.equal(f.controller.state.error, "PERIOD_READ_FAILED");
});

test("state subscribers can stop before the first provider call", async () => {
  let f;
  f = setup({ onChange(state) { if (state.phase === "reading") f.controller.cancel(); } });
  f.accept();
  assert.equal(await f.controller.start(), false);
  assert.deepEqual(f.session.calls, []);
  assert.equal(f.controller.state.phase, "ready");
  assert.equal(f.controller.state.checkedThisSession, false);
});

test("an imported checkpoint is never described as freshly checked by JSON export", async () => {
  const f = setup();
  await f.controller.importFile(fileFrom((await preparePeriodFile(checkpoint())).text));
  f.controller.apply();
  for (const kind of ["draft", "text", "reconciliation"]) {
    assert.equal(await f.controller.exportFile(kind, () => {}), true);
    assert.equal(f.controller.state.checkedThisSession, false);
    assert.equal(f.controller.state.origin, "imported");
  }
  assert.deepEqual(f.session.calls, []);
});

for (const reject of [false, true]) {
  test("async delivery is refused and its rejection is drained: " + reject, async () => {
    const f = setup();
    f.accept();
    const before = periodDraftKey(f.controller.state.draft);
    const result = await f.controller.exportFile("draft", () => reject
      ? Promise.reject(Error("unavailable download destination")) : Promise.resolve());
    assert.equal(result, false);
    assert.equal(f.controller.state.error, "PERIOD_ASYNC_DELIVERY");
    assert.equal(f.controller.state.savedCurrent, false);
    assert.equal(periodDraftKey(f.controller.state.draft), before);
    // The test runner also fails if an unhandled rejection escapes this turn.
    await new Promise(resolve => setImmediate(resolve));
  });
}
