import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodController } from "../src/period-controller.js";
import { collectPeriod } from "../src/period-reader.js";
import { periodDraftKey, periodDraftProgress } from "../src/period-draft.js";
import { preparePeriodFile } from "../src/period-file.js";
import { plan, checkpoint, periodSession, context, OTHER, fileFrom, deferred, tick, clone } from "./helpers/period-fixtures.js";

function fixture(options = {}) {
  const session = periodSession();
  const views = [];
  const deliveries = [];
  let reads = 0;
  const controller = createPeriodController({
    getContext: agent => ({ agent, chainId: session.state.chainId, account: session.state.account }),
    read: async (agent, value, config) => { reads++; return collectPeriod(session.session, value, config); },
    onChange: value => views.push(value),
    stageWorkspace: (value, agent) => { deliveries.push({ value, agent }); return true; },
    ...options,
  });
  function prepare(changes = {}) {
    return controller.prepare({ earlierBlock: "30", laterBlock: "42", windowSize: 5, ...changes });
  }
  return { controller, session, views, deliveries, prepare, get reads() { return reads; },
    accept: () => { prepare(); return controller.apply(); } };
}

test("mount and plan review perform no provider reads", () => {
  const f = fixture();
  assert.equal(f.controller.state.draft, null);
  assert.equal(f.prepare(), true);
  assert.equal(f.controller.state.draft, null);
  assert.equal(f.controller.state.review.requiresReplacement, false);
  assert.equal(f.reads, 0);
  assert.deepEqual(f.session.calls, []);
  assert.equal(f.controller.apply(), true);
  assert.equal(f.controller.state.phase, "ready");
  assert.equal(f.reads, 0);
});

test("start requires an applied plan", async () => {
  const f = fixture();
  assert.equal(await f.controller.start(), false);
  assert.equal(f.controller.state.error, "PERIOD_NO_DRAFT");
  f.prepare();
  assert.equal(await f.controller.start(), false);
  assert.equal(f.reads, 0);
});

test("successful start records every checkpoint and a final checked-session flag", async () => {
  const f = fixture();
  f.accept();
  assert.equal(await f.controller.start(), true);
  assert.equal(f.controller.state.phase, "complete");
  assert.equal(f.controller.state.checkedThisSession, true);
  assert.equal(f.controller.state.origin, "session");
  assert.equal(f.controller.state.revision, 6);
  assert.equal(periodDraftProgress(f.controller.state.draft).complete, true);
  assert.equal(f.reads, 1);
});

test("unfinished steps survive read failure and explicit retry", async () => {
  let attempts = 0;
  const f = fixture({ read: async (agent, selected, options) => {
    attempts++;
    options.onCheckpoint(checkpoint(1));
    options.onCheckpoint(checkpoint(2));
    options.onCheckpoint(checkpoint(3));
    if (attempts === 1) throw { code: "TRANSFER_RPC_FAILED" };
    options.onCheckpoint(checkpoint(4));
    options.onCheckpoint(checkpoint(5));
    return checkpoint();
  } });
  f.accept();
  assert.equal(await f.controller.start(), false);
  assert.equal(f.controller.state.error, "TRANSFER_RPC_FAILED");
  assert.equal(periodDraftProgress(f.controller.state.draft).completed, 3);
  assert.equal(attempts, 1);
  // A second run starts from the retained draft and must not regress its prefix.
  f.controller.dispose();
});

test("retry receives the retained prefix and appends only later steps", async () => {
  let attempts = 0;
  const received = [];
  const f = fixture({ read: async (agent, selected, options) => {
    attempts++;
    received.push(periodDraftProgress(options.draft).completed);
    for (let count = received.at(-1) + 1; count <= (attempts === 1 ? 3 : 5); count++) options.onCheckpoint(checkpoint(count));
    if (attempts === 1) throw { code: "PERIOD_TIMEOUT" };
    return checkpoint();
  } });
  f.accept();
  await f.controller.start();
  assert.equal(await f.controller.start(), true);
  assert.deepEqual(received, [0, 3]);
});

test("replacement of acquired evidence requires strict boolean acknowledgement", async () => {
  const f = fixture();
  f.accept();
  await f.controller.start();
  const old = periodDraftKey(f.controller.state.draft);
  f.prepare({ laterBlock: "43" });
  assert.equal(f.controller.state.review.requiresReplacement, true);
  for (const value of [false, undefined, 1, "true", {}]) {
    assert.equal(f.controller.apply(value), false);
    assert.equal(periodDraftKey(f.controller.state.draft), old);
  }
  assert.equal(f.controller.apply(true), true);
  assert.equal(f.controller.state.draft.plan.laterBlock, "43");
  assert.equal(f.controller.state.checkedThisSession, false);
});

test("plan review becomes invalid when its source fields change", () => {
  const f = fixture();
  f.prepare();
  f.controller.invalidate();
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.apply(), false);
  assert.equal(f.controller.state.draft, null);
});

test("silent context change is detected when applying a reviewed plan", () => {
  const f = fixture();
  f.prepare();
  f.session.state.account = OTHER;
  assert.equal(f.controller.apply(), false);
  assert.equal(f.controller.state.error, "PERIOD_STALE_REVIEW");
});

test("failed new plan clears a previously actionable review", () => {
  const f = fixture();
  f.prepare();
  assert.equal(f.prepare({ earlierBlock: "invalid" }), false);
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.apply(), false);
});

test("busy double start is refused without losing the active run", async () => {
  const gate = deferred();
  let options;
  const f = fixture({ read: async (agent, selected, config) => { options = config; await gate.promise; return config.draft; } });
  f.accept();
  const running = f.controller.start();
  assert.equal(await f.controller.start(), false);
  assert.equal(f.controller.state.phase, "reading");
  assert.equal(options.signal.aborted, false);
  f.controller.cancel();
  gate.resolve();
  assert.equal(await running, false);
});

test("cancel preserves completed prefix and ignores late checkpoints and failures", async () => {
  const gate = deferred();
  let options;
  const f = fixture({ read: async (agent, selected, config) => {
    options = config;
    config.onCheckpoint(checkpoint(1));
    await gate.promise;
    config.onCheckpoint(checkpoint(2));
    throw { code: "TRANSFER_RPC_FAILED" };
  } });
  f.accept();
  const pending = f.controller.start();
  f.controller.cancel();
  assert.equal(options.signal.aborted, true);
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(periodDraftProgress(f.controller.state.draft).completed, 1);
  assert.equal(f.controller.state.error, null);
});

test("selection change cancels reads without deleting saved work", async () => {
  const gate = deferred();
  const f = fixture({ read: async (agent, selected, config) => {
    config.onCheckpoint(checkpoint(2)); await gate.promise; return checkpoint();
  } });
  f.accept();
  const pending = f.controller.start();
  assert.equal(f.controller.selectAgent("EMA"), true);
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(f.controller.state.agent, "EMA");
  assert.equal(f.controller.state.draft.plan.context.agent, "DAT");
  assert.equal(await f.controller.start(), false);
  assert.equal(f.controller.state.error, "PERIOD_CONTEXT_MISMATCH");
});

test("offline import is staged without reconnecting or reading", async () => {
  const f = fixture({ getContext: () => { throw { code: "PERIOD_NOT_CONNECTED" }; } });
  const file = await preparePeriodFile(checkpoint(3));
  assert.equal(await f.controller.importFile(fileFrom(file.text)), true);
  assert.equal(f.controller.state.draft, null);
  assert.equal(f.controller.apply(), true);
  assert.equal(f.controller.state.origin, "imported");
  assert.equal(f.controller.state.checkedThisSession, false);
  assert.equal(f.reads, 0);
  assert.equal(await f.controller.start(), false);
  assert.equal(periodDraftProgress(f.controller.state.draft).completed, 3);
});

test("corrupt import retains current draft and cannot leave an older review actionable", async () => {
  const f = fixture();
  f.accept();
  const before = periodDraftKey(f.controller.state.draft);
  await f.controller.importFile(fileFrom((await preparePeriodFile(checkpoint())).text));
  assert.equal(await f.controller.importFile(fileFrom("{}")), false);
  assert.equal(f.controller.state.review, null);
  assert.equal(periodDraftKey(f.controller.state.draft), before);
});

for (const action of ["cancel", "dispose", "selectAgent"]) {
  test("late file import is inert after " + action, async () => {
    const gate = deferred();
    const f = fixture({ readFile: () => gate.promise });
    const pending = f.controller.importFile({});
    f.controller[action]("EMA");
    gate.resolve({ draft: checkpoint() });
    assert.equal(await pending, false);
    assert.equal(f.controller.state.draft, null);
    assert.equal(f.controller.state.review, null);
  });
}

test("complete import may be handed off as historical evidence without claiming a live recheck", async () => {
  const f = fixture();
  await f.controller.importFile(fileFrom((await preparePeriodFile(checkpoint())).text));
  f.controller.apply();
  assert.equal(f.controller.sendToReconciliation(), true);
  assert.equal(f.deliveries[0].agent, "DAT");
  assert.equal(f.deliveries[0].value.slots[0].archive.records.length, 3);
  assert.equal(f.controller.state.checkedThisSession, false);
  assert.equal(f.reads, 0);
});

test("partial draft cannot be sent to reconciliation", () => {
  const f = fixture();
  f.accept();
  assert.equal(f.controller.sendToReconciliation(), false);
  assert.equal(f.deliveries.length, 0);
});

test("failed handoff does not consume the saved checkpoint", async () => {
  const f = fixture({ stageWorkspace: () => false });
  await f.controller.importFile(fileFrom((await preparePeriodFile(checkpoint())).text));
  f.controller.apply();
  const key = periodDraftKey(f.controller.state.draft);
  assert.equal(f.controller.sendToReconciliation(), false);
  assert.equal(f.controller.state.error, "PERIOD_DELIVERY_FAILED");
  assert.equal(periodDraftKey(f.controller.state.draft), key);
});

test("JSON export marks only its exact saved checkpoint as initiated", async () => {
  const f = fixture();
  f.accept();
  const files = [];
  assert.equal(await f.controller.exportFile("draft", value => files.push(value)), true);
  assert.equal(f.controller.state.savedCurrent, true);
  assert.equal(files.length, 1);
  await f.controller.start();
  assert.equal(f.controller.state.savedCurrent, false);
});

test("export cancellation prevents a late file delivery", async () => {
  const gate = deferred();
  const f = fixture({ prepareFile: () => gate.promise });
  f.accept();
  let deliveries = 0;
  const pending = f.controller.exportFile("draft", () => { deliveries++; });
  f.controller.cancel();
  gate.resolve({ text: "irrelevant" });
  assert.equal(await pending, false);
  assert.equal(deliveries, 0);
  assert.equal(f.controller.state.savedCurrent, false);
});

test("incomplete reconciliation export fails without changing draft", async () => {
  const f = fixture();
  f.accept();
  const key = periodDraftKey(f.controller.state.draft);
  assert.equal(await f.controller.exportFile("reconciliation", () => assert.fail()), false);
  assert.equal(f.controller.state.error, "PERIOD_INCOMPLETE");
  assert.equal(periodDraftKey(f.controller.state.draft), key);
});

test("broken display callback does not prevent successful acquisition", async () => {
  const f = fixture({ onChange: () => { throw Error("broken view"); } });
  f.accept();
  assert.equal(await f.controller.start(), true);
});

test("conflicting checkpoint from a reader aborts and preserves prior evidence", async () => {
  let aborted;
  const f = fixture({ read: async (agent, selected, options) => {
    options.onCheckpoint(checkpoint(2));
    const altered = clone(checkpoint(3));
    altered.earlier.balanceBaseUnits = "1";
    options.onCheckpoint(altered);
    aborted = options.signal.aborted;
    return altered;
  } });
  f.accept();
  assert.equal(await f.controller.start(), false);
  assert.equal(aborted, true);
  assert.equal(f.controller.state.error, "PERIOD_CHECKPOINT_CONFLICT");
  assert.equal(periodDraftKey(f.controller.state.draft), periodDraftKey(checkpoint(2)));
});

test("dispose aborts and makes subsequent actions inert", async () => {
  const f = fixture();
  f.accept();
  f.controller.dispose();
  assert.equal(f.prepare(), false);
  assert.equal(f.controller.apply(), false);
  assert.equal(await f.controller.start(), false);
  assert.equal(await f.controller.importFile({}), false);
  assert.equal(await f.controller.exportFile("draft", () => assert.fail()), false);
  assert.equal(f.controller.sendToReconciliation(), false);
});
