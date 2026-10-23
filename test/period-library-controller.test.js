import test from "node:test";
import assert from "node:assert/strict";
import { createPeriodLibraryController } from "../src/period-library-controller.js";
import { preparePeriodLibraryFile, decodePeriodLibraryFile } from "../src/period-library-file.js";
import {
  memoryStorage, sampleLibrary, library, entry, saveOperation, checkpoint,
  id, TIME, LATER, clone, deferred, tick, fileFrom,
} from "./helpers/period-library-fixtures.js";

function fixture(options = {}) {
  const store = options.store ?? memoryStorage(options.document);
  let current = { draft: checkpoint(3), requiresNewPlan: false };
  const deliveries = [], changes = [], files = [];
  let number = 10;
  const controller = createPeriodLibraryController({
    storage: store.storage,
    getCheckpoint: () => current,
    stageCheckpoint: (draft, metadata) => { deliveries.push({ draft, metadata }); return true; },
    onChange: value => changes.push(value),
    now: () => LATER,
    createId: () => id(++number),
    ...options.controller,
  });
  return { store, controller, deliveries, changes, files,
    source(value) { current = value; },
    download(value) { files.push(value); },
  };
}

async function loaded(options) {
  const f = fixture(options);
  assert.equal(await f.controller.refresh(), true);
  return f;
}

test("construction and state inspection do not access browser storage", () => {
  const f = fixture();
  assert.equal(f.store.calls.length, 0);
  assert.equal(f.controller.state.loaded, false);
  assert.equal(f.controller.state.document.entries.length, 0);
  assert.equal(f.controller.state.busy, false);
  f.controller.dispose();
});

test("save cannot proceed before an explicit library read", () => {
  const f = fixture();
  assert.equal(f.controller.prepareSave("Test"), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_NOT_LOADED");
  assert.equal(f.store.calls.length, 0);
});

test("opening storage does not acquire wallet state or stage a restore", async () => {
  let sourceReads = 0;
  const f = await loaded({ document: sampleLibrary(), controller: {
    getCheckpoint() { sourceReads++; throw Error("No wallet"); },
  } });
  assert.equal(f.controller.state.document.entries.length, 4);
  assert.equal(sourceReads, 0);
  assert.equal(f.deliveries.length, 0);
  assert.deepEqual(f.store.calls, [["read"]]);
});

test("save is reviewed before the committed write and selects the saved item", async () => {
  const f = await loaded();
  assert.equal(f.controller.prepareSave("DAT morning"), true);
  assert.equal(f.controller.state.phase, "review");
  assert.equal(f.controller.state.review.kind, "save");
  assert.equal(f.store.document.entries.length, 0);
  assert.equal(f.store.calls.length, 1);
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.store.document.entries.length, 1);
  assert.equal(f.controller.state.selectedId, id(11));
  assert.equal(f.controller.state.review, null);
  assert.equal(f.store.document.entries[0].label, "DAT morning");
  assert.equal(f.controller.state.phase, "ready");
});

test("changing current evidence after review prevents saving an unintended version", async () => {
  const f = await loaded();
  f.controller.prepareSave("Before");
  f.source({ draft: checkpoint(4), requiresNewPlan: false });
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_SOURCE_CHANGED");
  assert.equal(f.store.document.entries.length, 0);
});

test("changing quarantine state after review invalidates the save", async () => {
  const f = await loaded();
  f.controller.prepareSave("Before");
  f.source({ draft: checkpoint(3), requiresNewPlan: true });
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_SOURCE_CHANGED");
  assert.equal(f.store.document.revision, 0);
});

test("a missing current checkpoint produces a useful error instead of an empty save", async () => {
  const f = await loaded();
  f.source(null);
  assert.equal(f.controller.prepareSave("Missing"), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_NO_SOURCE");
});

test("selection only changes UI state and does not read or write storage", async () => {
  const f = await loaded({ document: sampleLibrary() });
  const calls = f.store.calls.length;
  assert.equal(f.controller.select(id(2)), true);
  assert.equal(f.controller.state.selectedId, id(2));
  assert.equal(f.store.calls.length, calls);
  assert.equal(f.controller.select(null), true);
  assert.equal(f.controller.state.selectedId, null);
});

test("selecting an absent ID leaves the prior selection intact", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(1));
  assert.equal(f.controller.select(id(99)), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_NOT_FOUND");
  assert.equal(f.controller.state.selectedId, id(1));
});

test("restoring uses a fresh read and stages a candidate rather than starting RPC", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(2));
  assert.equal(f.controller.prepareRestore(), true);
  assert.equal(f.deliveries.length, 0);
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.store.calls.filter(call => call[0] === "read").length, 2);
  assert.equal(f.store.calls.filter(call => call[0] === "change").length, 0);
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.deliveries[0].draft.plan.context.agent, "EMA");
  assert.deepEqual(f.deliveries[0].metadata, { requiresNewPlan: false });
});

test("quarantine marker survives the restore bridge", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(3));
  f.controller.prepareRestore();
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.deliveries[0].metadata.requiresNewPlan, true);
});

test("restoring a previously archived checkpoint still requires review", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(4));
  assert.equal(f.deliveries.length, 0);
  f.controller.prepareRestore();
  assert.equal(f.controller.state.review.entry.archived, true);
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.deliveries[0].draft.earlier.blockNumber, "30");
});

for (const operation of [
  { kind: "rename", id: id(1), label: "Changed elsewhere", time: LATER },
  { kind: "archive", id: id(1), archived: true, time: LATER },
]) {
  test("a changed selected record cannot be restored from a stale preview: " + operation.kind, async () => {
    const f = await loaded({ document: sampleLibrary() });
    f.controller.select(id(1));
    f.controller.prepareRestore();
    f.store.external(operation);
    assert.equal(await f.controller.applyReview(), false);
    assert.equal(f.controller.state.error, "PERIOD_LIBRARY_STALE");
    assert.equal(f.deliveries.length, 0);
  });
}

test("unrelated concurrent metadata changes do not prevent a fresh identical record restore", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(1));
  f.controller.prepareRestore();
  f.store.external({ kind: "rename", id: id(2), label: "Other record", time: LATER });
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.controller.state.document.revision, 5);
  assert.equal(f.deliveries.length, 1);
});

for (const stageCheckpoint of [() => false, () => undefined, () => { throw Error("raw private failure"); },
  () => Promise.reject(Error("asynchronous callback failed"))]) {
  test("failed restore receiver is never reported as successful", async () => {
    const f = await loaded({ document: sampleLibrary(), controller: { stageCheckpoint } });
    f.controller.select(id(1));
    f.controller.prepareRestore();
    assert.equal(await f.controller.applyReview(), false);
    assert.equal(f.controller.state.phase, "error");
    assert.ok(!f.controller.state.message.includes("復元候補を送りました"));
    await tick();
  });
}

test("stale writer must reload instead of overwriting a concurrent save", async () => {
  const shared = memoryStorage();
  const first = await loaded({ store: shared });
  const second = await loaded({ store: shared });
  first.controller.prepareSave("first");
  second.source({ draft: checkpoint(5), requiresNewPlan: false });
  second.controller.prepareSave("second");
  assert.equal(await first.controller.applyReview(), true);
  assert.equal(await second.controller.applyReview(), false);
  assert.equal(second.controller.state.error, "PERIOD_LIBRARY_STALE");
  assert.equal(second.controller.state.loaded, false);
  assert.equal(shared.document.entries.length, 1);
  assert.equal(await second.controller.refresh(), true);
  assert.equal(second.controller.state.loaded, true);
});

test("duplicate save failure preserves original evidence and requires refreshed state", async () => {
  const f = await loaded({ document: library([entry()]) });
  f.controller.prepareSave("Same evidence");
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_DUPLICATE_DRAFT");
  assert.equal(f.controller.state.loaded, false);
  assert.equal(f.store.document.entries.length, 1);
});

test("rename edits metadata while retaining the selected record", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(1));
  assert.equal(await f.controller.edit("rename", "New name"), true);
  assert.equal(f.controller.state.document.entries[0].label, "New name");
  assert.equal(f.controller.state.selectedId, id(1));
  assert.equal(f.store.document.entries[0].updatedAt, LATER);
});

test("archive and explicit purge remove only the selected archived item", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(1));
  assert.equal(await f.controller.edit("archive", true), true);
  assert.equal(await f.controller.edit("purge", true), true);
  assert.equal(f.controller.state.selectedId, null);
  assert.equal(f.store.document.entries.length, 3);
  assert.ok(f.store.document.entries.some(row => row.id === id(2)));
});

test("declining deletion keeps the record and exposes a recovery error", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(4));
  assert.equal(await f.controller.edit("purge", false), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_PURGE_ACK");
  assert.equal(f.store.document.entries.length, 4);
});

test("invalid metadata mutation never reaches storage", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(1));
  assert.equal(await f.controller.edit("clear-all", true), false);
  assert.equal(await f.controller.edit("rename", ""), false);
  assert.deepEqual(f.store.calls, [["read"]]);
});

test("comparison uses saved and current evidence without storage writes or restore", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(1));
  f.source({ draft: checkpoint(5), requiresNewPlan: false });
  assert.equal(f.controller.compare(), true);
  assert.ok(f.controller.state.comparison.length > 0);
  assert.equal(f.deliveries.length, 0);
  assert.deepEqual(f.store.calls, [["read"]]);
});

test("comparison without a current draft clears stale comparison text", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(1));
  f.controller.compare();
  f.source(null);
  assert.equal(f.controller.compare(), false);
  assert.equal(f.controller.state.comparison, "");
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_NO_SOURCE");
});

test("JSON import stays in review until explicitly applied", async () => {
  const f = await loaded();
  const file = await preparePeriodLibraryFile(sampleLibrary());
  assert.equal(await f.controller.importFile(fileFrom(file.text)), true);
  assert.equal(f.controller.state.review.kind, "import");
  assert.equal(f.controller.state.review.plan.additions, 4);
  assert.equal(f.store.document.entries.length, 0);
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.store.document.entries.length, 4);
  assert.equal(f.store.document.revision, 1);
});

test("import of an existing identical collection is a revision-stable no-op", async () => {
  const f = await loaded({ document: sampleLibrary() });
  const file = await preparePeriodLibraryFile(sampleLibrary());
  await f.controller.importFile(fileFrom(file.text));
  assert.equal(f.controller.state.review.plan.additions, 0);
  assert.equal(f.controller.state.review.plan.duplicates, 4);
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.store.document.revision, 4);
});

test("conflicting import does not offer a destructive confirmation", async () => {
  const f = await loaded({ document: library([entry()]) });
  const file = await preparePeriodLibraryFile(library([entry(1, { label: "Conflict" })]));
  assert.equal(await f.controller.importFile(fileFrom(file.text)), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_IMPORT_CONFLICT");
  assert.equal(f.controller.state.review, null);
  assert.equal(f.store.document.entries[0].label, "控え 1");
});

test("a concurrent mutation invalidates the import revision", async () => {
  const f = await loaded();
  const file = await preparePeriodLibraryFile(sampleLibrary());
  await f.controller.importFile(fileFrom(file.text));
  f.store.external(saveOperation(9, checkpoint(1)));
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_STALE");
  assert.equal(f.store.document.entries.length, 1);
});

test("malformed import clears the previous review", async () => {
  const f = await loaded();
  f.controller.prepareSave("Old review");
  assert.equal(await f.controller.importFile(fileFrom("{")), false);
  assert.equal(f.controller.state.review, null);
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.store.document.entries.length, 0);
});

test("collection export reads current committed storage, including hidden records", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.store.external({ kind: "rename", id: id(1), label: "Latest", time: LATER });
  assert.equal(await f.controller.exportFile("all", f.download), true);
  const decoded = await decodePeriodLibraryFile(f.files[0].text);
  assert.equal(decoded.document.entries.length, 4);
  assert.equal(decoded.document.entries[0].label, "Latest");
  assert.equal(f.controller.state.document.revision, 5);
  assert.equal(f.store.calls.filter(call => call[0] === "change").length, 0);
});

test("selected export keeps quarantine and archive metadata in a one-item collection", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(3));
  assert.equal(await f.controller.exportFile("selected", f.download), true);
  const decoded = await decodePeriodLibraryFile(f.files[0].text);
  assert.equal(decoded.document.entries.length, 1);
  assert.equal(decoded.document.entries[0].requiresNewPlan, true);
  assert.equal(decoded.document.entries[0].id, id(3));
});

test("selected export fails if another view has deleted that item", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(4));
  f.store.external({ kind: "purge", id: id(4), acknowledged: true });
  assert.equal(await f.controller.exportFile("selected", f.download), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_NOT_FOUND");
  assert.equal(f.files.length, 0);
});

test("CSV export uses a captured filter and never serializes full drafts", async () => {
  const f = await loaded({ document: sampleLibrary() });
  assert.equal(await f.controller.exportFile("csv", f.download, { agent: "EMA" }), true);
  assert.equal(f.files[0].rows, 1);
  assert.equal(f.files[0].containsBalances, false);
  assert.ok(!f.files[0].text.includes("blockHash"));
});

test("export explicitly clears a pending review before refreshing storage", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.select(id(1));
  f.controller.prepareRestore();
  assert.equal(await f.controller.exportFile("all", f.download), true);
  assert.equal(f.controller.state.review, null);
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.deliveries.length, 0);
});

test("a rejected asynchronous download callback is drained and reported", async () => {
  const f = await loaded({ document: sampleLibrary() });
  assert.equal(await f.controller.exportFile("all", () => Promise.reject(Error("download failed"))), false);
  assert.equal(f.controller.state.error, "PERIOD_ASYNC_DELIVERY");
  await tick();
});

test("download callback exception produces no successful-download message", async () => {
  const f = await loaded();
  assert.equal(await f.controller.exportFile("all", () => { throw Error("private path"); }), false);
  assert.equal(f.controller.state.phase, "error");
  assert.ok(!f.controller.state.message.includes("ダウンロードを開始"));
});

test("observer errors cannot prevent committed storage updates", async () => {
  const f = await loaded({ controller: { onChange() { throw Error("UI broken"); } } });
  f.controller.prepareSave("Safe");
  assert.equal(await f.controller.applyReview(), true);
  assert.equal(f.store.document.entries.length, 1);
});

test("asynchronous observer rejections are contained", async () => {
  const f = await loaded({ controller: { onChange: () => Promise.reject(Error("UI broken")) } });
  f.controller.prepareSave("Safe");
  assert.equal(await f.controller.applyReview(), true);
  await tick();
  assert.equal(f.store.document.entries.length, 1);
});

test("invalid controller callbacks are rejected before any storage access", () => {
  assert.throws(() => createPeriodLibraryController({}));
  assert.throws(() => fixture({ controller: { getCheckpoint: null } }));
  assert.throws(() => fixture({ controller: { now: null } }));
});

test("canceling an idle reviewed operation never writes storage", async () => {
  const f = await loaded();
  f.controller.prepareSave("Cancel me");
  f.controller.cancel();
  assert.equal(f.controller.state.review, null);
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(f.store.document.entries.length, 0);
});

test("canceling a delayed read ignores its late result", async () => {
  const gate = deferred();
  const store = memoryStorage(sampleLibrary(), { beforeRead: () => gate.promise });
  const f = fixture({ store });
  const pending = f.controller.refresh();
  assert.equal(f.controller.state.busy, true);
  f.controller.cancel();
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(f.controller.state.loaded, false);
  assert.equal(f.controller.state.document.entries.length, 0);
});

test("canceling before a write commits aborts it and forces a fresh read", async () => {
  const gate = deferred();
  const store = memoryStorage(undefined, { beforeChange: () => gate.promise });
  const f = await loaded({ store });
  f.controller.prepareSave("Cancelled");
  const pending = f.controller.applyReview();
  f.controller.cancel();
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(store.document.entries.length, 0);
  assert.equal(f.controller.state.loaded, false);
  assert.equal(await f.controller.refresh(), true);
});

test("cancel after a commit does not claim to undo already-stored evidence", async () => {
  const gate = deferred();
  const store = memoryStorage(undefined, { afterChange: () => gate.promise });
  const f = await loaded({ store });
  f.controller.prepareSave("Already committed");
  const pending = f.controller.applyReview();
  await tick();
  assert.equal(store.document.entries.length, 1);
  f.controller.cancel();
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(f.controller.state.loaded, false);
  assert.equal(await f.controller.refresh(), true);
  assert.equal(f.controller.state.document.entries.length, 1);
});

test("canceling import prevents a late file parser from replacing review state", async () => {
  const gate = deferred();
  const f = await loaded({ controller: { readFile: () => gate.promise } });
  const pending = f.controller.importFile({});
  f.controller.cancel();
  gate.resolve({ document: sampleLibrary() });
  assert.equal(await pending, false);
  assert.equal(f.controller.state.review, null);
  assert.equal(f.store.document.entries.length, 0);
});

test("cancel during checksum generation prevents the download callback", async () => {
  const gate = deferred();
  const f = await loaded({ controller: { prepareFile: () => gate.promise } });
  const pending = f.controller.exportFile("all", f.download);
  await tick();
  f.controller.cancel();
  gate.resolve({ text: "{}" });
  assert.equal(await pending, false);
  assert.equal(f.files.length, 0);
});

test("cancel while a restore refresh is pending never calls the receiver", async () => {
  let wait = false;
  const gate = deferred();
  const store = memoryStorage(sampleLibrary(), { beforeRead: () => wait ? gate.promise : undefined });
  const f = await loaded({ store });
  f.controller.select(id(1));
  f.controller.prepareRestore();
  wait = true;
  const pending = f.controller.applyReview();
  f.controller.cancel();
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(f.deliveries.length, 0);
});

test("busy operations cannot trigger a second concurrent storage action", async () => {
  const gate = deferred();
  const f = fixture({ store: memoryStorage(undefined, { beforeRead: () => gate.promise }) });
  const pending = f.controller.refresh();
  assert.equal(await f.controller.refresh(), false);
  assert.equal(f.controller.prepareSave("Busy"), false);
  assert.equal(f.controller.select(id(1)), false);
  assert.equal(f.controller.state.error, "PERIOD_LIBRARY_BUSY");
  assert.equal(f.store.calls.length, 1);
  gate.resolve();
  assert.equal(await pending, true);
});

test("disposing a pending read prevents late UI notifications", async () => {
  const gate = deferred();
  const f = fixture({ store: memoryStorage(sampleLibrary(), { beforeRead: () => gate.promise }) });
  const pending = f.controller.refresh();
  f.controller.dispose();
  const changes = f.changes.length;
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(f.changes.length, changes);
  assert.equal(f.store.closed, true);
});

test("dispose is idempotent and all subsequent public operations are inert", async () => {
  const f = await loaded({ document: sampleLibrary() });
  f.controller.dispose();
  f.controller.dispose();
  const calls = f.store.calls.length;
  assert.equal(await f.controller.refresh(), false);
  assert.equal(f.controller.prepareSave("No"), false);
  assert.equal(f.controller.prepareRestore(), false);
  assert.equal(f.controller.select(id(1)), false);
  assert.equal(await f.controller.applyReview(), false);
  assert.equal(await f.controller.edit("archive", true), false);
  assert.equal(await f.controller.importFile({}), false);
  assert.equal(await f.controller.exportFile("all", f.download), false);
  assert.equal(f.controller.compare(), false);
  f.controller.cancel();
  assert.equal(f.store.calls.length, calls);
  assert.equal(f.store.calls.filter(call => call[0] === "close").length, 1);
});
