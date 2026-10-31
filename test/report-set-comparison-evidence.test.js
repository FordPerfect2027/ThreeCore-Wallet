import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareReportSetComparisonEvidenceFile, reviewReportSetComparisonEvidence, readReportSetComparisonEvidenceText,
  prepareReportSetComparisonFile, REPORT_SET_COMPARISON_EVIDENCE_LIMIT } from "../src/report-set-export.js";
import { prepareReportSetFile, decodeReportSetFile } from "../src/report-set-file.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { sequenceSet, demoSetHistory, historyMemory, sequenceHistory, clone, fileFrom, deferred } from "./helpers/report-set-fixtures.js";

async function fixture() {
  const before = sequenceSet(), after = sequenceSet(demoSetHistory());
  return { before, after, file: await prepareReportSetComparisonEvidenceFile(before, after) };
}
test("comparison evidence contains two reloadable canonical originals and the exact shared comparison", async () => {
  const f = await fixture(), data = JSON.parse(f.file.text);
  assert.equal(data.beforeFileText, (await prepareReportSetFile(f.before)).text);
  assert.equal(data.afterFileText, (await prepareReportSetFile(f.after)).text);
  assert.equal(data.comparisonText, (await prepareReportSetComparisonFile(f.before, f.after)).text);
  assert.deepEqual((await decodeReportSetFile(data.beforeFileText)).input, f.before);
  assert.deepEqual((await decodeReportSetFile(data.afterFileText)).input, f.after);
  assert.equal(f.file.containsOriginalEvidence, true); assert.equal(f.file.encrypted, false);
  assert.equal(f.file.sourceTextFormat, "canonical-export-not-original-upload-bytes");
  const result = await reviewReportSetComparisonEvidence(f.file.text);
  assert.equal(result.beforeChecksumVerified, true); assert.equal(result.afterChecksumVerified, true);
  assert.equal(result.comparisonReview.matchesRecomputation, true); assert.equal(result.comparisonReview.sameContents, false);
  assert.equal(result.evidenceTextSha256, createHash("sha256").update(f.file.text).digest("hex"));
  assert.equal(result.imported, false); assert.equal(result.authorizesExecution, false); assert.ok(Object.isFrozen(result.comparisonReview));
});
test("modified comparison conclusions are reported even when both embedded originals remain valid", async () => {
  const f = await fixture(), data = JSON.parse(f.file.text), comparison = JSON.parse(data.comparisonText);
  comparison.comparison.counts.added = 0; data.comparisonText = JSON.stringify(comparison);
  const result = await reviewReportSetComparisonEvidence(JSON.stringify(data));
  assert.equal(result.comparisonReview.matchesRecomputation, false); assert.ok(result.comparisonReview.differences.includes("comparison"));
  assert.equal(result.beforeChecksumVerified, true); assert.equal(result.imported, false);
  const swapped = JSON.parse(f.file.text); [swapped.beforeFileText, swapped.afterFileText] = [swapped.afterFileText, swapped.beforeFileText];
  const reversed = await reviewReportSetComparisonEvidence(JSON.stringify(swapped)); assert.equal(reversed.comparisonReview.beforeDigestMatches, false);
});
test("embedded checksum corruption and invalid envelope claims fail without a successful review", async () => {
  const f = await fixture(), data = JSON.parse(f.file.text), before = JSON.parse(data.beforeFileText);
  before.input.title = "Modified without checksum"; data.beforeFileText = JSON.stringify(before);
  await assert.rejects(reviewReportSetComparisonEvidence(JSON.stringify(data)), error => error.code === "PERIOD_CHECKSUM");
  for (const change of [value => { value.authenticated = true; }, value => { value.authorizesExecution = true; },
    value => { value.extra = "PRIVATE"; }, value => { delete value.afterFileText; }, value => { value.beforeFileText = {}; }]) {
    const copy = JSON.parse(f.file.text); change(copy);
    await assert.rejects(reviewReportSetComparisonEvidence(JSON.stringify(copy)), error => error.code === "PERIOD_SET_EVIDENCE_FORMAT");
  }
  for (const text of ["{", "[]", "null", '{"schema":"a","schema":"b"}', '{"__proto__":{}}', " ".repeat(REPORT_SET_COMPARISON_EVIDENCE_LIMIT + 1)])
    await assert.rejects(reviewReportSetComparisonEvidence(text), error => error.code === "PERIOD_SET_EVIDENCE_FORMAT");
});
test("full source notes are preserved in evidence but excluded from the verification receipt", async () => {
  const before = clone(sequenceSet()); before.entries[0].note = "ORIGINAL_PRIVATE_NOTE";
  const file = await prepareReportSetComparisonEvidenceFile(before, sequenceSet(demoSetHistory()));
  assert.match(file.text, /ORIGINAL_PRIVATE_NOTE/);
  assert.doesNotMatch(JSON.stringify(await reviewReportSetComparisonEvidence(file.text)), /ORIGINAL_PRIVATE_NOTE|balanceBaseUnits|transactionHash/);
});
test("the bundle, its review receipt and individual sources explain their different input destinations", async () => {
  const f = await fixture();
  await assert.rejects(decodeReportSetFile(f.file.text), error => error.code === "PERIOD_FILE_USE_EVIDENCE");
  const review = await reviewReportSetComparisonEvidence(f.file.text);
  await assert.rejects(reviewReportSetComparisonEvidence(JSON.stringify(review)), error => error.code === "PERIOD_FILE_EVIDENCE_REVIEW_ONLY");
  await assert.rejects(reviewReportSetComparisonEvidence((await prepareReportSetFile(f.before)).text), error => error.code === "PERIOD_FILE_USE_SET");
});
test("sources are captured before asynchronous work and cancellation stops the evidence pipeline", async () => {
  const before = clone(sequenceSet()), after = clone(sequenceSet(demoSetHistory())), gate = deferred(), started = deferred();
  const pending = prepareReportSetComparisonEvidenceFile(before, after, { subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; before.title = "LATE_BEFORE"; after.title = "LATE_AFTER"; gate.resolve();
  const file = await pending; assert.doesNotMatch(file.text, /LATE_BEFORE|LATE_AFTER/);
  const abort = new AbortController(); abort.abort(); await assert.rejects(reviewReportSetComparisonEvidence(file.text, { signal: abort.signal }));
  await assert.rejects(prepareReportSetComparisonEvidenceFile(sequenceSet(), sequenceSet(), { signal: abort.signal }));
});
test("native evidence file reading uses strict encoding and does not accept a large or empty input", async () => {
  const f = await fixture(); assert.equal(await readReportSetComparisonEvidenceText(fileFrom(f.file.text)), f.file.text);
  await assert.rejects(readReportSetComparisonEvidenceText(new File([new Uint8Array([0xc3, 0x28])], "bad.json")), error => error.code === "PERIOD_SET_EVIDENCE_ENCODING");
  await assert.rejects(readReportSetComparisonEvidenceText(new File([], "empty.json")), error => error.code === "PERIOD_SET_EVIDENCE_SIZE");
});
test("evidence can be checked and its receipt saved without any accepted set or storage reads", async () => {
  const f = await fixture(), store = historyMemory(sequenceHistory()), c = createReportSetController({ storage: store.storage }), files = [];
  try {
    assert.equal(await c.reviewComparisonEvidenceFile(fileFrom(f.file.text)), true); assert.equal(c.state.input, null); assert.equal(c.state.phase, "idle");
    assert.equal(c.state.evidenceReview.comparisonReview.matchesRecomputation, true); assert.equal(store.calls.length, 0);
    assert.equal(await c.exportEvidenceReview(false, file => files.push(file)), false);
    assert.equal(await c.exportEvidenceReview(true, file => files.push(file)), true); assert.equal(files[0].containsOriginalEvidence, false);
    assert.deepEqual(JSON.parse(files[0].text), c.state.evidenceReview); const result = c.state.evidenceReview;
    assert.equal(await c.reviewComparisonEvidenceFile(fileFrom("{")), false); assert.equal(c.state.evidenceReview, result);
    assert.equal(c.state.input, null); assert.equal(store.calls.length, 0);
  } finally { c.dispose(); }
});
test("paired evidence export preserves the pending review and original stored records", async () => {
  const f = await fixture(), store = historyMemory(sequenceHistory()), c = createReportSetController({ storage: store.storage }), files = [];
  try {
    await c.importFile(fileFrom((await prepareReportSetFile(f.before)).text)); await c.applyReview();
    await c.importFile(fileFrom((await prepareReportSetFile(f.after)).text)); const before = c.state.input, pending = c.state.review;
    assert.equal(await c.exportComparisonEvidence(false, file => files.push(file)), false);
    assert.equal(await c.exportComparisonEvidence(true, () => false), false);
    assert.equal(await c.exportComparisonEvidence(true, file => files.push(file)), true);
    assert.equal(files[0].containsOriginalEvidence, true); assert.equal(c.state.input, before); assert.equal(c.state.review, pending); assert.equal(c.state.phase, "review");
    assert.ok(store.calls.every(row => row[0] === "read"));
    assert.equal(await c.exportComparisonEvidence(true, () => Promise.reject(Error("PRIVATE"))), false); assert.equal(c.state.error, "PERIOD_ASYNC_DELIVERY");
  } finally { c.dispose(); }
});
test("late evidence reads cannot overwrite state after cancellation or disposal", async () => {
  const f = await fixture();
  for (const stop of ["cancel", "dispose"]) {
    const gate = deferred(), c = createReportSetController({ storage: historyMemory(sequenceHistory()).storage, readEvidenceText: () => gate.promise });
    const pending = c.reviewComparisonEvidenceFile({}); c[stop](); gate.resolve(f.file.text);
    assert.equal(await pending, false); assert.equal(c.state.evidenceReview, null); assert.equal(c.state.input, null); c.dispose();
  }
});
