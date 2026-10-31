import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareReportSetCoverageFile, reviewReportSetCoverageFile, readReportSetCoverageText, REPORT_SET_COVERAGE_LIMIT, prepareReportSetEventComparisonFile } from "../src/report-set-export.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { setCoverageReviewText } from "../src/report-set-view.js";
import { sequenceSet, sequenceHistory, historyMemory, clone, id, fileFrom, deferred } from "./helpers/report-set-fixtures.js";
const source = () => sequenceSet(sequenceHistory([0n, 24n], report => { report.slots[0].entry.draft.records = report.slots[0].entry.draft.records.slice(0, 1); }));
async function fixture(input = source(), shortAddresses = true) { return { input, file: await prepareReportSetCoverageFile(input, "json", { shortAddresses }) }; }

test("faithful partial coverage passes file verification while keeping pending and unplanned blocks separate by group", async () => {
  for (const shortAddresses of [true, false]) {
    const f = await fixture(source(), shortAddresses), before = JSON.stringify(f.input), result = await reviewReportSetCoverageFile(f.input, f.file.text);
    assert.equal(result.matchesRecomputation, true); assert.equal(result.sourceDigestMatches, true); assert.equal(result.completeHistory, false);
    assert.equal(result.groupCount, 3); assert.equal(result.options.shortAddresses, shortAddresses); assert.equal(result.blockCountsCombinedAcrossGroups, false);
    assert.equal(result.groups[0].recordedUniqueBlocks, "10"); assert.equal(result.groups[0].pendingPlannedBlocks, "14"); assert.equal(result.groups[0].unplannedBlocks, "12");
    assert.equal(result.groups[1].recordedUniqueBlocks, "24"); assert.equal(result.groups[1].pendingPlannedBlocks, "0"); assert.equal(result.groups[1].unplannedBlocks, "12");
    assert.equal(result.coverageTextSha256, createHash("sha256").update(f.file.text).digest("hex"));
    assert.ok(Object.isFrozen(result.groups) && Object.isFrozen(result.groups[0])); assert.equal(JSON.stringify(f.input), before);
    assert.doesNotMatch(JSON.stringify(result), /transactionHash|amountBaseUnits|確認用メモ|"account"|"tokenAddress"/);
    assert.match(setCoverageReviewText(result), /全履歴の取得完了を意味しません/);
  }
});

test("coverage receipts preserve exact large endpoints and source review counts", async () => {
  const offset = 2n ** 60n, input = clone(sequenceSet(sequenceHistory([offset])));
  input.entries[0].report.slots[0].entry.requiresNewPlan = true;
  const f = await fixture(input), result = await reviewReportSetCoverageFile(input, f.file.text);
  assert.equal(result.groups[0].fromBlock, String(offset + 31n)); assert.equal(result.groups[0].toBlock, String(offset + 42n));
  assert.ok(BigInt(result.groups[0].reviewRecordedBlocks) > 0n); assert.equal(result.summary.allContinuous, false);
});

test("changed ranges, source references, counts, grouping and completeness claims are detected", async () => {
  const f = await fixture();
  for (const change of [data => { data.groups[0].recordedUniqueBlocks = "24"; }, data => { data.groups[0].cells[0].toBlock = "34"; },
    data => { data.groups[0].cells[0].records[0].recordIndex = 99; }, data => { data.groups.pop(); }, data => { data.groups.reverse(); },
    data => { data.completeHistory = true; }, data => { data.blockCountsCombinedAcrossGroups = true; },
    data => { data.options.shortAddresses = false; }, data => { data.SECRET_NAME = "PRIVATE_VALUE"; }, data => { data.groups[0].SECRET_NAME = "PRIVATE_VALUE"; }]) {
    const data = JSON.parse(f.file.text); change(data); const result = await reviewReportSetCoverageFile(f.input, JSON.stringify(data));
    assert.equal(result.matchesRecomputation, false); assert.equal(result.groups[0].recordedUniqueBlocks, "10");
    assert.doesNotMatch(JSON.stringify(result), /SECRET_NAME|PRIVATE_VALUE/);
  }
  const altered = clone(f.input); altered.entries[0].note = "PRIVATE_VALUE";
  const mismatch = await reviewReportSetCoverageFile(altered, f.file.text); assert.equal(mismatch.sourceDigestMatches, false); assert.ok(mismatch.differences.includes("sourcePayloadDigest"));
});

test("JSON key order is irrelevant but exact input text remains fingerprinted", async () => {
  const f = await fixture(), parsed = JSON.parse(f.file.text);
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
  const text = JSON.stringify(reorder(parsed)), review = await reviewReportSetCoverageFile(f.input, text);
  assert.equal(review.matchesRecomputation, true); assert.equal(review.coverageTextSha256, createHash("sha256").update(text).digest("hex"));
});

test("invalid coverage JSON, display options, encoding and oversized inputs fail without a receipt", async () => {
  const f = await fixture();
  for (const text of ["{", "null", "[]", '{"schema":"threecore.report-set-history-coverage.v1","schema":"x"}', '{"__proto__":{}}',
    JSON.stringify({ schema: "threecore.report-set-history-coverage-review.v1" }), " ".repeat(REPORT_SET_COVERAGE_LIMIT + 1)]) await assert.rejects(reviewReportSetCoverageFile(f.input, text));
  for (const options of [undefined, null, [], { shortAddresses: "true" }, { shortAddresses: true, includeNotes: true }]) {
    const data = JSON.parse(f.file.text); data.options = options;
    await assert.rejects(reviewReportSetCoverageFile(f.input, JSON.stringify(data)), error => error.code === "PERIOD_SET_COVERAGE_OPTIONS");
  }
  assert.equal(await readReportSetCoverageText(fileFrom(f.file.text)), f.file.text);
  await assert.rejects(readReportSetCoverageText(new File([new Uint8Array([0xc3, 0x28])], "bad.json")), error => error.code === "PERIOD_SET_COVERAGE_ENCODING");
  await assert.rejects(readReportSetCoverageText(new File(["x".repeat(REPORT_SET_COVERAGE_LIMIT + 1)], "big.json")), error => error.code === "PERIOD_SET_COVERAGE_SIZE");
});

test("source capture and cancellation remain effective across asynchronous digest work", async () => {
  const f = await fixture(), input = clone(f.input), started = deferred(), gate = deferred();
  const pending = reviewReportSetCoverageFile(input, f.file.text, { subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; input.title = "changed later"; gate.resolve(); assert.equal((await pending).matchesRecomputation, true);
  const abort = new AbortController(); abort.abort(); await assert.rejects(reviewReportSetCoverageFile(f.input, f.file.text, { signal: abort.signal }));
  let calls = 0; await assert.rejects(reviewReportSetCoverageFile(f.input, f.file.text, { get subtle() { calls++; return crypto.subtle; } })); assert.equal(calls, 0);
});

async function ready(options = {}) {
  const f = await fixture(), store = historyMemory(), controller = createReportSetController({ storage: store.storage, ...options });
  await controller.importFile(fileFrom((await prepareReportSetFile(f.input)).text)); await controller.applyReview();
  await controller.importFile(fileFrom((await prepareReportSetFile(sequenceSet())).text));
  return { ...f, store, controller };
}
test("coverage review and receipt preserve both accepted and pending sources and other completed reviews", async () => {
  const f = await ready(), c = f.controller, accepted = c.state.input, pending = c.state.review, files = [];
  try {
    const comparison = await prepareReportSetEventComparisonFile(f.input, { beforeId: id(101), afterId: id(102), agent: "DAT" });
    await c.reviewEventComparisonFile(fileFrom(comparison.text)); const other = c.state.eventComparisonReview;
    assert.equal(await c.reviewCoverageFile(fileFrom(f.file.text)), true); const review = c.state.coverageReview;
    assert.equal(c.state.input, accepted); assert.equal(c.state.review, pending); assert.equal(c.state.eventComparisonReview, other);
    assert.equal(await c.exportCoverageReview(false, file => files.push(file)), false);
    assert.equal(await c.exportCoverageReview(true, () => false), false);
    assert.equal(await c.exportCoverageReview(true, file => files.push(file)), true); assert.deepEqual(JSON.parse(files[0].text), review);
    assert.equal(await c.reviewCoverageFile(fileFrom("{")), false); assert.equal(c.state.coverageReview, review); assert.equal(c.state.review, pending);
    assert.equal(f.store.calls.length, 0); await c.applyReview(); assert.equal(c.state.coverageReview, null); assert.equal(c.state.eventComparisonReview, null);
  } finally { c.dispose(); }
});

test("stopped reads, disposed controllers and asynchronous receipt callbacks cannot report success", async () => {
  for (const action of ["cancel", "dispose"]) {
    const gate = deferred(), f = await ready({ readCoverageText: () => gate.promise }), c = f.controller;
    const pending = c.reviewCoverageFile({}); assert.equal(c.state.busy, true); c[action](); gate.resolve(f.file.text);
    assert.equal(await pending, false); assert.equal(c.state.coverageReview, null); c.dispose();
  }
  const f = await ready(); try {
    await f.controller.reviewCoverageFile(fileFrom(f.file.text));
    assert.equal(await f.controller.exportCoverageReview(true, () => Promise.reject(Error("PRIVATE"))), false);
    assert.equal(f.controller.state.error, "PERIOD_ASYNC_DELIVERY");
  } finally { f.controller.dispose(); }
});
