import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareReportSetComparisonFile, reviewReportSetComparisonFile, readReportSetComparisonText, REPORT_SET_COMPARISON_LIMIT } from "../src/report-set-export.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { setComparisonReviewText } from "../src/report-set-view.js";
import { sequenceSet, demoSetHistory, sequenceHistory, clone, historyMemory, fileFrom, deferred, id } from "./helpers/report-set-fixtures.js";

async function fixture() {
  const before = sequenceSet(), after = sequenceSet(demoSetHistory());
  return { before, after, file: await prepareReportSetComparisonFile(before, after) };
}
test("a faithful saved comparison matches recomputation even though the originals differ", async () => {
  const f = await fixture(), result = await reviewReportSetComparisonFile(f.before, f.after, f.file.text);
  assert.equal(result.matchesRecomputation, true); assert.equal(result.sameContents, false);
  assert.equal(result.beforeDigestMatches, true); assert.equal(result.afterDigestMatches, true);
  assert.equal(result.comparisonTextSha256, createHash("sha256").update(f.file.text).digest("hex"));
  assert.equal(result.afterSummary.allContinuous, false); assert.equal(result.authenticated, false);
  assert.ok(Object.isFrozen(result.counts)); assert.match(setComparisonReviewText(result), /出所の認証や現在のチェーン確認ではありません/);
});
test("object formatting is irrelevant while exact decoded text still has its own digest", async () => {
  const f = await fixture(), original = JSON.parse(f.file.text);
  const reorder = value => Array.isArray(value) ? value.map(reorder) : value && typeof value === "object" ?
    Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reorder(v)])) : value;
  const text = JSON.stringify(reorder(original)), result = await reviewReportSetComparisonFile(f.before, f.after, text);
  assert.equal(result.matchesRecomputation, true); assert.equal(result.comparisonTextSha256, createHash("sha256").update(text).digest("hex"));
  assert.notEqual(result.comparisonTextSha256, createHash("sha256").update(f.file.text).digest("hex"));
});
test("nested conclusions, removed rows, unknown fields and assertions cannot be trusted", async () => {
  const f = await fixture();
  for (const change of [value => { value.comparison.counts.added = 0; }, value => { value.comparison.rows.pop(); },
    value => { value.comparison.rows.reverse(); }, value => { value.comparison.privateField = "SECRET_EXTRA_VALUE"; },
    value => { value.authenticated = true; }, value => { delete value.restorable; }, value => { value.SECRET_FIELD_NAME = "SECRET_EXTRA_VALUE"; }]) {
    const data = JSON.parse(f.file.text); change(data);
    const result = await reviewReportSetComparisonFile(f.before, f.after, JSON.stringify(data));
    assert.equal(result.matchesRecomputation, false); assert.doesNotMatch(JSON.stringify(result), /SECRET_FIELD_NAME|SECRET_EXTRA_VALUE/);
    assert.doesNotMatch(setComparisonReviewText(result), /SECRET_FIELD_NAME|SECRET_EXTRA_VALUE/);
  }
});
test("reversed or different original sources are detected even when the comparison shape is similar", async () => {
  const f = await fixture(), reversed = await reviewReportSetComparisonFile(f.after, f.before, f.file.text);
  assert.equal(reversed.beforeDigestMatches, false); assert.equal(reversed.afterDigestMatches, false); assert.equal(reversed.matchesRecomputation, false);
  const edited = clone(f.after); edited.entries[0].note = "Not included in comparison fields";
  const result = await reviewReportSetComparisonFile(f.before, edited, f.file.text);
  assert.equal(result.beforeDigestMatches, true); assert.equal(result.afterDigestMatches, false);
  assert.ok(result.differences.includes("afterPayloadDigest")); assert.equal(result.matchesRecomputation, false);
});
test("malformed, duplicate-key, unsafe, oversized and wrong-schema comparison files fail closed", async () => {
  const f = await fixture();
  for (const text of ["{", "null", "[]", '{"schema":"threecore.report-set-comparison-file.v1","schema":"threecore.report-set-comparison-file.v1"}',
    '{"__proto__":{}}', JSON.stringify({ schema: "threecore.report-set-comparison-review.v1" }), " ".repeat(REPORT_SET_COMPARISON_LIMIT + 1)]) {
    await assert.rejects(reviewReportSetComparisonFile(f.before, f.after, text), error => /^PERIOD_SET_COMPARISON_(JSON|SCHEMA)$/.test(error.code));
  }
});
test("review captures both originals before asynchronous digest work and observes cancellation", async () => {
  const f = await fixture(), before = clone(f.before), after = clone(f.after), started = deferred(), gate = deferred();
  const pending = reviewReportSetComparisonFile(before, after, f.file.text, { subtle: { digest(...args) {
    started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args));
  } } });
  await started.promise; before.title = "later"; after.title = "later"; gate.resolve();
  assert.equal((await pending).matchesRecomputation, true);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(reviewReportSetComparisonFile(f.before, f.after, f.file.text, { signal: abort.signal }));
});
test("comparison file reading retains native UTF-8 and bounded-file rules", async () => {
  const f = await fixture(); assert.equal(await readReportSetComparisonText(fileFrom(f.file.text)), f.file.text);
  await assert.rejects(readReportSetComparisonText(new File([new Uint8Array([0xc3, 0x28])], "broken.json")), error => error.code === "PERIOD_SET_COMPARISON_ENCODING");
  await assert.rejects(readReportSetComparisonText(new File([" ".repeat(REPORT_SET_COMPARISON_LIMIT + 1)], "big.json")), error => error.code === "PERIOD_SET_COMPARISON_SIZE");
});
async function ready(options = {}) {
  const f = await fixture(), store = historyMemory(sequenceHistory()), controller = createReportSetController({ storage: store.storage, ...options });
  await controller.importFile(fileFrom((await prepareReportSetFile(f.before)).text)); await controller.applyReview();
  await controller.importFile(fileFrom((await prepareReportSetFile(f.after)).text));
  return { ...f, store, controller };
}
test("screen review and its saved receipt preserve the pending candidate and accepted source", async () => {
  const f = await ready(), c = f.controller, before = c.state.input, pending = c.state.review, saved = JSON.stringify(f.store.document), files = [];
  try {
    assert.equal(await c.reviewComparisonFile(fileFrom(f.file.text)), true); const result = c.state.comparisonReview;
    assert.equal(result.matchesRecomputation, true); assert.equal(c.state.review, pending); assert.equal(c.state.input, before);
    assert.equal(c.state.phase, "review"); assert.equal(await c.exportComparisonReview(false, file => files.push(file)), false);
    assert.equal(await c.exportComparisonReview(true, () => false), false);
    assert.equal(await c.exportComparisonReview(true, file => files.push(file)), true); assert.equal(c.state.phase, "review");
    assert.deepEqual(JSON.parse(files[0].text), result); assert.equal(files[0].restorable, false);
    assert.equal(await c.reviewComparisonFile(fileFrom("{")), false); assert.equal(c.state.comparisonReview, result);
    assert.match(setComparisonReviewText(c.state.comparisonReview), /最後に完了した/);
    assert.equal(JSON.stringify(f.store.document), saved); assert.ok(f.store.calls.every(row => row[0] === "read"));
    await c.applyReview(); assert.equal(c.state.comparisonReview, null); assert.equal(c.state.input.entries.length, 7);
  } finally { c.dispose(); }
});
test("changing, cancelling and replacing a candidate clear the pair-bound result", async () => {
  const f = await ready(), c = f.controller;
  try {
    await c.reviewComparisonFile(fileFrom(f.file.text)); c.invalidateReview(); assert.equal(c.state.comparisonReview, null);
    assert.equal(await c.exportComparisonReview(true, () => {}), false);
    await c.importFile(fileFrom((await prepareReportSetFile(f.after)).text)); await c.reviewComparisonFile(fileFrom(f.file.text));
    await c.importFile(fileFrom("{")); assert.equal(c.state.comparisonReview, null);
    await c.refresh(); c.select([id(101), id(102)]); c.prepare("Candidate"); c.cancel(); assert.equal(c.state.comparisonReview, null);
  } finally { c.dispose(); }
});
test("late comparison-file reads and rejected asynchronous delivery cannot report success", async () => {
  const gate = deferred(), f = await ready({ readComparisonText: () => gate.promise }), c = f.controller;
  const pending = c.reviewComparisonFile({}); assert.equal(c.state.busy, true); c.cancel(); gate.resolve(f.file.text);
  assert.equal(await pending, false); assert.equal(c.state.comparisonReview, null); assert.equal(c.state.input.entries.length, 3); c.dispose();
  const g = await ready(); try { await g.controller.reviewComparisonFile(fileFrom(g.file.text));
    assert.equal(await g.controller.exportComparisonReview(true, () => Promise.reject(Error("PRIVATE"))), false);
    assert.equal(g.controller.state.error, "PERIOD_ASYNC_DELIVERY");
  } finally { g.controller.dispose(); }
});
