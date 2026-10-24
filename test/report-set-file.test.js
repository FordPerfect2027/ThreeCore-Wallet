import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { prepareReportSetFile, decodeReportSetFile, readReportSetFile,
  REPORT_SET_FILE_LIMIT } from "../src/report-set-file.js";
import { analyzeReportSet } from "../src/report-set-engine.js";
import { sequenceSet, sequenceHistory, clone, fileFrom } from "./helpers/report-set-fixtures.js";

const subtle = webcrypto.subtle;
const rejects = (operation, expected) => assert.rejects(operation,
  value => (value.code ?? value.message) === expected);

test("set JSON roundtrip retains all evidence and recomputes the same analysis", async () => {
  const input = sequenceSet();
  const file = await prepareReportSetFile(input, { subtle });
  const loaded = await decodeReportSetFile(file.text, { subtle });
  assert.deepEqual(loaded.input, input);
  assert.deepEqual(analyzeReportSet(loaded.input), analyzeReportSet(input));
  assert.equal(loaded.checksumVerified, true);
  assert.equal(loaded.authenticated, false);
  assert.equal(file.encrypted, false);
  assert.equal(file.containsOriginalEvidence, true);
  assert.equal(file.byteLength, Buffer.byteLength(file.text));
  assert.match(file.digest, /^[a-f0-9]{64}$/);
  assert.equal(file.filename, "ThreeCore-report-set.json");
});

test("set file contains input evidence but never trusted analysis fields", async () => {
  const file = await prepareReportSetFile(sequenceSet());
  const envelope = JSON.parse(file.text);
  assert.deepEqual(Object.keys(envelope), ["schema", "algorithm", "digest", "input"]);
  assert.ok(envelope.input.entries[0].report.slots[0].entry.draft.records.length);
  assert.equal(envelope.input.allContinuous, undefined);
  assert.equal(envelope.input.tokens, undefined);
});

test("identical set data generates a deterministic checksum", async () => {
  const first = await prepareReportSetFile(sequenceSet());
  const second = await prepareReportSetFile(clone(sequenceSet()));
  assert.equal(first.digest, second.digest);
  assert.equal(first.text, second.text);
});

for (const change of [
  input => { input.title = "Different review"; },
  input => { input.sourceRevision++; },
  input => { input.entries.reverse(); },
  input => { input.entries[0].label = "New label"; },
  input => { input.entries[0].note = "New note"; },
  input => { input.entries[0].archived = true; },
  input => { input.entries[0].report.title = "New report"; },
]) {
  test("valid evidence changes still require a new checksum: " + change.toString(), async () => {
    const envelope = JSON.parse((await prepareReportSetFile(sequenceSet())).text);
    change(envelope.input);
    await rejects(decodeReportSetFile(JSON.stringify(envelope)), "PERIOD_CHECKSUM");
  });
}

for (const [field, value] of [
  ["schema", "threecore.report-history-file.v1"], ["algorithm", "SHA-1"],
  ["digest", "a".repeat(63)], ["digest", "A".repeat(64)], ["digest", 42],
]) {
  test("unsupported set envelope rejects " + field + " " + value, async () => {
    const envelope = JSON.parse((await prepareReportSetFile(sequenceSet())).text);
    envelope[field] = value;
    await rejects(decodeReportSetFile(JSON.stringify(envelope)), "PERIOD_SET_FILE_SCHEMA");
  });
}

test("added conclusions and missing evidence are rejected even before digest comparison", async () => {
  for (const alter of [
    value => { value.result = { allContinuous: true }; },
    value => { delete value.input; },
    value => { value.input.verified = true; },
    value => { value.input.entries = []; },
  ]) {
    const envelope = JSON.parse((await prepareReportSetFile(sequenceSet())).text);
    alter(envelope);
    await assert.rejects(decodeReportSetFile(JSON.stringify(envelope)));
  }
});

test("JSON property order and harmless whitespace do not change canonical evidence", async () => {
  const envelope = JSON.parse((await prepareReportSetFile(sequenceSet())).text);
  const reordered = Object.fromEntries(Object.entries(envelope).reverse());
  reordered.input = Object.fromEntries(Object.entries(reordered.input).reverse());
  const loaded = await decodeReportSetFile(JSON.stringify(reordered, null, 2));
  assert.deepEqual(loaded.input, sequenceSet());
});

test("file reading accepts a valid UTF-8 browser File abstraction", async () => {
  const file = await prepareReportSetFile(sequenceSet());
  const loaded = await readReportSetFile(fileFrom(file.text, "確認.JSON"));
  assert.deepEqual(loaded.input, sequenceSet());
});

for (const name of ["../set.json", "dir/set.json", "dir\\set.json", "set.html", "set.json\n", "x".repeat(181) + ".json"]) {
  test("unsafe file name rejects without reading: " + JSON.stringify(name), async () => {
    let reads = 0;
    await rejects(readReportSetFile({ name, size: 1, arrayBuffer() { reads++; } }), "PERIOD_FILENAME");
    assert.equal(reads, 0);
  });
}

for (const size of [0, -1, 1.5, NaN, REPORT_SET_FILE_LIMIT + 1]) {
  test("invalid declared size rejects before allocating: " + size, async () => {
    let reads = 0;
    await rejects(readReportSetFile({ name: "set.json", size, arrayBuffer() { reads++; } }), "PERIOD_SET_FILE_SIZE");
    assert.equal(reads, 0);
  });
}

test("declared and actual lengths must match", async () => {
  await rejects(readReportSetFile({ name: "set.json", size: 5,
    arrayBuffer: async () => new ArrayBuffer(4) }), "PERIOD_SET_FILE_SIZE");
});

test("a non-ArrayBuffer payload is rejected", async () => {
  await rejects(readReportSetFile({ name: "set.json", size: 4,
    arrayBuffer: async () => new Uint8Array(4) }), "PERIOD_SET_FILE_SIZE");
});

test("bad UTF-8 is rejected instead of replacing invalid bytes", async () => {
  const buffer = new Uint8Array([0xc3, 0x28]).buffer;
  await rejects(readReportSetFile({ name: "set.json", size: 2,
    arrayBuffer: async () => buffer }), "PERIOD_FILE_ENCODING");
});

test("failed disk read is reported without exposing its raw error", async () => {
  await rejects(readReportSetFile({ name: "set.json", size: 2,
    arrayBuffer: async () => { throw Error("private local path"); } }), "PERIOD_FILE_READ");
});

for (const text of ["{", "undefined", "not json"]) {
  test("malformed JSON is rejected: " + text, async () => {
    await rejects(decodeReportSetFile(text), "PERIOD_FILE_JSON");
  });
}

test("empty and nontext decoder values fail at the size boundary", async () => {
  for (const value of ["", null, undefined, 1, {}]) {
    await rejects(decodeReportSetFile(value), "PERIOD_SET_FILE_SIZE");
  }
});

for (const cryptoValue of [null, {}, { digest: async () => new ArrayBuffer(31) },
  { digest: async () => new Uint8Array(32) }, { digest: async () => { throw Error("unavailable"); } }]) {
  test("missing or malformed SHA-256 provider fails closed " + String(cryptoValue?.digest), async () => {
    await rejects(prepareReportSetFile(sequenceSet(), { subtle: cryptoValue }), "PERIOD_CRYPTO");
  });
}

test("all twelve selected reports survive file serialization without truncation", async () => {
  const input = sequenceSet(sequenceHistory(Array.from({ length: 12 }, (_, index) => BigInt(index * 12))));
  const file = await prepareReportSetFile(input);
  const decoded = await decodeReportSetFile(file.text);
  assert.equal(decoded.input.entries.length, 12);
  assert.deepEqual(decoded.input, input);
  assert.equal(analyzeReportSet(decoded.input).allContinuous, true);
});

test("digest protects consistency, not authorship: re-encoded edits remain explicitly unauthenticated", async () => {
  const input = clone(sequenceSet());
  input.title = "Edited locally";
  const decoded = await decodeReportSetFile((await prepareReportSetFile(input)).text);
  assert.equal(decoded.checksumVerified, true);
  assert.equal(decoded.authenticated, false);
  assert.equal(decoded.input.title, "Edited locally");
});
