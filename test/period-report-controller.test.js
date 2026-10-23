import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodReportController } from "../src/period-report-controller.js";
import { preparePeriodReportFile, decodePeriodReportFile } from "../src/period-report-file.js";
import { reportInput, reportLibrary, selection, id, entry, library, LATER, clone,
  memoryStorage, deferred, fileFrom, tick, code } from "./helpers/period-report-fixtures.js";

function fixture(options = {}) {
  const store = options.store ?? memoryStorage(reportLibrary());
  const notifications = [];
  const controller = createPeriodReportController({ storage: store.storage, now: () => LATER,
    onChange: value => notifications.push(value), ...options.controller });
  return { controller, store, notifications,
    async choose() {
      assert.equal(await controller.refresh(), true);
      for (const [agent, value] of Object.entries(selection())) assert.equal(controller.select(agent, value), true);
    },
    async build() { await this.choose(); assert.equal(controller.prepare("Report"), true); assert.equal(await controller.applyReview(), true); },
  };
}

test("controller construction performs no reads, wallet access or writes", () => {
  const f = fixture();
  assert.deepEqual(f.store.calls, []);
  assert.equal(f.controller.state.loaded, false);
  assert.equal(f.controller.state.report, null);
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.state.busy, false);
  f.controller.dispose();
  assert.deepEqual(f.store.calls, [["close"]]);
});

test("load, select, review, apply are distinct operations", async () => {
  const f = fixture();
  await f.choose();
  assert.equal(f.controller.state.input, null);
  assert.equal(f.controller.prepare("Report"), true);
  assert.equal(f.controller.state.phase, "review");
  assert.equal(f.controller.state.review.report.selectedCount, 3);
  assert.equal(f.controller.state.report, null);
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.controller.state.origin, "library");
  assert.equal(f.controller.state.report.status, "arithmetic-agreement");
  assert.deepEqual(f.store.calls, [["read"], ["read"]]);
  f.controller.dispose();
});

test("loaded sources never write to the library", async () => {
  const f = fixture(), before = clone(f.store.document);
  await f.build();
  const files = [];
  for (const type of ["json", "csv", "html"]) assert.equal(await f.controller.exportFile(type, true, file => files.push(file)), true);
  const json = files.find(file => file.filename.endsWith("json"));
  assert.equal(await f.controller.importFile(fileFrom(json.text)), true);
  assert.equal(await f.controller.applyReview(), true);
  assert.deepEqual(f.store.document, before);
  assert.ok(f.store.calls.every(row => row[0] === "read"));
  f.controller.dispose();
});

test("storage may be a read-only interface without change", async () => {
  let reads = 0;
  const c = createPeriodReportController({ storage: { read: async () => { reads++; return reportLibrary(); }, close() {} } });
  assert.equal(await c.refresh(), true);
  assert.equal(reads, 1);
  c.dispose();
});

test("selection requires a loaded library and correct token", async () => {
  const f = fixture();
  assert.equal(f.controller.select("DAT", id(1)), false);
  assert.equal(f.controller.state.error, "PERIOD_REPORT_NOT_LOADED");
  await f.controller.refresh();
  assert.equal(f.controller.select("DAT", id(2)), false);
  assert.equal(f.controller.state.error, "PERIOD_REPORT_AGENT");
  assert.equal(f.controller.select("DAT", id(99)), false);
  assert.equal(f.controller.state.error, "PERIOD_REPORT_SOURCE_MISSING");
  assert.equal(f.controller.select("DAT", id(1)), true);
  assert.equal(f.controller.select("DAT", null), true);
  assert.equal(f.controller.state.selection.DAT, null);
  f.controller.dispose();
});

test("preparing all empty slots fails without reading storage again", async () => {
  const f = fixture(); await f.controller.refresh();
  assert.equal(f.controller.prepare("Report"), false);
  assert.equal(f.controller.state.error, "PERIOD_REPORT_EMPTY");
  assert.equal(f.store.calls.length, 1);
  f.controller.dispose();
});

test("one selected record is a usable incomplete report", async () => {
  const f = fixture(); await f.controller.refresh(); f.controller.select("DAT", id(1));
  assert.equal(f.controller.prepare("DAT only"), true);
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.controller.state.report.status, "incomplete");
  assert.equal(f.controller.state.report.slots[1].status, "missing");
  f.controller.dispose();
});

test("selection change invalidates prior result and pending review", async () => {
  const f = fixture(); await f.build();
  f.controller.prepare("Next");
  f.controller.select("EMA", null);
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.state.input, null);
  assert.equal(f.controller.state.report, null);
  assert.equal(await f.controller.applyReview(), false);
  f.controller.dispose();
});

test("editing title invalidates review but retains the clearly titled accepted report", async () => {
  const f = fixture(); await f.build();
  f.controller.prepare("Next");
  f.controller.invalidateReview();
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.state.input.title, "Report");
  assert.equal(f.controller.state.report.title, "Report");
  f.controller.dispose();
});

for (const [name, change] of [
  ["renamed", store => store.external({ kind: "rename", id: id(1), label: "New name", time: LATER })],
  ["archived", store => store.external({ kind: "archive", id: id(1), archived: true, time: LATER })],
  ["deleted", store => store.replace(library(store.document.entries.slice(1), 4))],
  ["evidence changed", store => {
    const value = clone(store.document); value.entries[0].draft.later.balanceBaseUnits = "1"; store.replace(value);
  }],
]) {
  test("review detects " + name + " selected source before accepting", async () => {
    const f = fixture(); await f.choose(); f.controller.prepare("Report"); change(f.store);
    assert.equal(await f.controller.applyReview(), false);
    assert.equal(f.controller.state.error, "PERIOD_REPORT_SOURCE_CHANGED");
    assert.equal(f.controller.state.review, null);
    assert.equal(f.controller.state.report, null);
    f.controller.dispose();
  });
}

test("unrelated library update does not reject selected evidence", async () => {
  const f = fixture(); await f.choose(); f.controller.prepare("Report");
  f.store.replace(library([...f.store.document.entries, entry(20)], 4));
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.controller.state.document.revision, 4);
  assert.equal(f.controller.state.report.selectedCount, 3);
  f.controller.dispose();
});

test("refresh clears accepted result and removes deleted selections", async () => {
  const f = fixture(); await f.build();
  f.store.replace(library(f.store.document.entries.slice(1), 4));
  assert.equal(await f.controller.refresh(), true);
  assert.equal(f.controller.state.selection.DAT, null);
  assert.equal(f.controller.state.selection.EMA, id(2));
  assert.equal(f.controller.state.report, null);
  f.controller.dispose();
});

test("already accepted report stays a historical snapshot when library changes later", async () => {
  const f = fixture(); await f.build(); const before = f.controller.state.input;
  f.store.external({ kind: "rename", id: id(1), label: "Renamed later", time: LATER });
  const files = [];
  assert.equal(await f.controller.exportFile("json", true, value => files.push(value)), true);
  assert.deepEqual((await decodePeriodReportFile(files[0].text)).input, before);
  assert.equal(f.store.calls.filter(row => row[0] === "read").length, 2);
  f.controller.dispose();
});

test("JSON import works without IndexedDB and does not touch the library", async () => {
  let calls = 0;
  const c = createPeriodReportController({ storage: { read: async () => { calls++; throw Error("Unavailable"); }, close() {} } });
  const file = await preparePeriodReportFile(reportInput());
  assert.equal(await c.importFile(fileFrom(file.text)), true);
  assert.equal(c.state.review.checksumVerified, true);
  assert.equal(c.state.review.authenticated, false);
  assert.equal(c.state.report, null);
  assert.equal(await c.applyReview(), true);
  assert.equal(c.state.origin, "file");
  assert.equal(c.state.loaded, false);
  assert.equal(calls, 0);
  c.dispose();
});

test("imported report remains pending until explicit apply", async () => {
  const f = fixture(); await f.build();
  const file = await preparePeriodReportFile(reportInput({ title: "Imported title", counts: [3, 5, 5] }));
  await f.controller.importFile(fileFrom(file.text));
  assert.equal(f.controller.state.input.title, "Report");
  assert.equal(f.controller.state.review.input.title, "Imported title");
  await f.controller.applyReview();
  assert.equal(f.controller.state.input.title, "Imported title");
  assert.equal(f.controller.state.report.status, "incomplete");
  f.controller.dispose();
});

test("bad import does not erase accepted report", async () => {
  const f = fixture(); await f.build(); const before = f.controller.state.input;
  assert.equal(await f.controller.importFile(fileFrom("bad")), false);
  assert.deepEqual(f.controller.state.input, before);
  assert.equal(f.controller.state.review, null);
  f.controller.dispose();
});

test("file acceptance realigns selectors only to exact records in the loaded library", async () => {
  const f = fixture(); await f.build();
  f.controller.select("DAT", null);
  const original = await preparePeriodReportFile(reportInput());
  await f.controller.importFile(fileFrom(original.text)); await f.controller.applyReview();
  assert.deepEqual(f.controller.state.selection, selection());
  const altered = clone(reportInput()); altered.slots[1].entry.label = "Only in the file";
  await f.controller.importFile(fileFrom((await preparePeriodReportFile(altered)).text));
  await f.controller.applyReview();
  assert.equal(f.controller.state.selection.EMA, null);
  assert.equal(f.controller.state.selection.DAT, id(1));
  assert.equal(f.controller.state.input.slots[1].entry.label, "Only in the file");
  assert.equal(f.store.document.entries[1].label, "EMA 期間30–42");
  f.controller.dispose();
});

test("cancelled import cannot create a late review", async () => {
  const delay = deferred();
  const f = fixture({ controller: { readFile: () => delay.promise } });
  const work = f.controller.importFile({});
  assert.equal(f.controller.state.busy, true);
  f.controller.cancel(); delay.resolve({ input: reportInput(), checksumVerified: true });
  assert.equal(await work, false);
  assert.equal(f.controller.state.review, null);
  assert.equal(f.controller.state.phase, "idle");
  f.controller.dispose();
});

test("cancelled read cannot replace a later successful refresh", async () => {
  const first = deferred(); let reads = 0;
  const f = fixture({ controller: { storage: { read: async () => ++reads === 1 ? first.promise : reportLibrary(), close() {} } } });
  const stale = f.controller.refresh(); f.controller.cancel();
  assert.equal(await f.controller.refresh(), true);
  first.resolve(library([]));
  assert.equal(await stale, false);
  assert.equal(f.controller.state.document.entries.length, 3);
  f.controller.dispose();
});

test("cancel during fresh source validation does not accept the reviewed report", async () => {
  const delay = deferred(); let reads = 0;
  const store = memoryStorage(reportLibrary(), { beforeRead: () => ++reads === 2 ? delay.promise : undefined });
  const f = fixture({ store }); await f.choose(); f.controller.prepare("Report");
  const pending = f.controller.applyReview(); await tick();
  assert.equal(f.controller.state.phase, "checking");
  f.controller.cancel(); delay.resolve();
  assert.equal(await pending, false);
  assert.equal(f.controller.state.report, null);
  f.controller.dispose();
});

test("failed fresh read preserves original records and surfaces safe error", async () => {
  let reads = 0;
  const store = memoryStorage(reportLibrary(), { beforeRead: () => { if (++reads === 2) throw Error("secret text"); } });
  const f = fixture({ store }); await f.choose(); f.controller.prepare("Report");
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "PERIOD_REPORT_FAILED");
  assert.equal(f.controller.state.report, null);
  assert.equal(f.store.document.entries.length, 3);
  f.controller.dispose();
});

test("busy operation prevents conflicting selection or preparation", async () => {
  const gate = deferred();
  const f = fixture({ controller: { readFile: () => gate.promise } });
  await f.build(); const original = f.controller.state.input;
  const pending = f.controller.importFile({});
  assert.equal(f.controller.select("EMA", null), false);
  assert.equal(f.controller.prepare("New"), false);
  assert.equal(f.controller.state.busy, true);
  assert.equal(f.controller.state.input, original);
  gate.resolve({ input: reportInput() }); await pending;
  f.controller.dispose();
});

for (const format of ["json", "csv", "html"]) {
  test("export " + format + " requires exact acknowledgement", async () => {
    const f = fixture(); await f.build(); let delivered = 0;
    for (const ack of [false, undefined, 1, "true"]) {
      assert.equal(await f.controller.exportFile(format, ack, () => delivered++), false);
      assert.equal(f.controller.state.error, "PERIOD_REPORT_ACK");
    }
    assert.equal(delivered, 0);
    assert.equal(await f.controller.exportFile(format, true, file => { delivered++; assert.ok(file.text.length > 0); }), true);
    assert.equal(delivered, 1);
    f.controller.dispose();
  });
}

test("export requires accepted input and valid format", async () => {
  const f = fixture();
  assert.equal(await f.controller.exportFile("json", true, () => {}), false);
  assert.equal(f.controller.state.error, "PERIOD_REPORT_NO_RESULT");
  await f.build();
  assert.equal(await f.controller.exportFile("exe", true, () => {}), false);
  assert.equal(f.controller.state.error, "PERIOD_REPORT_FORMAT");
  assert.equal(await f.controller.exportFile("json", true, null), false);
  assert.equal(f.controller.state.error, "PERIOD_REPORT_DELIVERY");
  f.controller.dispose();
});

test("cancel during asynchronous checksum never initiates download", async () => {
  const gate = deferred(), f = fixture({ controller: { prepareFile: () => gate.promise } });
  await f.build(); let calls = 0;
  const pending = f.controller.exportFile("json", true, () => calls++);
  f.controller.cancel(); gate.resolve({ text: "late" });
  assert.equal(await pending, false);
  assert.equal(calls, 0);
  assert.equal(f.controller.state.report.status, "arithmetic-agreement");
  f.controller.dispose();
});

for (const [name, deliver] of [
  ["throw", () => { throw Error("download location"); }],
  ["explicit failure", () => false],
  ["async rejection", () => Promise.reject(Error("late error"))],
  ["async resolution", () => Promise.resolve(true)],
]) {
  test("failed delivery " + name + " does not claim download success", async () => {
    const f = fixture(); await f.build();
    assert.equal(await f.controller.exportFile("json", true, deliver), false);
    assert.ok(f.controller.state.error);
    assert.equal(f.controller.state.report.status, "arithmetic-agreement");
    await tick(); f.controller.dispose();
  });
}

test("export clears an older pending import review without accepting it", async () => {
  const f = fixture(); await f.build();
  const file = await preparePeriodReportFile(reportInput({ title: "Other" }));
  await f.controller.importFile(fileFrom(file.text));
  assert.ok(f.controller.state.review);
  const downloaded = [];
  await f.controller.exportFile("json", true, value => downloaded.push(value));
  assert.equal(f.controller.state.review, null);
  assert.equal(JSON.parse(downloaded[0].text).input.title, "Report");
  f.controller.dispose();
});

test("failed observer callbacks do not alter results or create unhandled rejections", async () => {
  const f = fixture({ controller: { onChange: () => Promise.reject(Error("observer")) } });
  await f.build(); await tick();
  assert.equal(f.controller.state.report.status, "arithmetic-agreement");
  f.controller.dispose();
  const second = fixture({ controller: { onChange: () => { throw Error("sync observer"); } } });
  await second.build();
  assert.equal(second.controller.state.report.status, "arithmetic-agreement");
  second.controller.dispose();
});

test("observer cancellation before async operation prevents even a database read", async () => {
  let c;
  const store = memoryStorage(reportLibrary());
  c = createPeriodReportController({ storage: store.storage, onChange: state => { if (state.busy) c.cancel(); } });
  assert.equal(await c.refresh(), false);
  assert.deepEqual(store.calls, []);
  c.dispose();
});

test("dispose cancels pending work and all later public operations are inert", async () => {
  const delay = deferred(), f = fixture({ controller: { readFile: () => delay.promise } });
  const pending = f.controller.importFile({}); f.controller.dispose(); f.controller.dispose();
  const count = f.notifications.length;
  delay.resolve({ input: reportInput() });
  assert.equal(await pending, false);
  assert.equal(await f.controller.refresh(), false);
  assert.equal(f.controller.select("DAT", id(1)), false);
  assert.equal(f.controller.prepare("Report"), false);
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(await f.controller.exportFile("json", true, () => assert.fail()), false);
  f.controller.cancel(); f.controller.invalidateReview();
  assert.equal(f.notifications.length, count);
  assert.deepEqual(f.store.calls, [["close"]]);
});

test("invalid dependencies fail immediately", () => {
  for (const options of [{}, { storage: {} }, { storage: { read() {}, close() {} }, now: null },
    { storage: { read() {}, close() {} }, onChange: null }]) {
    assert.throws(() => createPeriodReportController(options), code("PERIOD_REPORT_OPTIONS"));
  }
});

test("invalid clock cannot produce a report", async () => {
  const f = fixture({ controller: { now: () => "not a date" } }); await f.choose();
  assert.equal(f.controller.prepare("Report"), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_TIME");
  assert.equal(f.controller.state.review, null);
  f.controller.dispose();
});
