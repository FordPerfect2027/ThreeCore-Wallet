import test from "node:test";
import assert from "node:assert/strict";
import { createReportSetController } from "../src/report-set-controller.js";
import { prepareReportSetFile, decodeReportSetFile } from "../src/report-set-file.js";
import { sequenceHistory, sequenceSet, historyMemory, historyDocument,
  historyRecord, id, AFTER, clone, deferred, fileFrom, tick } from "./helpers/report-set-fixtures.js";

function fixture({ initial = sequenceHistory(), hooks = {}, ...options } = {}) {
  const store = historyMemory(initial, hooks), updates = [], files = [];
  const controller = createReportSetController({ storage: store.storage,
    now: () => AFTER, onChange: state => updates.push(state), ...options });
  const f = { store, controller, updates, files,
    async load() { assert.equal(await controller.refresh(), true); },
    select(ids = store.document.entries.map(entry => entry.id)) {
      assert.equal(controller.select(ids), true);
    },
    prepare(title = "定期確認") { assert.equal(controller.prepare(title), true); },
    async accept() {
      await f.load(); f.select(); f.prepare();
      assert.equal(await controller.applyReview(), true);
    },
    async save(format = "json", options = {}) {
      return controller.exportFile(format, true, file => files.push(file), options);
    },
    dispose() { controller.dispose(); },
  };
  return f;
}

test("report set controller is lazy and never asks storage to mutate", async () => {
  const f = fixture();
  assert.deepEqual(f.store.calls, []);
  assert.equal(f.controller.state.loaded, false);
  await f.accept();
  await f.controller.inspectSources();
  await f.save();
  assert.ok(f.store.calls.every(call => call[0] === "read"));
  assert.deepEqual(f.store.document, sequenceHistory());
  f.dispose();
  assert.equal(f.store.closed, true);
});

for (const key of ["onChange", "now", "readFile", "prepareFile"]) {
  test("invalid set controller dependency rejects " + key, () => {
    assert.throws(() => fixture({ [key]: null }));
  });
}

test("read-only storage without any change method is sufficient", async () => {
  const controller = createReportSetController({ storage: {
    read: async () => sequenceHistory(), close() {},
  }, now: () => AFTER });
  assert.equal(await controller.refresh(), true);
  controller.select([id(101), id(102)]);
  assert.equal(controller.prepare("read only"), true);
  assert.equal(await controller.applyReview(), true);
  assert.equal(controller.state.result.allContinuous, true);
  controller.dispose();
});

test("selection and preparation require an explicitly loaded history", () => {
  const f = fixture();
  assert.equal(f.controller.select([id(101)]), false);
  assert.equal(f.controller.state.error, "PERIOD_SET_NOT_LOADED");
  assert.equal(f.controller.prepare("review"), false);
  assert.equal(f.controller.state.error, "PERIOD_SET_NOT_LOADED");
  assert.deepEqual(f.store.calls, []);
  f.dispose();
});

test("empty selection can be edited but cannot create an accepted result", async () => {
  const f = fixture(); await f.load();
  assert.equal(f.controller.select([]), true);
  assert.equal(f.controller.prepare("empty"), false);
  assert.equal(f.controller.state.error, "PERIOD_SET_EMPTY");
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.state.result, null);
  f.dispose();
});

test("a selection containing an unknown ID does not replace existing selection", async () => {
  const f = fixture(); await f.load(); f.select([id(101)]);
  assert.equal(f.controller.select([id(999)]), false);
  assert.deepEqual(f.controller.state.selection, [id(101)]);
  assert.equal(f.controller.state.error, "PERIOD_SET_SOURCE_MISSING");
  f.dispose();
});

test("preparation is a review only and application rereads selected sources", async () => {
  const f = fixture(); await f.load(); f.select(); f.prepare();
  assert.equal(f.controller.state.phase, "review");
  assert.equal(f.controller.state.result, null);
  assert.equal(f.store.calls.length, 1);
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.store.calls.length, 2);
  assert.equal(f.controller.state.origin, "history");
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.state.result.reportCount, 3);
  f.dispose();
});

for (const change of [
  value => { value.entries[0].label = "updated label"; },
  value => { value.entries[0].note = "updated note"; },
  value => { value.entries[0].archived = true; },
  value => { value.entries[0].report.title = "updated evidence"; },
  value => { value.entries.shift(); },
]) {
  test("selected source change after review blocks acceptance: " + change.toString(), async () => {
    const f = fixture(); await f.accept();
    const accepted = f.controller.state.input;
    f.prepare("next review");
    const changed = clone(f.store.document); change(changed); changed.revision++;
    f.store.replace(changed);
    assert.equal(await f.controller.applyReview(), false);
    assert.equal(f.controller.state.error, "PERIOD_SET_SOURCE_CHANGED");
    assert.equal(f.controller.state.input, accepted);
    assert.equal(f.controller.state.review, null);
    assert.deepEqual(f.store.document, changed);
    f.dispose();
  });
}

test("an unrelated source addition does not invalidate selected evidence", async () => {
  const f = fixture(); await f.load(); f.select([id(101), id(102)]); f.prepare();
  const changed = clone(f.store.document);
  changed.entries.push(historyRecord(8)); changed.revision++;
  f.store.replace(changed);
  assert.equal(await f.controller.applyReview(), true);
  assert.deepEqual(f.controller.state.input.entries.map(entry => entry.id), [id(101), id(102)]);
  assert.equal(f.controller.state.document.entries.length, 4);
  // Snapshot revision is the original observation, not a write lock for the current database.
  assert.equal(f.controller.state.input.sourceRevision, 3);
  f.dispose();
});

test("changing selection invalidates review but leaves an already displayed set frozen", async () => {
  const f = fixture(); await f.accept();
  const accepted = f.controller.state.input;
  f.prepare("pending"); f.select([id(101)]);
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.state.input, accepted);
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "PERIOD_SET_NO_REVIEW");
  f.dispose();
});

test("title editing invalidates only the staged review", async () => {
  const f = fixture(); await f.accept(); f.prepare("pending");
  f.controller.invalidateReview();
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.state.input.title, "定期確認");
  f.dispose();
});

test("refresh filters deleted selections and inspects but never rewrites the accepted set", async () => {
  const f = fixture(); await f.accept();
  const accepted = f.controller.state.input;
  const changed = clone(f.store.document); changed.entries.shift(); changed.revision++;
  f.store.replace(changed); await f.load();
  assert.deepEqual(f.controller.state.selection, [id(102), id(103)]);
  assert.equal(f.controller.state.input, accepted);
  assert.equal(f.controller.state.inspection.rows[0].status, "missing");
  f.dispose();
});

test("source inspection identifies metadata changes without adopting them", async () => {
  const f = fixture(); await f.accept();
  const accepted = f.controller.state.input;
  const changed = clone(f.store.document); changed.entries[1].note = "later note";
  f.store.replace(changed);
  assert.equal(await f.controller.inspectSources(), true);
  assert.equal(f.controller.state.inspection.rows[1].status, "metadata");
  assert.equal(f.controller.state.input, accepted);
  assert.equal(f.controller.state.input.entries[1].note, "確認用メモ 2");
  f.dispose();
});

test("JSON can be imported before the local history is opened", async () => {
  const f = fixture({ initial: historyDocument() });
  const file = await prepareReportSetFile(sequenceSet());
  assert.equal(await f.controller.importFile(fileFrom(file.text)), true);
  assert.equal(f.controller.state.result, null);
  assert.equal(f.controller.state.review.checksumVerified, true);
  assert.equal(f.controller.state.review.origin, "file");
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.controller.state.origin, "file");
  assert.equal(f.controller.state.loaded, false);
  assert.deepEqual(f.store.calls, []);
  assert.equal(f.store.document.entries.length, 0);
  f.dispose();
});

test("bad JSON import preserves a previous accepted result and cannot be applied", async () => {
  const f = fixture(); await f.accept();
  const previous = f.controller.state.result;
  assert.equal(await f.controller.importFile(fileFrom("{")), false);
  assert.equal(f.controller.state.result, previous);
  assert.equal(f.controller.state.review, null);
  assert.equal(await f.controller.applyReview(), false);
  f.dispose();
});

test("imported analysis supplied by an adapter is ignored and recomputed", async () => {
  const incomplete = sequenceSet(sequenceHistory([0n, 24n]));
  const f = fixture({ readFile: async () => ({ input: incomplete, checksumVerified: true,
    result: { allContinuous: true } }) });
  assert.equal(await f.controller.importFile({}), true);
  assert.equal(f.controller.state.review.result.allContinuous, false);
  assert.ok(f.controller.state.review.result.issues.includes("GAPS"));
  f.dispose();
});

test("export requires an accepted set, acknowledgement and supported format", async () => {
  const f = fixture();
  assert.equal(await f.save(), false);
  assert.equal(f.controller.state.error, "PERIOD_SET_NO_RESULT");
  await f.accept();
  assert.equal(await f.controller.exportFile("json", false, () => {}), false);
  assert.equal(f.controller.state.error, "PERIOD_SET_ACK");
  assert.equal(await f.controller.exportFile("xml", true, () => {}), false);
  assert.equal(f.controller.state.error, "PERIOD_SET_FORMAT");
  assert.equal(await f.controller.exportFile("json", true, null), false);
  assert.equal(f.files.length, 0);
  f.dispose();
});

for (const format of ["json", "html", "csv"]) {
  test("export " + format + " uses captured evidence even after the history changes", async () => {
    const f = fixture(); await f.accept();
    const accepted = f.controller.state.input;
    const changed = clone(f.store.document); changed.entries[0].label = "later label";
    f.store.replace(changed);
    assert.equal(await f.save(format, { includeNotes: true, shortAddresses: false }), true);
    assert.equal(f.files.length, 1);
    assert.ok(!f.files[0].text.includes("later label"));
    assert.ok(f.files[0].text.includes("確認用メモ 1"));
    assert.equal(f.controller.state.input, accepted);
    if (format === "json") {
      assert.deepEqual((await decodeReportSetFile(f.files[0].text)).input, accepted);
    }
    f.dispose();
  });
}

test("delivery exceptions report failure and keep evidence available for retry", async () => {
  const f = fixture(); await f.accept();
  const before = f.controller.state.input;
  assert.equal(await f.controller.exportFile("html", true, () => { throw Error("private failure"); }), false);
  assert.equal(f.controller.state.error, "PERIOD_SET_FAILED");
  assert.equal(f.controller.state.input, before);
  assert.equal(await f.save("html"), true);
  f.dispose();
});

test("asynchronous delivery cannot be reported as a completed download", async () => {
  const f = fixture(); await f.accept();
  assert.equal(await f.controller.exportFile("csv", true, async () => {}), false);
  assert.equal(f.controller.state.error, "PERIOD_ASYNC_DELIVERY");
  f.dispose();
});

for (const operation of ["refresh", "apply", "inspect", "import", "export"]) {
  for (const ending of ["cancel", "dispose"]) {
    test("late " + operation + " completion is ignored after " + ending, async () => {
      const gate = deferred(); let block = false;
      const f = fixture({ hooks: { beforeRead: () => block ? gate.promise : undefined },
        readFile: async () => { await gate.promise; return { input: sequenceSet(), checksumVerified: true }; },
        prepareFile: async input => { await gate.promise; return prepareReportSetFile(input); },
      });
      await f.accept();
      const accepted = f.controller.state.input;
      if (operation === "apply") f.prepare("pending");
      block = true;
      const pending = operation === "refresh" ? f.controller.refresh() :
        operation === "apply" ? f.controller.applyReview() :
        operation === "inspect" ? f.controller.inspectSources() :
        operation === "import" ? f.controller.importFile({}) : f.save();
      assert.equal(f.controller.state.busy, true);
      f.controller[ending]();
      gate.resolve();
      assert.equal(await pending, false);
      assert.equal(f.controller.state.input, accepted);
      assert.equal(f.files.length, 0);
      assert.equal(f.controller.state.review, null);
      assert.ok(!f.store.calls.some(call => call[0] === "change"));
      f.dispose();
    });
  }
}

test("busy operations refuse reentry without canceling the original request", async () => {
  const gate = deferred();
  const f = fixture({ hooks: { beforeRead: () => gate.promise } });
  const pending = f.controller.refresh();
  assert.equal(await f.controller.refresh(), false);
  assert.equal(f.controller.select([id(101)]), false);
  assert.equal(f.controller.state.error, "PERIOD_SET_BUSY");
  assert.equal(f.controller.state.busy, true);
  gate.resolve(); assert.equal(await pending, true);
  assert.equal(f.controller.state.loaded, true);
  f.dispose();
});

test("a read error is retryable and does not modify the source history", async () => {
  let fail = true;
  const f = fixture({ hooks: { beforeRead: () => { if (fail) throw Error("offline"); } } });
  assert.equal(await f.controller.refresh(), false);
  assert.equal(f.controller.state.loaded, false);
  assert.equal(f.controller.state.error, "PERIOD_SET_FAILED");
  fail = false; await f.accept();
  assert.equal(f.controller.state.result.allContinuous, true);
  f.dispose();
});

test("observer exceptions do not interrupt evidence validation", async () => {
  const f = fixture({ onChange() { throw Error("UI observer"); } });
  await f.accept();
  assert.equal(f.controller.state.result.allContinuous, true);
  f.dispose();
});

test("observer rejected promises are handled", async () => {
  const f = fixture({ onChange: async () => { throw Error("UI observer"); } });
  await f.accept(); await tick();
  assert.equal(f.controller.state.result.allContinuous, true);
  f.dispose();
});

test("disposing twice closes the storage once and disables all later work", async () => {
  const f = fixture(); await f.accept(); f.dispose(); f.dispose();
  const count = f.store.calls.length;
  assert.equal(await f.controller.refresh(), false);
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(await f.controller.importFile({}), false);
  assert.equal(await f.save(), false);
  assert.equal(f.store.calls.length, count);
  assert.equal(f.store.calls.filter(call => call[0] === "close").length, 1);
});
