import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareReportSetEventComparisonFile, reviewReportSetEventComparisonFile, readReportSetEventComparisonText, REPORT_SET_EVENT_COMPARISON_LIMIT } from "../src/report-set-export.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { setEventComparisonReviewText } from "../src/report-set-view.js";
import { sequenceSet, sequenceHistory, historyMemory, clone, id, fileFrom, deferred } from "./helpers/report-set-fixtures.js";
const query = { beforeId: id(101), afterId: id(102), agent: "DAT" };
function changed() { return sequenceSet(sequenceHistory([0n, 0n], (report, index) => { if (index) report.slots[0].entry.draft.records[0].events[0].amountBaseUnits = "1"; })); }
async function fixture(input = changed()) { return { input, file: await prepareReportSetEventComparisonFile(input, query) }; }

test("saved comparison verification distinguishes faithful differences from agreeing observations and no coverage", async () => {
  for (const [input, status] of [[changed(), "differences"], [sequenceSet(sequenceHistory([0n, 0n])), "saved-observations-match"], [sequenceSet(), "no-common-coverage"]]) {
    const f = await fixture(input), before = JSON.stringify(input), review = await reviewReportSetEventComparisonFile(input, f.file.text);
    assert.equal(review.matchesRecomputation, true); assert.equal(review.comparisonStatus, status); assert.equal(review.sourceDigestMatches, true);
    assert.equal(review.comparisonTextSha256, createHash("sha256").update(f.file.text).digest("hex"));
    assert.equal(review.containsOriginalEvidence, false); assert.equal(review.authorizesExecution, false);
    assert.ok(Object.isFrozen(review) && Object.isFrozen(review.query) && Object.isFrozen(review.counts));
    assert.doesNotMatch(JSON.stringify(review), /transactionHash|amountBaseUnits|確認用メモ/);
    assert.equal(JSON.stringify(input), before); assert.match(setEventComparisonReviewText(review), /意味とは別/);
  }
});

test("verification ignores JSON key order but binds its receipt to the exact supplied text", async () => {
  const f = await fixture(), original = JSON.parse(f.file.text);
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
  const text = JSON.stringify(reorder(original)), review = await reviewReportSetEventComparisonFile(f.input, text);
  assert.equal(review.matchesRecomputation, true); assert.equal(review.comparisonTextSha256, createHash("sha256").update(text).digest("hex"));
  assert.notEqual(review.comparisonTextSha256, createHash("sha256").update(f.file.text).digest("hex"));
});

test("altered event values, counts, statuses, unknown fields and execution claims cannot pass recomputation", async () => {
  const f = await fixture();
  for (const change of [data => { data.comparison.counts.changed = 0; }, data => { data.comparison.differences[0].after.event.amountBaseUnits = "999"; },
    data => { data.comparison.status = "saved-observations-match"; }, data => { data.comparison.differences = []; },
    data => { data.authenticated = true; }, data => { data.authorizesExecution = true; }, data => { data.SECRET_FIELD = "PRIVATE_VALUE"; }, data => { data.comparison.SECRET_FIELD = "PRIVATE_VALUE"; }]) {
    const data = JSON.parse(f.file.text); change(data); const result = await reviewReportSetEventComparisonFile(f.input, JSON.stringify(data));
    assert.equal(result.matchesRecomputation, false); assert.equal(result.comparisonStatus, "differences");
    assert.doesNotMatch(JSON.stringify(result), /SECRET_FIELD|PRIVATE_VALUE/);
  }
  const altered = clone(f.input); altered.entries[0].note = "PRIVATE_VALUE";
  const result = await reviewReportSetEventComparisonFile(altered, f.file.text);
  assert.equal(result.sourceDigestMatches, false); assert.ok(result.differences.includes("sourcePayloadDigest")); assert.equal(result.matchesRecomputation, false);
});

test("invalid comparison files and pairs fail before any partial receipt", async () => {
  const f = await fixture();
  for (const text of ["{", "null", "[]", '{"schema":"threecore.saved-event-comparison-file.v1","schema":"x"}', '{"__proto__":{}}',
    JSON.stringify({ schema: "threecore.saved-event-comparison-review.v1" }), " ".repeat(REPORT_SET_EVENT_COMPARISON_LIMIT + 1)]) {
    await assert.rejects(reviewReportSetEventComparisonFile(f.input, text));
  }
  const data = JSON.parse(f.file.text); data.comparison.query.afterId = data.comparison.query.beforeId;
  await assert.rejects(reviewReportSetEventComparisonFile(f.input, JSON.stringify(data)), error => error.code === "PERIOD_SET_EVENT_QUERY");
  const read = await readReportSetEventComparisonText(fileFrom(f.file.text)); assert.equal(read, f.file.text);
  await assert.rejects(readReportSetEventComparisonText(new File([new Uint8Array([0xc3, 0x28])], "bad.json")), error => error.code === "PERIOD_SET_EVENT_FILE_ENCODING");
});

test("verification captures source and options before digest waits and honors aborted work", async () => {
  const f = await fixture(), input = clone(f.input), started = deferred(), gate = deferred();
  const pending = reviewReportSetEventComparisonFile(input, f.file.text, { subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; input.entries[0].note = "changed during wait"; gate.resolve();
  assert.equal((await pending).matchesRecomputation, true);
  const abort = new AbortController(); abort.abort(); await assert.rejects(reviewReportSetEventComparisonFile(f.input, f.file.text, { signal: abort.signal }));
  let calls = 0; await assert.rejects(reviewReportSetEventComparisonFile(f.input, f.file.text, { get subtle() { calls++; return crypto.subtle; } })); assert.equal(calls, 0);
});

async function ready(options = {}) {
  const f = await fixture(), store = historyMemory(), controller = createReportSetController({ storage: store.storage, ...options });
  await controller.importFile(fileFrom((await prepareReportSetFile(f.input)).text)); await controller.applyReview();
  await controller.importFile(fileFrom((await prepareReportSetFile(sequenceSet())).text));
  return { ...f, store, controller };
}
test("review and receipt keep accepted and pending sources, preserve last successful review on bad files, and clear it on apply", async () => {
  const f = await ready(), c = f.controller, accepted = c.state.input, pending = c.state.review, files = [];
  try {
    assert.equal(await c.reviewEventComparisonFile(fileFrom(f.file.text)), true); const review = c.state.eventComparisonReview;
    assert.equal(c.state.input, accepted); assert.equal(c.state.review, pending); assert.equal(c.state.phase, "review");
    assert.equal(await c.exportEventComparisonReview(false, file => files.push(file)), false);
    assert.equal(await c.exportEventComparisonReview(true, () => false), false);
    assert.equal(await c.exportEventComparisonReview(true, file => files.push(file)), true); assert.deepEqual(JSON.parse(files[0].text), review);
    assert.equal(await c.reviewEventComparisonFile(fileFrom("{")), false); assert.equal(c.state.eventComparisonReview, review);
    assert.equal(c.state.input, accepted); assert.equal(c.state.review, pending); assert.equal(f.store.calls.length, 0);
    assert.equal(await c.applyReview(), true); assert.equal(c.state.eventComparisonReview, null);
  } finally { c.dispose(); }
});

test("cancelled reads, disposed receivers and asynchronous delivery cannot publish successful reviews", async () => {
  for (const action of ["cancel", "dispose"]) {
    const gate = deferred(), f = await ready({ readEventComparisonText: () => gate.promise }), c = f.controller;
    const pending = c.reviewEventComparisonFile({}); assert.equal(c.state.busy, true); c[action](); gate.resolve(f.file.text);
    assert.equal(await pending, false); assert.equal(c.state.eventComparisonReview, null); c.dispose();
  }
  const f = await ready();
  try { await f.controller.reviewEventComparisonFile(fileFrom(f.file.text));
    assert.equal(await f.controller.exportEventComparisonReview(true, () => Promise.reject(Error("PRIVATE"))), false);
    assert.equal(f.controller.state.error, "PERIOD_ASYNC_DELIVERY");
  } finally { f.controller.dispose(); }
});
