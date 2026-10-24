import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodReportController } from "../src/period-report-controller.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { createPeriodLibraryStorage } from "../src/period-library-storage.js";
import { createReportHistoryStorage } from "../src/report-history-storage.js";
import { createStorageGuard } from "../src/storage-guard.js";
import { database, manualTime, microtasks } from "./helpers/storage-guard-fixtures.js";
import { reportLibrary, reportInput, selection, LATER } from "./helpers/period-report-fixtures.js";
import { sequenceHistory, sequenceSet, AFTER } from "./helpers/report-set-fixtures.js";

const formats = [
  { name: "period-report", controller: createPeriodReportController, storage: createPeriodLibraryStorage,
    document: reportLibrary, now: () => LATER, decoded: () => ({ input: reportInput(), checksumVerified: true }),
    select(c) { for (const [agent, id] of Object.entries(selection())) assert(c.select(agent, id)); },
    flows: ["refresh", "applyReview"] },
  { name: "report-set", controller: createReportSetController, storage: createReportHistoryStorage,
    document: sequenceHistory, now: () => AFTER, decoded: () => ({ input: sequenceSet(), checksumVerified: true }),
    select(c) { assert(c.select(c.state.document.entries.map(entry => entry.id))); },
    flows: ["refresh", "applyReview", "inspectSources"] },
];

function setup(t, format, options = {}) {
  const initial = format.document();
  const f = database(initial);
  const time = manualTime();
  const guard = createStorageGuard();
  const storage = format.storage({ indexedDB: f.factory, guard, deadlineOptions: time.options });
  const controller = format.controller({ storage, now: format.now, ...options });
  t.after(async () => { controller.dispose(); storage.close(); f.drain(); await microtasks(); });
  async function complete(pending) {
    if (f.requests.at(-1)?.result === null) f.succeed();
    await microtasks();
    const tx = f.transactions.at(-1);
    tx.read();
    tx.complete();
    assert.equal(await pending, true);
  }
  async function prepare(flow) {
    if (flow === "refresh") return;
    await complete(controller.refresh());
    format.select(controller);
    assert(controller.prepare("Synthetic local security review"));
    if (flow === "inspectSources") await complete(controller.applyReview());
  }
  return { ...f, initial, time, guard, storage, controller, complete, prepare };
}

for (const format of formats) {
  test(format.name + " construction remains lazy and has no storage mutation capability", t => {
    const f = setup(t, format);
    assert.equal(f.requests.length, 0);
    assert.equal(f.effects.puts, 0);
    assert.equal(f.controller.state.busy, false);
  });

  for (const flow of format.flows) {
    test(`${format.name} ${flow}: normal read completes with no write and no retained slot`, async t => {
      const f = setup(t, format);
      await f.prepare(flow);
      await f.complete(f.controller[flow]());
      assert.equal(f.effects.puts, 0);
      assert.equal(f.controller.state.busy, false);
      assert.equal(f.guard.state().active, 0);
      assert.deepEqual(f.current(), f.initial);
    });

    for (const action of ["cancel", "dispose", "global-stop"]) {
      test(`${format.name} ${flow}: ${action} aborts the active read before stale adoption`, async t => {
        const f = setup(t, format);
        await f.prepare(flow);
        const oldResult = f.controller.state.input;
        const pending = f.controller[flow]();
        if (f.requests.at(-1)?.result === null) f.succeed();
        await microtasks();
        const tx = f.transactions.at(-1);
        const aborts = f.effects.aborts;
        if (action === "global-stop") f.guard.cancelAll();
        else f.controller[action]();
        assert.equal(await pending, false);
        await microtasks();
        assert.equal(f.effects.aborts, aborts + 1);
        tx.read();
        tx.complete({ force: true });
        assert.equal(f.effects.puts, 0);
        assert.equal(f.guard.state().active, 0);
        assert.deepEqual(f.current(), f.initial);
        if (flow === "inspectSources") assert.equal(f.controller.state.input, oldResult);
      });
    }

    test(`${format.name} ${flow}: deadline rejects read and preserves durable evidence`, async t => {
      const f = setup(t, format);
      await f.prepare(flow);
      const pending = f.controller[flow]();
      if (f.requests.at(-1)?.result === null) f.succeed();
      await microtasks();
      f.time.advance(30000);
      f.time.flush();
      assert.equal(await pending, false);
      await microtasks();
      assert.equal(f.controller.state.busy, false);
      assert.equal(f.effects.puts, 0);
      assert.equal(f.guard.state().timedOut, 1);
      assert.deepEqual(f.current(), f.initial);
    });

    test(`${format.name} ${flow}: cancel from the view observer prevents storage dispatch`, async t => {
      let cancel = false, c;
      const f = setup(t, format, { onChange(value) { if (cancel && value.busy) c.cancel(); } });
      c = f.controller;
      await f.prepare(flow);
      const transactions = f.transactions.length;
      const requests = f.requests.length;
      cancel = true;
      assert.equal(await c[flow](), false);
      assert.equal(f.transactions.length, transactions);
      assert.equal(f.requests.length, requests);
      assert.equal(f.guard.state().active, 0);
      assert.equal(c.state.busy, false);
    });
  }

  test(format.name + " cancellation before native open completion settles immediately", async t => {
    const f = setup(t, format);
    const pending = f.controller.refresh();
    f.controller.cancel();
    assert.equal(await pending, false);
    assert.equal(f.guard.state().draining, 1);
    f.succeed();
    await microtasks();
    assert.equal(f.guard.state().active, 0);
    assert.equal(f.controller.state.loaded, false);
    assert.equal(f.transactions.length, 0);
  });

  test(format.name + " new refresh survives terminal callback from old cancelled refresh", async t => {
    const f = setup(t, format);
    const first = f.controller.refresh();
    f.succeed();
    await microtasks();
    const oldTx = f.transactions[0];
    f.controller.cancel();
    assert.equal(await first, false);
    await microtasks();
    const fresh = f.controller.refresh();
    await microtasks();
    oldTx.abortEvent();
    oldTx.read();
    assert.equal(f.controller.state.busy, true);
    await f.complete(fresh);
    assert.equal(f.controller.state.loaded, true);
    assert.equal(f.guard.state().completed, 1);
  });

  test(format.name + " file reader receives an AbortSignal and cancellation reaches the reader", async t => {
    let signal, aborted = 0;
    const f = setup(t, format, { readFile(_file, options) {
      signal = options.signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { aborted++; reject(Error("synthetic abort")); }, { once: true });
      });
    } });
    const pending = f.controller.importFile({ name: "synthetic.json" });
    assert(signal instanceof AbortSignal);
    f.controller.cancel();
    assert.equal(await pending, false);
    assert.equal(aborted, 1);
    assert.equal(f.controller.state.review, null);
    assert.equal(f.requests.length, 0);
  });

  test(format.name + " file reader ignoring cancellation cannot publish its late review", async t => {
    let resolve;
    const f = setup(t, format, { readFile() { return new Promise(yes => { resolve = yes; }); } });
    const pending = f.controller.importFile({ name: "synthetic.json" });
    f.controller.cancel();
    resolve(format.decoded());
    assert.equal(await pending, false);
    assert.equal(f.controller.state.review, null);
    assert.equal(f.controller.state.input, null);
  });

  test(format.name + " disposal aborts an active file read once and leaves no adopted result", async t => {
    let aborted = 0, signal;
    const f = setup(t, format, { readFile(_file, options) {
      signal = options.signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => {
        aborted++; reject(Error("abort"));
      }, { once: true }));
    } });
    const pending = f.controller.importFile({});
    f.controller.dispose();
    f.controller.dispose();
    assert.equal(await pending, false);
    assert.equal(aborted, 1);
    assert.equal(signal.aborted, true);
    assert.equal(f.controller.state.disposed, true);
  });

  test(format.name + " completed file work does not receive a later unrelated cancellation", async t => {
    let signal;
    const f = setup(t, format, { readFile: async (_file, options) => {
      signal = options.signal;
      return format.decoded();
    } });
    assert.equal(await f.controller.importFile({}), true);
    f.controller.cancel();
    assert.equal(signal.aborted, false);
    assert.equal(f.controller.state.review, null);
  });
}
