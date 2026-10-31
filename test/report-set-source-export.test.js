import test from "node:test";
import assert from "node:assert/strict";
import { prepareReportSetSourceFile } from "../src/report-set-export.js";
import { preparePeriodReportFile, decodePeriodReportFile } from "../src/period-report-file.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { sequenceSet, sequenceHistory, historyMemory, clone, id, AFTER, deferred } from "./helpers/report-set-fixtures.js";

test("each selected source is extracted byte-for-byte in the existing period-report format", async () => {
  const input = sequenceSet(), before = JSON.stringify(input);
  for (const entry of input.entries) {
    const file = await prepareReportSetSourceFile(input, entry.id), expected = await preparePeriodReportFile(entry.report);
    assert.equal(file.text, expected.text); assert.equal(file.digest, expected.digest);
    assert.deepEqual((await decodePeriodReportFile(file.text)).input, entry.report);
    assert.equal(file.sourceReportId, entry.id); assert.equal(file.sourceReportLabel, entry.label);
    assert.equal(file.filename, "ThreeCore-period-report-" + entry.id + ".json");
    assert.equal(file.containsOriginalEvidence, true); assert.equal(file.encrypted, false); assert.equal(file.authenticated, false);
    assert.ok(file.text.includes(entry.report.slots[0].entry.draft.plan.context.account));
  }
  assert.equal(JSON.stringify(input), before);
});
test("invalid or absent report IDs cannot select data outside the accepted set", async () => {
  const input = sequenceSet(); let touched = 0;
  for (const value of ["../../PRIVATE", "", null, { toString() { touched++; return input.entries[0].id; } }]) await assert.rejects(prepareReportSetSourceFile(input, value));
  await assert.rejects(prepareReportSetSourceFile(input, id(999)), { code: "PERIOD_SET_REPORT_MISSING" }); assert.equal(touched, 0);
});
test("mutable caller evidence is captured before hashing and unsafe labels never enter filenames", async () => {
  const input = clone(sequenceSet()), chosen = input.entries[0]; chosen.label = "<script>label</script>";
  const expected = await preparePeriodReportFile(chosen.report), gate = deferred(), started = deferred();
  const promise = prepareReportSetSourceFile(input, chosen.id, { subtle: { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } } });
  await started.promise; chosen.report.title = "later title"; chosen.label = "later label"; gate.resolve();
  const file = await promise; assert.equal(file.text, expected.text); assert.equal(file.sourceReportLabel, "<script>label</script>");
  assert.doesNotMatch(file.filename, /script|label|[<>]/);
});
async function ready() {
  const history = sequenceHistory(), store = historyMemory(history), controller = createReportSetController({ storage: store.storage, now: () => AFTER });
  await controller.refresh(); controller.select(history.entries.slice(0,2).map(row => row.id)); controller.prepare("Selected originals"); await controller.applyReview();
  return { history, store, controller, dispose: () => controller.dispose() };
}
test("controller exports only accepted sources after acknowledgement and leaves storage unchanged", async () => {
  const f = await ready(), files = [];
  try {
    const selected = f.history.entries[0].id, original = f.controller.state.input, stored = JSON.stringify(f.store.document);
    assert.equal(await f.controller.exportSourceReport(selected, false, file => files.push(file)), false);
    assert.equal(await f.controller.exportSourceReport(f.history.entries[2].id, true, file => files.push(file)), false);
    assert.equal(f.controller.state.error, "PERIOD_SET_REPORT_MISSING"); assert.equal(files.length, 0);
    assert.equal(await f.controller.exportSourceReport(selected, true, file => files.push(file)), true);
    assert.equal(files.length, 1); assert.equal(f.controller.state.input, original); assert.equal(JSON.stringify(f.store.document), stored);
    assert.ok(f.store.calls.every(call => call[0] === "read"));
  } finally { f.dispose(); }
});
test("cancellation and refused or asynchronous delivery cannot publish a successful source export", async () => {
  const f = await ready(), files = [], selected = f.history.entries[0].id;
  try {
    const pending = f.controller.exportSourceReport(selected, true, file => files.push(file)); f.controller.cancel();
    assert.equal(await pending, false); assert.equal(files.length, 0);
    assert.equal(await f.controller.exportSourceReport(selected, true, () => false), false);
    assert.equal(await f.controller.exportSourceReport(selected, true, () => Promise.reject(Error("PRIVATE_REJECT"))), false);
    assert.equal(f.controller.state.error, "PERIOD_ASYNC_DELIVERY");
    assert.equal(await f.controller.exportSourceReport(selected, true, file => files.push(file)), true); assert.equal(files.length, 1);
  } finally { f.dispose(); }
});
test("cancellation inside delivery suppresses the late success receipt without inventing rollback", async () => {
  const f = await ready(), files = [];
  try {
    assert.equal(await f.controller.exportSourceReport(f.history.entries[0].id, true, file => { files.push(file); f.controller.cancel(); }), false);
    assert.equal(files.length, 1); assert.match(f.controller.state.message, /中止/); assert.equal(f.controller.state.busy, false);
    assert.ok((await decodePeriodReportFile(files[0].text)).checksumVerified);
  } finally { f.dispose(); }
});
