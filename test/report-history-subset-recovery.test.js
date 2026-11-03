import test from "node:test";
import assert from "node:assert/strict";
import { selectHistoryEntries, inspectReportHistoryImport, planHistoryMerge, mutateReportHistory } from "../src/report-history-model.js";
import { filteredReportHistory } from "../src/report-history-query.js";
import { prepareReportHistoryFile, decodeReportHistoryFile, prepareHistoryImportInspectionFile } from "../src/report-history-file.js";
import { createReportHistoryController } from "../src/report-history-controller.js";
import { historyImportInspectionText } from "../src/report-history-view.js";
import { sampleHistory, historyDocument, historyRecord, historyMemory, clone, id, fileFrom, deferred } from "./helpers/report-history-fixtures.js";

test("recoverable filtered history preserves complete original reports, annotations and archive flags", async () => {
  const before = sampleHistory();
  for (const [query, ids] of [[{ archive: "archived" }, [id(104)]], [{ tag: "partial" }, [id(103)]], [{ archive: "all", search: "EMA 確認" }, [id(102)]]]) {
    const subset = filteredReportHistory(before, query), decoded = await decodeReportHistoryFile((await prepareReportHistoryFile(subset)).text);
    assert.deepEqual(decoded.document.entries, ids.map(key => before.entries.find(row => row.id === key)));
    assert.equal(decoded.document.entries[0].report.slots.length, 3); assert.equal(subset.revision, 0);
  }
  assert.equal(filteredReportHistory(before, { search: "no such report" }).entries.length, 0);
});

test("explicit annotated selection retains all original fields and rejects ambiguous or unknown IDs", () => {
  const before = sampleHistory(), result = selectHistoryEntries(before, [id(104), id(101)]);
  assert.deepEqual(result.entries, [before.entries[3], before.entries[0]]); assert.ok(Object.isFrozen(result.entries));
  for (const ids of [[id(101), id(101)], [id(999)], "invalid", ["bad"]]) assert.throws(() => selectHistoryEntries(before, ids));
  let calls = 0; const ids = []; Object.defineProperty(ids, "0", { get() { calls++; return id(101); }, enumerable: true });
  assert.throws(() => selectHistoryEntries(before, ids)); assert.equal(calls, 0);
});

function mixed() {
  const base = sampleHistory(), duplicate = { ...base.entries[0], id: id(201), note: "PRIVATE incoming note", archived: true };
  const conflict = clone(base.entries[1]); conflict.report.title = "PRIVATE changed title";
  conflict.report.slots[0].entry.requiresNewPlan = true;
  return { before: base, incoming: historyDocument([duplicate, conflict, historyRecord(9)]) };
}
test("import inspection distinguishes duplicate evidence under a new ID, real conflicts and additions without exposing values", () => {
  const { before, incoming } = mixed(), result = inspectReportHistoryImport(before, incoming);
  assert.deepEqual([result.additions, result.duplicates, result.conflicts, result.metadataKept], [1, 1, 1, 1]);
  assert.equal(result.rows[0].retainedId, id(101)); assert.deepEqual(result.rows[0].changedMetadata, ["id", "note", "archived"]);
  assert.deepEqual(result.rows[1].changedReportFields, ["title", "slots"]); assert.deepEqual(result.rows[1].changedAgents, ["DAT"]);
  assert.equal(result.compatible, false); assert.equal(result.compatibleSkippingConflicts, true);
  assert.deepEqual(result.retainedIds, [id(103), id(104)]);
  const text = JSON.stringify(result) + historyImportInspectionText(result);
  assert.ok(!text.includes("PRIVATE")); assert.ok(!text.includes(before.entries[0].report.slots[0].entry.draft.plan.context.account));
  assert.equal(result.restorable, false); assert.equal(result.liveChainRechecked, false); assert.ok(Object.isFrozen(result.rows[0].changedMetadata));
});

test("inspection exposes removed restrictions, capacity overflow and exhausted revisions without offering replacement", () => {
  const entry = clone(historyRecord(1)); entry.report.slots[0].entry.requiresNewPlan = true;
  const incoming = clone(entry); incoming.report.slots[0].entry.requiresNewPlan = false;
  const result = inspectReportHistoryImport(historyDocument([entry]), historyDocument([incoming]));
  assert.deepEqual(result.rows[0].removedRestrictions, ["DAT"]); assert.equal(result.compatible, false);
  const full = historyDocument(Array.from({ length: 12 }, (_, index) => historyRecord(index + 1)));
  assert.equal(inspectReportHistoryImport(full, historyDocument([historyRecord(20)])).capacity.fits, false);
  const max = historyDocument([historyRecord(1)], Number.MAX_SAFE_INTEGER);
  assert.equal(inspectReportHistoryImport(max, historyDocument([historyRecord(2)])).revisionLimited, true);
  assert.equal(inspectReportHistoryImport(max, max).compatible, true);
});

test("inspection receipts bind canonical sources and remain fixed across digest waits", async () => {
  const { before, incoming } = mixed(), mutable = clone(incoming), started = deferred(), gate = deferred(); let calls = 0;
  const pending = prepareHistoryImportInspectionFile(before, mutable, { subtle: { digest(...args) { calls++; if (calls === 1) started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; mutable.entries[0].note = "later mutation"; gate.resolve();
  const file = await pending, value = JSON.parse(file.text);
  assert.equal(value.beforeDigest, (await prepareReportHistoryFile(before)).digest);
  assert.equal(value.incomingDigest, (await prepareReportHistoryFile(incoming)).digest);
  assert.equal(value.beforeRevision, before.revision); assert.equal(file.restorable, false);
  assert.equal(value.containsOriginalEvidence, false);
  let getters = 0; await assert.rejects(prepareHistoryImportInspectionFile(before, incoming, { get signal() { getters++; return undefined; } })); assert.equal(getters, 0);
  const abort = new AbortController(); abort.abort(); await assert.rejects(prepareHistoryImportInspectionFile(before, incoming, { signal: abort.signal }));
});

function controller(initial, options = {}) {
  const store = options.store ?? historyMemory(initial), c = createReportHistoryController({ storage: store.storage, getReport: () => null, stageReport: () => assert.fail("No handoff"), ...options });
  return { store, c };
}
test("filtered export captures query before notifications and refuses changed storage or zero matches", async () => {
  const initial = sampleHistory(), query = { archive: "archived" }; let mutate = false;
  const { store, c } = controller(initial, { onChange: value => { if (mutate && value.phase === "exporting") query.archive = "all"; } });
  try {
    await c.refresh(); mutate = true; const files = [];
    assert.equal(await c.exportFile("filtered-backup", true, file => files.push(file), query), true);
    assert.deepEqual((await decodeReportHistoryFile(files[0].text)).document.entries, [initial.entries[3]]);
    assert.equal(await c.exportFile("filtered-backup", true, () => assert.fail(), { search: "absent" }), false);
    assert.equal(c.state.error, "PERIOD_HISTORY_EMPTY_SELECTION");
    const changed = clone(initial); changed.entries[0].note = "external change"; changed.revision++;
    store.replace(changed); assert.equal(await c.exportFile("filtered-backup", true, () => assert.fail(), { archive: "all" }), false);
    assert.equal(c.state.error, "PERIOD_HISTORY_STALE"); assert.equal(store.calls.some(row => row[0] === "change"), false);
  } finally { c.dispose(); }
});
test("single annotated backup differs from the existing bare report export and preserves a hidden selection", async () => {
  const initial = sampleHistory(), { c, store } = controller(initial), files = [];
  try {
    await c.refresh(); c.select(id(104));
    assert.equal(await c.exportFile("selected-backup", false, () => assert.fail()), false);
    assert.equal(await c.exportFile("selected-backup", true, file => files.push(file), { search: "nothing" }), true);
    assert.deepEqual((await decodeReportHistoryFile(files[0].text)).document.entries, [initial.entries[3]]);
    assert.equal(store.calls.some(row => row[0] === "change"), false);
  } finally { c.dispose(); }
});
test("selective import relieves capacity without deleting existing reports and saves only the reviewed subset", async () => {
  const before = historyDocument(Array.from({ length: 11 }, (_, i) => historyRecord(i + 1))), incoming = historyDocument([historyRecord(20), historyRecord(21)]);
  const { c, store } = controller(before);
  try {
    await c.refresh(); await c.importFile(fileFrom((await prepareReportHistoryFile(incoming)).text));
    assert.equal(c.state.review.plan.capacityExceeded, true);
    assert.equal(c.setImportSelection([id(120)]), true); assert.equal(c.state.review.plan.capacityExceeded, false);
    assert.equal(c.state.review.incoming.entries.length, 2); assert.equal(c.state.review.inspection.incomingCount, 1);
    assert.equal(store.document.entries.length, 11); assert.equal(await c.applyReview(), true);
    assert.deepEqual(store.document.entries, [...before.entries, incoming.entries[0]]);
  } finally { c.dispose(); }
});
test("selective import never overwrites conflicts, and deselection or invalid choices cannot silently add all reports", async () => {
  const { before, incoming } = mixed(), { c, store } = controller(before);
  try {
    await c.refresh(); await c.importFile(fileFrom((await prepareReportHistoryFile(incoming)).text));
    c.setImportSelection([id(102)]); assert.equal(await c.applyReview(), false); assert.equal(c.state.error, "PERIOD_HISTORY_CONFLICT");
    const pending = c.state.review; assert.equal(c.setImportSelection([id(999)]), false); assert.equal(c.state.review, pending);
    c.setImportSelection([]); assert.equal(await c.applyReview(), false); assert.equal(c.state.error, "PERIOD_HISTORY_EMPTY_SELECTION");
    c.setImportSelection([id(109)]); assert.equal(await c.applyReview(), true);
    assert.deepEqual(store.document.entries, [...before.entries, incoming.entries[2]]);
  } finally { c.dispose(); }
});
test("receipt export keeps the selected review and rejects stale storage, cancellation and asynchronous delivery", async () => {
  const { before, incoming } = mixed(), { c, store } = controller(before), files = [];
  try {
    await c.refresh(); await c.importFile(fileFrom((await prepareReportHistoryFile(incoming)).text)); c.setImportSelection([id(109)]);
    const pending = c.state.review;
    assert.equal(await c.exportImportInspection(false, () => assert.fail()), false);
    assert.equal(await c.exportImportInspection(true, file => files.push(file)), true); assert.equal(c.state.review, pending);
    assert.equal(JSON.parse(files[0].text).incomingCount, 1); assert.equal(store.calls.some(row => row[0] === "change"), false);
    assert.equal(await c.exportImportInspection(true, () => Promise.reject(Error("PRIVATE"))), false); assert.equal(c.state.error, "PERIOD_ASYNC_DELIVERY");
    store.replace(historyDocument(before.entries, before.revision + 1));
    assert.equal(await c.exportImportInspection(true, () => assert.fail()), false); assert.equal(c.state.error, "PERIOD_HISTORY_STALE"); assert.equal(c.state.review, null);
  } finally { c.dispose(); }
  let active; const f = controller(before, { onChange: state => { if (state.phase === "exporting") active.cancel(); } }); active = f.c;
  try { await active.refresh(); await active.importFile(fileFrom((await prepareReportHistoryFile(incoming)).text)); assert.equal(await active.exportImportInspection(true, () => assert.fail()), false); }
  finally { active.dispose(); }
});
