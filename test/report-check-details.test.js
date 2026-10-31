import test from "node:test";
import assert from "node:assert/strict";
import { prepareReportSetChecksFile, REPORT_SET_CHECKS_SCHEMA, REPORT_SET_CHECKS_LIMIT } from "../src/report-set-export.js";
import { prepareReportSetFile, decodeReportSetFile } from "../src/report-set-file.js";
import { querySetDiagnostics } from "../src/report-set-diagnostics.js";
import { createReportSetController } from "../src/report-set-controller.js";
import { sequenceSet, sequenceHistory, demoSetHistory, clone, historyMemory, AFTER, deferred } from "./helpers/report-set-fixtures.js";

test("structured checks retain exact observations and identify the canonical original source", async () => {
  const input = sequenceSet(sequenceHistory([0n, 0n])), before = JSON.stringify(input);
  const original = await prepareReportSetFile(input), file = await prepareReportSetChecksFile(input, { severity: "conflict" });
  const data = JSON.parse(file.text), found = querySetDiagnostics(input, { severity: "conflict" });
  assert.equal(data.schema, REPORT_SET_CHECKS_SCHEMA); assert.equal(data.sourcePayloadDigest, original.digest);
  assert.deepEqual(data.items.map(item => item.observations), found.items.map(item => item.observations));
  const values = data.items.flatMap(item => item.observations.map(row => row.value)).filter(value => value !== null);
  assert.ok(values.length > 0); assert.ok(values.every(value => typeof value === "string" && value.length > 16));
  assert.equal(file.byteLength, Buffer.byteLength(file.text)); assert.ok(file.byteLength <= REPORT_SET_CHECKS_LIMIT);
  assert.equal(file.filename, "ThreeCore-report-set-checks.json"); assert.equal(JSON.stringify(input), before);
  for (const flag of ["restorable", "containsOriginalEvidence", "authenticated", "liveChainRechecked", "automaticRepairs", "encrypted"]) assert.equal(data[flag], false);
  await assert.rejects(decodeReportSetFile(file.text));
});
test("empty structured selections retain source-wide contradictions and the exact query", async () => {
  const data = JSON.parse((await prepareReportSetChecksFile(sequenceSet(demoSetHistory()), { search: "no matching check" })).text);
  assert.equal(data.matched, 0); assert.deepEqual(data.items, []); assert.equal(data.total, 15);
  assert.equal(data.summary.counts.conflict, 8); assert.equal(data.summary.allContinuous, false);
  assert.equal(data.summary.conclusionsUseAllSourceEvidence, true); assert.equal(data.query.search, "no matching check");
});
test("structured note/address choices leave hashes and exact stored values intact", async () => {
  const input = clone(sequenceSet(sequenceHistory([0n, 0n]))); input.entries[0].note = "PRIVATE_NOTE";
  const short = JSON.parse((await prepareReportSetChecksFile(input)).text);
  const full = JSON.parse((await prepareReportSetChecksFile(input, {}, { includeNotes: true, shortAddresses: false })).text);
  assert.ok(short.items.every(item => item.account === null || item.account.includes("…")));
  assert.ok(short.items.every(item => item.notes.length === 0)); assert.ok(!JSON.stringify(short).includes("PRIVATE_NOTE"));
  assert.ok(full.items.some(item => item.notes.some(note => note.text === "PRIVATE_NOTE")));
  assert.ok(full.items.every(item => item.account === null || /^0x[0-9a-f]{40}$/.test(item.account)));
  assert.deepEqual(short.items.map(item => item.observations), full.items.map(item => item.observations));
  assert.equal(short.sourcePayloadDigest, full.sourcePayloadDigest);
});
test("source, query and output options are captured before asynchronous digest work", async () => {
  const input = clone(sequenceSet(sequenceHistory([0n, 0n]))), expected = (await prepareReportSetFile(input)).digest;
  const query = { severity: "conflict" }, options = { includeNotes: true, shortAddresses: false };
  const gate = deferred(), started = deferred(), subtle = { digest(...args) { started.resolve(); return gate.promise.then(() => crypto.subtle.digest(...args)); } };
  const promise = prepareReportSetChecksFile(input, query, options, { subtle }); await started.promise;
  input.entries[0].note = "LATER_NOTE"; query.severity = "information"; options.includeNotes = false;
  gate.resolve(); const data = JSON.parse((await promise).text);
  assert.equal(data.sourcePayloadDigest, expected); assert.equal(data.query.severity, "conflict"); assert.equal(data.options.includeNotes, true);
  assert.ok(!JSON.stringify(data).includes("LATER_NOTE"));
});
test("cancelled or failed hashing does not return a viewing file", async () => {
  const controller = new AbortController(); controller.abort(); const source = sequenceSet();
  await assert.rejects(prepareReportSetChecksFile(source, {}, {}, { signal: controller.signal }), { code: "PERIOD_CRYPTO" });
  await assert.rejects(prepareReportSetChecksFile(source, {}, {}, { subtle: { digest() { throw Error("PRIVATE_CRYPTO"); } } }), error => error.code === "PERIOD_CRYPTO" && !error.message.includes("PRIVATE"));
});
test("structured export rejects option/query getters without executing them", async () => {
  let reads = 0; const source = sequenceSet();
  await assert.rejects(prepareReportSetChecksFile(source, { get search() { reads++; return ""; } }));
  await assert.rejects(prepareReportSetChecksFile(source, {}, { get includeNotes() { reads++; return true; } }));
  assert.equal(reads, 0);
});
test("structured export observes acknowledgement, cancellation and delivery retry", async () => {
  const history = demoSetHistory(), storage = historyMemory(history).storage, files = [];
  const controller = createReportSetController({ storage, now: () => AFTER });
  try {
    await controller.refresh(); controller.select(history.entries.map(entry => entry.id)); controller.prepare("Details"); await controller.applyReview();
    const original = controller.state.input;
    assert.equal(await controller.exportFile("checks-json", false, file => files.push(file)), false);
    const pending = controller.exportFile("checks-json", true, file => files.push(file)); controller.cancel();
    assert.equal(await pending, false); assert.equal(files.length, 0);
    assert.equal(await controller.exportFile("checks-json", true, () => false), false);
    assert.equal(await controller.exportFile("checks-json", true, file => files.push(file), {}, { search: "check-8" }), true);
    assert.equal(files.length, 1); assert.equal(JSON.parse(files[0].text).matched, 1); assert.equal(controller.state.input, original);
  } finally { controller.dispose(); }
});
