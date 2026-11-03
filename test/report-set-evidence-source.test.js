import test from "node:test";
import assert from "node:assert/strict";
import { prepareReportSetComparisonEvidenceFile, reviewReportSetComparisonEvidence,
  prepareComparisonEvidenceSourceFile } from "../src/report-set-export.js";
import { prepareReportSetFile, decodeReportSetFile } from "../src/report-set-file.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { sequenceSet, demoSetHistory, historyMemory, clone, fileFrom } from "./helpers/report-set-fixtures.js";

async function fixture() {
  const before = clone(sequenceSet()), after = sequenceSet(demoSetHistory());
  before.entries[0].note = "PRIVATE_RECOVERY_NOTE";
  const file = await prepareReportSetComparisonEvidenceFile(before, after);
  return { before, after, file, data: JSON.parse(file.text), review: await reviewReportSetComparisonEvidence(file.text) };
}
test("both embedded originals can be recovered with their exact stored text and validated digest", async () => {
  const f = await fixture();
  for (const role of ["before", "after"]) {
    const file = prepareComparisonEvidenceSourceFile(f.review, role), decoded = await decodeReportSetFile(file.text);
    assert.equal(file.text, f.data[role + "FileText"]); assert.deepEqual(decoded.input, f[role]);
    assert.equal(file.sourcePayloadDigest, (await prepareReportSetFile(f[role])).digest);
    assert.equal(file.byteLength, Buffer.byteLength(file.text)); assert.equal(file.evidenceTextSha256, f.review.evidenceTextSha256);
    assert.equal(file.restorable, true); assert.equal(file.containsOriginalEvidence, true); assert.equal(file.encrypted, false);
    assert.equal(file.authenticated, false); assert.match(file.filename, new RegExp("recovered-" + role + "-report-set\\.json$"));
  }
  assert.match(prepareComparisonEvidenceSourceFile(f.review, "before").text, /PRIVATE_RECOVERY_NOTE/);
  assert.doesNotMatch(JSON.stringify(f.review), /PRIVATE_RECOVERY_NOTE/);
});
test("serialized, cloned, forged and proxy receipts never authorize source recovery", async () => {
  const f = await fixture(); let touched = 0;
  for (const value of [null, undefined, 7, "x", {}, clone(f.review), Object.freeze({ ...f.review }),
    new Proxy(f.review, { get() { touched++; throw Error("PRIVATE"); } })]) {
    assert.throws(() => prepareComparisonEvidenceSourceFile(value, "before"), error => error.code === "PERIOD_SET_EVIDENCE_SOURCE_REVIEW");
  }
  for (const role of [null, "", "BEFORE", "../before", { toString() { touched++; } }])
    assert.throws(() => prepareComparisonEvidenceSourceFile(f.review, role), error => error.code === "PERIOD_SET_EVIDENCE_SOURCE_ROLE");
  assert.equal(touched, 0);
});
test("valid original recovery does not turn an altered comparison into a match", async () => {
  const f = await fixture(), changed = JSON.parse(f.data.comparisonText); changed.comparison.rows = [];
  f.data.comparisonText = JSON.stringify(changed);
  const review = await reviewReportSetComparisonEvidence(JSON.stringify(f.data));
  for (const role of ["before", "after"]) {
    const file = prepareComparisonEvidenceSourceFile(review, role);
    assert.equal(file.comparisonMatchesRecomputation, false); assert.equal(file.text, f.data[role + "FileText"]);
  }
  assert.equal(review.comparisonReview.matchesRecomputation, false);
});
test("recovery preserves embedded whitespace rather than regenerating original file bytes", async () => {
  const f = await fixture(); f.data.beforeFileText = " \n" + JSON.stringify(JSON.parse(f.data.beforeFileText)) + "\n  ";
  const review = await reviewReportSetComparisonEvidence(JSON.stringify(f.data));
  assert.equal(prepareComparisonEvidenceSourceFile(review, "before").text, f.data.beforeFileText);
});
test("controller source recovery needs its own acknowledgement and changes neither accepted source nor candidate", async () => {
  const f = await fixture(), store = historyMemory(), c = createReportSetController({ storage: store.storage }), files = [];
  try {
    assert.equal(await c.exportEvidenceSource("before", true, file => files.push(file)), false);
    await c.importFile(fileFrom((await prepareReportSetFile(f.before)).text)); await c.applyReview();
    await c.importFile(fileFrom((await prepareReportSetFile(f.after)).text));
    const accepted = c.state.input, pending = c.state.review;
    await c.reviewComparisonEvidenceFile(fileFrom(f.file.text));
    assert.equal(await c.exportEvidenceSource("before", false, file => files.push(file)), false);
    assert.equal(await c.exportEvidenceSource("before", true, () => false), false);
    assert.equal(await c.exportEvidenceSource("before", true, () => Promise.reject(Error("PRIVATE"))), false);
    assert.equal(c.state.error, "PERIOD_ASYNC_DELIVERY");
    assert.equal(await c.exportEvidenceSource("before", true, file => files.push(file)), true);
    assert.equal(files.length, 1); assert.equal(files[0].text, f.data.beforeFileText);
    assert.equal(c.state.input, accepted); assert.equal(c.state.review, pending); assert.equal(c.state.phase, "review");
    assert.equal(store.calls.length, 0);
    await c.reviewComparisonEvidenceFile(fileFrom("{"));
    assert.equal(await c.exportEvidenceSource("after", true, file => files.push(file)), true);
    assert.equal(files[1].text, f.data.afterFileText); assert.equal(store.calls.length, 0);
  } finally { c.dispose(); }
});
test("cancel or disposal during recovery announcement prevents a late download", async () => {
  const f = await fixture();
  for (const stop of ["cancel", "dispose"]) {
    let c, armed = false, delivered = 0;
    c = createReportSetController({ storage: historyMemory().storage, onChange(state) {
      if (armed && state.phase === "exporting") c[stop]();
    } });
    await c.reviewComparisonEvidenceFile(fileFrom(f.file.text)); armed = true;
    assert.equal(await c.exportEvidenceSource("before", true, () => delivered++), false);
    assert.equal(delivered, 0); assert.equal(c.state.input, null); c.dispose();
  }
});
