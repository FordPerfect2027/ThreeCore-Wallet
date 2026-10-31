import test from "node:test";
import assert from "node:assert/strict";
import { reportSetHistoryDocument } from "../src/report-set-model.js";
import { prepareReportSetHistoryFile } from "../src/report-set-export.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { decodeReportHistoryFile } from "../src/report-history-file.js";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { sequenceSet, sequenceHistory, demoSetHistory, historyMemory, historyDocument, historyRecord, clone, id, fileFrom, deferred } from "./helpers/report-set-fixtures.js";

test("recovered history preserves every original annotation, archive flag, identifier and nested restriction", async () => {
  const source = clone(sequenceSet(demoSetHistory())); source.entries[0].report.slots[0].entry.requiresNewPlan = true;
  const before = JSON.stringify(source), file = await prepareReportSetHistoryFile(source), decoded = await decodeReportHistoryFile(file.text);
  assert.deepEqual(decoded.document.entries, source.entries); assert.equal(decoded.document.revision, 0);
  assert.deepEqual(decoded.document, reportSetHistoryDocument(source));
  assert.equal(file.reportCount, source.entries.length); assert.equal(file.archivedReports, 1);
  assert.equal(file.includesOriginalAnnotations, true); assert.equal(file.liveChainRechecked, false); assert.equal(file.automaticallyImported, false);
  assert.equal(JSON.stringify(source), before);
});

test("recovery covers only reports actually selected into the set", async () => {
  const history = sequenceHistory(), source = sequenceSet(history, [history.entries[1].id]);
  const decoded = await decodeReportHistoryFile((await prepareReportSetHistoryFile(source)).text);
  assert.deepEqual(decoded.document.entries, [history.entries[1]]); assert.equal(decoded.document.entries.length, 1);
  assert.ok(!decoded.document.entries.some(row => row.id === history.entries[0].id));
});

test("source capture and abort remain effective across checksum work", async () => {
  const source = clone(sequenceSet()), before = clone(source.entries), started = deferred(), gate = deferred();
  const pending = prepareReportSetHistoryFile(source, { subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; source.entries[0].note = "later mutation"; gate.resolve();
  assert.deepEqual((await decodeReportHistoryFile((await pending).text)).document.entries, before);
  let calls = 0; await assert.rejects(prepareReportSetHistoryFile(source, { get signal() { calls++; return null; } })); assert.equal(calls, 0);
  const abort = new AbortController(); abort.abort(); await assert.rejects(prepareReportSetHistoryFile(source, { signal: abort.signal }));
});

test("history import reviews recovered entries and preserves local metadata on an existing duplicate", async () => {
  const source = sequenceSet(), file = await prepareReportSetHistoryFile(source), local = { ...source.entries[0], note: "Local note wins", archived: true };
  const store = historyMemory(historyDocument([local])), c = createReportHistoryController({ storage: store.storage, getReport: () => null, stageReport: () => assert.fail("no opening") });
  try {
    await c.refresh(); await c.importFile(fileFrom(file.text));
    assert.equal(store.document.entries.length, 1); assert.equal(c.state.review.plan.additions.length, 2); assert.equal(c.state.review.plan.duplicates.length, 1);
    assert.deepEqual(c.state.review.plan.metadataKept, [local.id]); assert.equal(await c.applyReview(), true);
    assert.deepEqual(store.document.entries, [local, ...source.entries.slice(1)]);
  } finally { c.dispose(); }
});

async function ready(options = {}) {
  const store = historyMemory(), c = createReportSetController({ storage: store.storage, ...options });
  const source = sequenceSet(); await c.importFile(fileFrom((await prepareReportSetFile(source)).text)); await c.applyReview();
  await c.importFile(fileFrom((await prepareReportSetFile(sequenceSet(demoSetHistory()))).text));
  return { c, source, store };
}
test("history backup needs its acknowledgement and keeps accepted and pending sets untouched", async () => {
  const { c, source, store } = await ready(), accepted = c.state.input, pending = c.state.review, files = [];
  try {
    assert.equal(await c.exportHistoryBackup(false, file => files.push(file)), false);
    assert.equal(await c.exportHistoryBackup(true, file => files.push(file)), true);
    assert.deepEqual((await decodeReportHistoryFile(files[0].text)).document.entries, source.entries);
    assert.equal(c.state.input, accepted); assert.equal(c.state.review, pending); assert.equal(store.calls.length, 0);
    assert.equal(await c.exportHistoryBackup(true, () => false), false);
    assert.equal(await c.exportHistoryBackup(true, () => Promise.reject(Error("PRIVATE"))), false);
    assert.equal(c.state.error, "PERIOD_ASYNC_DELIVERY"); assert.equal(c.state.review, pending);
  } finally { c.dispose(); }
});
test("cancel and dispose before export work prevent history delivery", async () => {
  for (const action of ["cancel", "dispose"]) {
    let c; const f = await ready({ onChange: state => { if (state.phase === "exporting") c[action](); } }); c = f.c;
    assert.equal(await c.exportHistoryBackup(true, () => assert.fail("delivered")), false); c.dispose();
  }
});
