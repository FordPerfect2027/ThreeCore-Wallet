import test from "node:test";
import assert from "node:assert/strict";
import { createReportSetController } from "../src/report-set-controller.js";
import { prepareReportSetChecksFile, readReportSetChecksText, REPORT_SET_CHECKS_LIMIT } from "../src/report-set-export.js";
import { sequenceHistory, historyMemory, fileFrom, AFTER, deferred } from "./helpers/report-set-fixtures.js";

async function ready(options = {}) {
  const history = sequenceHistory([0n, 0n]), store = historyMemory(history), files = [];
  const controller = createReportSetController({ storage: store.storage, now: () => AFTER, ...options });
  await controller.refresh(); controller.select(history.entries.map(entry => entry.id)); controller.prepare("Screen review"); await controller.applyReview();
  const text = (await prepareReportSetChecksFile(controller.state.input)).text;
  return { controller, store, files, text, file: fileFrom(text), dispose: () => controller.dispose() };
}
test("shared detail-file reading accepts UTF-8 and rejects oversized, misnamed or malformed encodings", async () => {
  assert.equal(await readReportSetChecksText(fileFrom('{"test":1}')), '{"test":1}');
  let reads = 0;
  await assert.rejects(readReportSetChecksText({ name: "huge.json", size: REPORT_SET_CHECKS_LIMIT + 1, arrayBuffer() { reads++; } }), { code: "PERIOD_SET_CHECKS_SIZE" });
  await assert.rejects(readReportSetChecksText(fileFrom("{}", "wrong.txt")), { code: "PERIOD_FILENAME" });
  await assert.rejects(readReportSetChecksText({ name: "bad.json", size: 2, arrayBuffer: async () => new Uint8Array([0xc3,0x28]).buffer }), { code: "PERIOD_SET_CHECKS_ENCODING" });
  assert.equal(reads, 0);
});
test("screen review requires an accepted original and never writes report storage", async () => {
  const store = historyMemory(sequenceHistory()), controller = createReportSetController({ storage: store.storage });
  try { assert.equal(await controller.reviewCheckFile(fileFrom("{}")), false); assert.equal(controller.state.error, "PERIOD_SET_NO_RESULT"); assert.deepEqual(store.calls, []); }
  finally { controller.dispose(); }
  const f = await ready();
  try {
    const input = f.controller.state.input, document = JSON.stringify(f.store.document);
    assert.equal(await f.controller.reviewCheckFile(f.file), true); assert.equal(f.controller.state.checkReview.matchesRecomputation, true);
    assert.equal(f.controller.state.checkReview.summary.allContinuous, false); assert.equal(f.controller.state.input, input);
    assert.equal(JSON.stringify(f.store.document), document); assert.ok(f.store.calls.every(call => call[0] === "read"));
  } finally { f.dispose(); }
});
test("screen review reports altered observations as differences without repairing either source", async () => {
  const f = await ready();
  try {
    const data = JSON.parse(f.text); data.items = []; data.matched = 0; const text = JSON.stringify(data), input = f.controller.state.input;
    assert.equal(await f.controller.reviewCheckFile(fileFrom(text)), true);
    const review = f.controller.state.checkReview; assert.equal(review.matchesRecomputation, false); assert.ok(review.differences.includes("items"));
    assert.ok(review.matched > 0); assert.match(f.controller.state.message, /食い違い/); assert.equal(f.controller.state.input, input);
  } finally { f.dispose(); }
});
test("review receipt needs acknowledgement, preserves exact completed result and retries refused delivery", async () => {
  const f = await ready();
  try {
    assert.equal(await f.controller.exportFile("check-review", true, file => f.files.push(file)), false);
    assert.equal(f.controller.state.error, "PERIOD_SET_CHECKS_NO_REVIEW");
    await f.controller.reviewCheckFile(f.file);
    const expected = f.controller.state.checkReview;
    assert.equal(await f.controller.exportFile("check-review", false, file => f.files.push(file)), false);
    assert.equal(await f.controller.exportFile("check-review", true, () => false), false);
    assert.equal(await f.controller.exportFile("check-review", true, file => f.files.push(file)), true);
    assert.equal(f.files.length, 1); assert.deepEqual(JSON.parse(f.files[0].text), expected);
    assert.equal(f.files[0].restorable, false); assert.equal(f.files[0].byteLength, Buffer.byteLength(f.files[0].text));
    assert.equal(f.files[0].filename, "ThreeCore-report-set-check-review.json");
  } finally { f.dispose(); }
});
test("invalid follow-up detail file preserves the last completed comparison", async () => {
  const f = await ready();
  try {
    await f.controller.reviewCheckFile(f.file); const completed = f.controller.state.checkReview;
    assert.equal(await f.controller.reviewCheckFile(fileFrom("{")), false);
    assert.equal(f.controller.state.error, "PERIOD_SET_CHECKS_JSON"); assert.equal(f.controller.state.checkReview, completed);
  } finally { f.dispose(); }
});
test("a cancelled old read cannot replace a newer completed comparison", async () => {
  const gate = deferred(); let first = true, content;
  const f = await ready({ readChecksText: async () => first ? (first = false, gate.promise) : content }); content = f.text;
  try {
    const old = f.controller.reviewCheckFile(f.file); assert.equal(f.controller.state.busy, true); f.controller.cancel();
    assert.equal(await f.controller.reviewCheckFile(f.file), true); const completed = f.controller.state.checkReview;
    gate.resolve("invalid old data"); assert.equal(await old, false);
    assert.equal(f.controller.state.checkReview, completed); assert.equal(f.controller.state.error, null); assert.equal(f.controller.state.busy, false);
  } finally { f.dispose(); }
});
test("accepting a different original clears its predecessor's comparison and receipt", async () => {
  const f = await ready();
  try {
    await f.controller.reviewCheckFile(f.file); f.controller.prepare("Another original"); await f.controller.applyReview();
    assert.equal(f.controller.state.checkReview, null);
    assert.equal(await f.controller.exportFile("check-review", true, file => f.files.push(file)), false); assert.equal(f.files.length, 0);
  } finally { f.dispose(); }
});
test("disposal during file reading cannot publish a comparison afterwards", async () => {
  const gate = deferred(), f = await ready({ readChecksText: () => gate.promise });
  const pending = f.controller.reviewCheckFile(f.file); f.dispose(); gate.resolve(f.text);
  assert.equal(await pending, false); assert.equal(f.controller.state.checkReview, null); assert.equal(f.controller.state.disposed, true);
});
