import test from "node:test";
import assert from "node:assert/strict";
import { createCheckpointController } from "../src/checkpoint-controller.js";
import { createCheckpointStorage } from "../src/checkpoint-storage.js";
import { createEncryptedLibraryController } from "../src/encrypted-library-controller.js";
import { createEncryptedLibraryStorage } from "../src/encrypted-library-storage.js";
import { createPeriodLibraryController } from "../src/period-library-controller.js";
import { createPeriodLibraryStorage } from "../src/period-library-storage.js";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { createReportHistoryStorage } from "../src/report-history-storage.js";
import { createVaultController } from "../src/transfer-vault-controller.js";
import { createVaultStorage } from "../src/transfer-vault-storage.js";
import { createStorageGuard } from "../src/storage-guard.js";
import { database, manualTime, microtasks } from "./helpers/storage-guard-fixtures.js";
import { draft } from "./helpers/workspace-fixtures.js";
import { checkpoint } from "./helpers/period-library-fixtures.js";
import { reportInput } from "./helpers/report-history-fixtures.js";
import { bundleFor } from "./helpers/vault-fixtures.js";

const formats = [
  { name: "checkpoint", storage: createCheckpointStorage, controller: createCheckpointController,
    args: () => ({ readDraft: draft, onStage() {}, download() {} }),
    state: c => c.state(), start: c => c.refresh(), stop: c => c.dispose() },
  { name: "encrypted", storage: createEncryptedLibraryStorage, controller: createEncryptedLibraryController,
    args: () => ({}), state: c => c.state(), start: c => c.load(), stop: c => c.cancel() },
  { name: "period", storage: createPeriodLibraryStorage, controller: createPeriodLibraryController,
    args: () => ({ getCheckpoint: () => ({ draft: checkpoint(3), requiresNewPlan: false }), stageCheckpoint() {} }),
    state: c => c.state, start: c => c.refresh(), stop: c => c.cancel() },
  { name: "report", storage: createReportHistoryStorage, controller: createReportHistoryController,
    args: () => ({ getReport: reportInput, stageReport() {} }),
    state: c => c.state, start: c => c.refresh(), stop: c => c.cancel() },
  { name: "vault", storage: createVaultStorage, controller: createVaultController,
    args: () => ({ readCards: bundleFor, stageArchive() {} }),
    state: c => c.state, start: c => c.refresh(), stop: c => c.cancel() },
];

function setup(t, format, options = {}) {
  const f = database();
  const time = manualTime();
  const guard = createStorageGuard();
  const storage = format.storage({ indexedDB: f.factory, guard, deadlineOptions: time.options });
  const states = [];
  const controller = format.controller({ storage, ...format.args(),
    onChange: state => states.push(state), ...options });
  t.after(async () => { controller.dispose(); storage.close(); f.drain(); await microtasks(); });
  return { ...f, controller, storage, guard, time, states };
}

for (const format of formats) {
  test(format.name + ": mounting controller performs no reads or writes", t => {
    const f = setup(t, format);
    assert.equal(f.requests.length, 0);
    assert.equal(f.effects.puts, 0);
    assert.equal(format.state(f.controller).busy, false);
  });

  test(format.name + ": cancel while opening promptly settles the controller", async t => {
    const f = setup(t, format);
    const pending = format.start(f.controller);
    assert.equal(f.requests.length, 1);
    format.stop(f.controller);
    assert.equal(await pending, false);
    assert.equal(f.transactions.length, 0);
    assert.equal(f.guard.state().draining, 1);
    f.succeed();
    await microtasks();
    assert.equal(f.effects.closes, 1);
    assert.equal(f.guard.state().active, 0);
  });

  test(format.name + ": cancel after request creation reaches native abort", async t => {
    const f = setup(t, format);
    const pending = format.start(f.controller);
    f.succeed();
    await microtasks();
    assert.equal(f.transactions.length, 1);
    format.stop(f.controller);
    assert.equal(await pending, false);
    await microtasks();
    assert.equal(f.effects.aborts, 1);
    assert.equal(f.effects.puts, 0);
    assert.equal(f.guard.state().active, 0);
  });

  test(format.name + ": global protection settles active reads without restoring data", async t => {
    const f = setup(t, format);
    const pending = format.start(f.controller);
    f.succeed();
    await microtasks();
    f.guard.cancelAll();
    assert.equal(await pending, false);
    assert.equal(format.state(f.controller).busy, false);
    assert.equal(f.effects.puts, 0);
  });

  test(format.name + ": disposal from initial observer prevents any native operation", async t => {
    let controller;
    const f = setup(t, format, { onChange: state => { if (state.busy) controller.dispose(); } });
    controller = f.controller;
    assert.equal(await format.start(controller), false);
    assert.equal(f.requests.length, 0);
    assert.equal(f.effects.puts, 0);
  });

  test(format.name + ": a throwing view observer cannot strand a storage operation", async t => {
    const f = setup(t, format, { onChange() { throw Error("synthetic view failed"); } });
    const pending = format.start(f.controller);
    f.succeed();
    await microtasks();
    const tx = f.transactions[0];
    tx.read();
    tx.complete();
    assert.equal(await pending, true);
    assert.equal(format.state(f.controller).busy, false);
    assert.equal(f.guard.state().active, 0);
  });

  test(format.name + ": native failure cannot become a success message", async t => {
    const f = setup(t, format);
    const pending = format.start(f.controller);
    f.fail("SecurityError");
    assert.equal(await pending, false);
    assert.equal(format.state(f.controller).busy, false);
    assert.equal(f.guard.state().completed, 0);
  });
}

for (const format of formats.filter(value => value.name !== "checkpoint")) {
  test(format.name + ": cancellation then reload cannot accept the old result", async t => {
    const f = setup(t, format);
    const old = format.start(f.controller);
    f.succeed();
    await microtasks();
    const oldTx = f.transactions[0];
    format.stop(f.controller);
    assert.equal(await old, false);
    await microtasks();
    const fresh = format.start(f.controller);
    await microtasks();
    oldTx.read();
    const nextTx = f.transactions[1];
    assert(nextTx);
    nextTx.read();
    nextTx.complete();
    assert.equal(await fresh, true);
    assert.equal(format.state(f.controller).busy, false);
    assert.equal(f.effects.puts, 0);
  });
}
