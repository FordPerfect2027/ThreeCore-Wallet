import test from "node:test";
import assert from "node:assert/strict";
import { compareReportSetEvents } from "../src/report-set-engine.js";
import { prepareReportSetEventComparisonFile } from "../src/report-set-export.js";
import { setEventComparisonText } from "../src/report-set-view.js";
import { prepareReportSetFile, decodeReportSetFile } from "../src/report-set-file.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { sequenceSet, sequenceHistory, clone, hash, id, historyMemory, fileFrom, deferred } from "./helpers/report-set-fixtures.js";

const query = () => ({ beforeId: id(101), afterId: id(102), agent: "DAT" });
const pair = (change = () => {}, offsets = [0n, 0n]) => sequenceSet(sequenceHistory(offsets, (report, index) => { if (index === 1) change(report.slots[0].entry.draft, report); }));
test("common saved history compares event identities without adding repeated evidence or amounts", () => {
  const source = pair(), result = compareReportSetEvents(source, query());
  assert.equal(result.status, "saved-observations-match"); assert.equal(result.comparedBlocks, "12");
  assert.deepEqual(result.commonRanges, [{ fromBlock: "31", toBlock: "42" }]);
  assert.deepEqual(result.counts, { matching: 2, changed: 0, onlyBefore: 0, onlyAfter: 0 });
  assert.equal(result.eventsCombined, false); assert.equal(result.absenceProvesNoTransfer, false);
  assert.equal(result.before.comparedEvents, 2); assert.equal(result.after.comparedEvents, 2);
  assert.ok(Object.isFrozen(result.before)); assert.ok(Object.isFrozen(result.commonRanges));
});
test("missing event and changed values are distinct with exact source record references", () => {
  const source = pair(draft => { draft.records[0].events[0].amountBaseUnits = "1"; draft.records[1].events = []; });
  const result = compareReportSetEvents(source, query());
  assert.equal(result.status, "differences"); assert.equal(result.counts.changed, 1); assert.equal(result.counts.onlyBefore, 1);
  assert.deepEqual(result.differences[0].changedFields, ["amountBaseUnits"]);
  assert.equal(result.differences[0].after.recordIndex, 0); assert.equal(result.differences[0].after.eventIndex, 0);
  assert.equal(result.differences[1].before.event.blockNumber, "40"); assert.equal(result.differences[1].after, null);
  const reversed = compareReportSetEvents(source, { ...query(), beforeId: id(102), afterId: id(101) });
  assert.equal(reversed.counts.onlyAfter, 1); assert.equal(reversed.differences[0].before.event.amountBaseUnits, "1");
});
test("unread suffixes and non-overlapping plans are not treated as absent events", () => {
  const result = compareReportSetEvents(pair(draft => { draft.records = draft.records.slice(0, 1); }), query());
  assert.equal(result.comparedBlocks, "5"); assert.equal(result.counts.matching, 1); assert.equal(result.counts.onlyBefore, 0);
  assert.equal(result.before.excludedEvents, 1); assert.equal(result.status, "saved-observations-match");
  const noOverlap = compareReportSetEvents(pair(() => {}, [0n, 12n]), query());
  assert.equal(noOverlap.status, "no-common-coverage"); assert.equal(noOverlap.comparedBlocks, "0"); assert.equal(noOverlap.counts.matching, 0);
  const unread = compareReportSetEvents(pair(draft => { draft.records = []; }), query()); assert.equal(unread.status, "no-common-coverage");
});
test("different query partitions retain the same common scope and matching event list", () => {
  const source = pair(draft => {
    const first = draft.records[0], last = draft.records.at(-1), events = draft.records.flatMap(row => row.events);
    draft.plan.windowSize = 12;
    draft.records = [{ ...first, range: { fromBlock: "31", toBlock: "42" }, toBlockHash: last.toBlockHash, events }];
  });
  const result = compareReportSetEvents(source, query());
  assert.equal(result.status, "saved-observations-match"); assert.equal(result.comparedBlocks, "12"); assert.equal(result.counts.matching, 2);
  assert.equal(result.before.savedQueryRecords, 3); assert.equal(result.after.savedQueryRecords, 1);
});
test("zero event lists still report differing common block hashes", () => {
  const source = sequenceSet(sequenceHistory([0n, 0n], (report, index) => {
    const draft = report.slots[0].entry.draft; for (const record of draft.records) record.events = [];
    if (index === 1) {
      for (const endpoint of [draft.earlier, draft.later]) endpoint.blockHash = hash(BigInt(endpoint.blockNumber) + 900n);
      for (const record of draft.records) { record.fromBlockHash = hash(BigInt(record.range.fromBlock) + 900n); record.toBlockHash = hash(BigInt(record.range.toBlock) + 900n); }
    }
  }));
  const result = compareReportSetEvents(source, query());
  assert.equal(result.status, "differences"); assert.equal(result.differences.length, 0); assert.ok(result.anchorDifferences.length > 0);
  assert.match(setEventComparisonText(result), /ハッシュ不一致/);
});
test("missing token and different account are rejected instead of compared", () => {
  assert.throws(() => compareReportSetEvents(pair((_draft, report) => { report.slots[0].entry = null; }), query()), error => error.code === "PERIOD_SET_EVENT_SLOT");
  const source = pair(draft => {
    const old = draft.plan.context.account, account = "0x" + "9".repeat(40); draft.plan.context.account = account;
    draft.earlier.account = account; draft.later.account = account;
    for (const record of draft.records) { record.context.account = account; for (const event of record.events) { if (event.from === old) event.from = account; if (event.to === old) event.to = account; } }
  });
  assert.throws(() => compareReportSetEvents(source, query()), error => error.code === "PERIOD_SET_EVENT_CONTEXT");
});
test("invalid queries cannot invoke getters or select a foreign source", () => {
  const source = pair(); let touched = 0;
  for (const value of [null, {}, { ...query(), beforeId: id(102) }, { ...query(), agent: "OTHER" }, { ...query(), extra: true },
    { ...query(), get beforeId() { touched++; return id(101); } }])
    assert.throws(() => compareReportSetEvents(source, value), error => error.code === "PERIOD_SET_EVENT_QUERY");
  assert.equal(touched, 0);
  assert.throws(() => compareReportSetEvents(source, { ...query(), beforeId: id(999) }), error => error.code === "PERIOD_SET_EVENT_SOURCE");
});
test("source-linked comparison exports preserve exact observations and omit note bodies", async () => {
  const source = clone(pair(draft => { draft.records[0].events[0].amountBaseUnits = "9"; })); source.entries[0].note = "PRIVATE_EVENT_NOTE";
  const file = await prepareReportSetEventComparisonFile(source, query()), data = JSON.parse(file.text);
  assert.equal(data.sourcePayloadDigest, (await prepareReportSetFile(source)).digest);
  assert.deepEqual(data.comparison, compareReportSetEvents(source, query())); assert.doesNotMatch(file.text, /PRIVATE_EVENT_NOTE/);
  assert.equal(file.containsOriginalEvidence, true); assert.equal(file.restorable, false); assert.equal(data.authorizesExecution, false);
  await assert.rejects(decodeReportSetFile(file.text), error => error.code === "PERIOD_FILE_EVENT_COMPARISON_ONLY");
});
test("comparison export pins mutable query and source before awaiting hashing", async () => {
  const source = clone(pair()), options = query(), started = deferred(), gate = deferred();
  const pending = prepareReportSetEventComparisonFile(source, options, { subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; source.entries[0].label = "LATE_LABEL"; options.agent = "EMA"; gate.resolve();
  const file = await pending; assert.doesNotMatch(file.text, /LATE_LABEL/); assert.equal(JSON.parse(file.text).comparison.query.agent, "DAT");
  const abort = new AbortController(); abort.abort(); await assert.rejects(prepareReportSetEventComparisonFile(pair(), query(), { signal: abort.signal }));
  let touched = 0;
  await assert.rejects(prepareReportSetEventComparisonFile(pair(), query(), { get signal() { touched++; return null; } }), error => error.code === "PERIOD_CRYPTO");
  assert.equal(touched, 0);
});

test("cancel or disposal during export announcement prevents comparison delivery", async () => {
  for (const stop of ["cancel", "dispose"]) {
    let c, armed = false, delivered = 0;
    c = createReportSetController({ storage: historyMemory().storage, onChange(state) {
      if (armed && state.phase === "exporting") c[stop]();
    } });
    await c.importFile(fileFrom((await prepareReportSetFile(pair())).text)); await c.applyReview(); armed = true;
    assert.equal(await c.exportEventComparison(query(), true, () => delivered++), false);
    assert.equal(delivered, 0); c.dispose();
  }
});
test("controller saves full comparison without modifying the accepted source or pending candidate", async () => {
  const store = historyMemory(), c = createReportSetController({ storage: store.storage }), files = [];
  try {
    const source = pair(); await c.importFile(fileFrom((await prepareReportSetFile(source)).text)); await c.applyReview();
    await c.importFile(fileFrom((await prepareReportSetFile(sequenceSet())).text)); const input = c.state.input, review = c.state.review;
    assert.equal(await c.exportEventComparison(query(), false, file => files.push(file)), false);
    assert.equal(await c.exportEventComparison(query(), true, () => false), false);
    assert.equal(await c.exportEventComparison(query(), true, () => Promise.reject(Error("PRIVATE"))), false);
    assert.equal(await c.exportEventComparison(query(), true, file => files.push(file)), true);
    assert.equal(c.state.input, input); assert.equal(c.state.review, review); assert.equal(c.state.phase, "review"); assert.equal(store.calls.length, 0);
    assert.equal(files[0].text, (await prepareReportSetEventComparisonFile(input, query())).text);
  } finally { c.dispose(); }
});
