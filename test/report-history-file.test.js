import test from "node:test";
import assert from "node:assert/strict";
import { prepareReportHistoryFile, decodeReportHistoryFile, readReportHistoryFile,
  REPORT_HISTORY_FILE_LIMIT } from "../src/report-history-file.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { historyDocument, historyRecord, sampleHistory, clone, code, fileFrom, reportInput,
  forkedInput } from "./helpers/report-history-fixtures.js";

test("backup round trip includes archived reports, notes and restrictions", async () => {
  const input = sampleHistory(), before = JSON.stringify(input);
  const file = await prepareReportHistoryFile(input), decoded = await decodeReportHistoryFile(file.text);
  assert.deepEqual(decoded.document.entries, input.entries);
  assert.equal(decoded.document.revision, 0);
  assert.equal(decoded.checksumVerified, true);
  assert.equal(decoded.authenticated, false);
  assert.equal(file.encrypted, false);
  assert.equal(file.byteLength, new TextEncoder().encode(file.text).byteLength);
  assert.match(file.digest, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(input), before);
  assert.equal(decoded.document.entries[3].archived, true);
});
test("native file reader returns validated evidence without trusting the file name", async () => {
  const file = await prepareReportHistoryFile(historyDocument([historyRecord()]));
  const result = await readReportHistoryFile(fileFrom(file.text, "anything.JSON"));
  assert.equal(result.document.entries.length, 1);
});
test("storage revision never changes backup checksum", async () => {
  const entries = [historyRecord()];
  const a = await prepareReportHistoryFile(historyDocument(entries, 2));
  const b = await prepareReportHistoryFile(historyDocument(entries, 999));
  assert.equal(a.text, b.text);
});
test("JSON whitespace and key order do not change canonical validation", async () => {
  const file = await prepareReportHistoryFile(historyDocument([historyRecord()]));
  const input = JSON.parse(file.text);
  const reverse = Object.fromEntries(Object.entries(input).reverse());
  assert.equal((await decodeReportHistoryFile(JSON.stringify(reverse, null, 2))).digest, file.digest);
});
test("empty backups are valid and deterministic", async () => {
  const a = await prepareReportHistoryFile(historyDocument());
  const b = await prepareReportHistoryFile(historyDocument());
  assert.equal(a.text, b.text);
  assert.equal((await decodeReportHistoryFile(a.text)).document.entries.length, 0);
});

for (const change of [
  document => { document.entries[0].note = "changed annotation"; },
  document => { document.entries[0].archived = true; },
  document => { document.entries[0].report = forkedInput(); },
  document => { document.entries[0].tags = ["changed"]; },
  document => { document.entries.reverse(); },
]) {
  test("checksum rejects modified evidence or metadata without a new digest", async () => {
    const file = await prepareReportHistoryFile(historyDocument([historyRecord(), historyRecord(2)]));
    const envelope = JSON.parse(file.text); change(envelope.document);
    await assert.rejects(decodeReportHistoryFile(JSON.stringify(envelope)), code("PERIOD_CHECKSUM"));
  });
}
test("checksum is not an authenticity guarantee: recomputed valid changes remain explicit", async () => {
  const file = await prepareReportHistoryFile(historyDocument([historyRecord(1, { report: forkedInput() })]));
  const decoded = await decodeReportHistoryFile(file.text);
  assert.equal(decoded.authenticated, false);
  assert.deepEqual(decoded.document.entries[0].report, forkedInput());
});

for (const text of ["", "not json", "{", "null", "[]", "42", '"hello"']) {
  test("invalid backup envelope is refused: " + text, async () => {
    await assert.rejects(decodeReportHistoryFile(text));
  });
}
for (const [field, value] of [["algorithm", "MD5"], ["schema", "unknown"], ["digest", "A".repeat(64)],
  ["digest", "a".repeat(63)], ["digest", null], ["digest", 12]]) {
  test("envelope refuses unsupported " + field + " " + value, async () => {
    const envelope = JSON.parse((await prepareReportHistoryFile(historyDocument())).text);
    envelope[field] = value;
    await assert.rejects(decodeReportHistoryFile(JSON.stringify(envelope)), code("PERIOD_HISTORY_FILE_SCHEMA"));
  });
}
test("unknown envelope fields and nonportable revisions are refused", async () => {
  const envelope = JSON.parse((await prepareReportHistoryFile(historyDocument())).text);
  await assert.rejects(decodeReportHistoryFile(JSON.stringify({ ...envelope, signed: true })), code("PERIOD_SHAPE"));
  envelope.document.revision = 3;
  await assert.rejects(decodeReportHistoryFile(JSON.stringify(envelope)), code("PERIOD_HISTORY_FILE_SCHEMA"));
});
test("individual report JSON cannot be mistaken for a history backup", async () => {
  const file = await preparePeriodReportFile(reportInput());
  await assert.rejects(decodeReportHistoryFile(file.text));
});
test("nested false security claims cannot be imported", async () => {
  const envelope = JSON.parse((await prepareReportHistoryFile(historyDocument([historyRecord()]))).text);
  envelope.document.entries[0].report.independentlyVerified = true;
  await assert.rejects(decodeReportHistoryFile(JSON.stringify(envelope)), code("PERIOD_REPORT_SCHEMA"));
});

for (const name of ["../report.json", "folder\\report.json", "report.txt", "bad\u0000.json", "x".repeat(181) + ".json"]) {
  test("unsafe file name is rejected before bytes are read: " + JSON.stringify(name), async () => {
    let reads = 0;
    await assert.rejects(readReportHistoryFile({ name, size: 1, arrayBuffer() { reads++; return new ArrayBuffer(1); } }), code("PERIOD_FILENAME"));
    assert.equal(reads, 0);
  });
}
for (const size of [0, -1, 0.5, "10", REPORT_HISTORY_FILE_LIMIT + 1, NaN]) {
  test("invalid file length is rejected before allocation: " + size, async () => {
    let reads = 0;
    await assert.rejects(readReportHistoryFile({ name: "a.json", size, arrayBuffer() { reads++; } }), code("PERIOD_HISTORY_FILE_SIZE"));
    assert.equal(reads, 0);
  });
}
test("declared size must match returned bytes", async () => {
  await assert.rejects(readReportHistoryFile({ name: "a.json", size: 2, arrayBuffer: async () => new ArrayBuffer(1) }), code("PERIOD_HISTORY_FILE_SIZE"));
  await assert.rejects(readReportHistoryFile({ name: "a.json", size: 1, arrayBuffer: async () => new Uint8Array(1) }), code("PERIOD_HISTORY_FILE_SIZE"));
});
test("invalid UTF-8 and read errors have safe failure codes", async () => {
  await assert.rejects(readReportHistoryFile({ name: "a.json", size: 2, arrayBuffer: async () => new Uint8Array([255, 255]).buffer }), code("PERIOD_FILE_ENCODING"));
  await assert.rejects(readReportHistoryFile({ name: "a.json", size: 2, arrayBuffer: async () => { throw Error("private device detail"); } }), code("PERIOD_FILE_READ"));
});
for (const subtle of [null, {}, { digest: async () => { throw Error("secret"); } },
  { digest: async () => new ArrayBuffer(31) }, { digest: async () => new Uint8Array(32) }]) {
  test("unavailable or invalid cryptography cannot manufacture a verified backup", async () => {
    await assert.rejects(prepareReportHistoryFile(historyDocument(), { subtle }), code("PERIOD_CRYPTO"));
  });
}
test("imported metadata and evidence are deeply immutable copies", async () => {
  const source = historyDocument([historyRecord()]);
  const file = await prepareReportHistoryFile(source), decoded = await decodeReportHistoryFile(file.text);
  assert.throws(() => { decoded.document.entries[0].report.title = "overwrite"; }, TypeError);
  assert.throws(() => decoded.document.entries.push(historyRecord(2)), TypeError);
  assert.deepEqual(source.entries, decoded.document.entries);
});
