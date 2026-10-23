import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { preparePeriodReportFile, decodePeriodReportFile, readPeriodReportFile,
  PERIOD_REPORT_FILE_SCHEMA, PERIOD_REPORT_FILE_LIMIT } from "../src/period-report-file.js";
import { preparePeriodLibraryFile } from "../src/period-library-file.js";
import { analyzePeriodReport } from "../src/period-report-engine.js";
import { reportInput, reportLibrary, clone, fileFrom, code, changedSlot, forkedInput } from "./helpers/period-report-fixtures.js";

test("report JSON round trips original evidence and recomputes the same conclusion", async () => {
  const input = reportInput(), file = await preparePeriodReportFile(input);
  const result = await decodePeriodReportFile(file.text);
  assert.deepEqual(result.input, input);
  assert.deepEqual(analyzePeriodReport(result.input), analyzePeriodReport(input));
  assert.equal(result.checksumVerified, true);
  assert.equal(result.authenticated, false);
  assert.equal(file.encrypted, false);
  assert.equal(file.filename, "ThreeCore-period-report.json");
  assert.equal(file.byteLength, new TextEncoder().encode(file.text).byteLength);
  assert.equal(JSON.parse(file.text).schema, PERIOD_REPORT_FILE_SCHEMA);
});

test("checksum independently matches Node crypto over canonical evidence", async () => {
  const input = reportInput(), file = await preparePeriodReportFile(input);
  assert.equal(file.digest, createHash("sha256").update(JSON.stringify(input)).digest("hex"));
  assert.match(file.digest, /^[0-9a-f]{64}$/);
});

test("compact envelope excludes imported derived conclusions", async () => {
  const file = await preparePeriodReportFile(reportInput());
  const envelope = JSON.parse(file.text);
  assert.deepEqual(Object.keys(envelope), ["schema", "algorithm", "digest", "input"]);
  assert.equal(envelope.input.allArithmeticAgreement, undefined);
  assert.equal(envelope.report, undefined);
  assert.equal(file.text.split("\n").length, 2);
});

test("JSON whitespace and property order do not invalidate canonical checksum", async () => {
  const original = await preparePeriodReportFile(reportInput());
  const value = JSON.parse(original.text);
  value.input = Object.fromEntries(Object.entries(value.input).reverse());
  const reversed = Object.fromEntries(Object.entries(value).reverse());
  const decoded = await decodePeriodReportFile(JSON.stringify(reversed, null, 2));
  assert.equal(decoded.digest, original.digest);
});

for (const [name, mutate] of [
  ["label", value => { value.input.slots[0].entry.label = "tampered"; }],
  ["balance", value => { value.input.slots[1].entry.draft.later.balanceBaseUnits = "1"; }],
  ["quarantine", value => { value.input.slots[2].entry.requiresNewPlan = true; }],
  ["archive", value => { value.input.slots[0].entry.archived = true; }],
  ["title", value => { value.input.title = "changed"; }],
  ["created time", value => { value.input.createdAt = "2026-10-24T03:00:00.000Z"; }],
]) {
  test("checksum rejects changed " + name, async () => {
    const value = JSON.parse((await preparePeriodReportFile(reportInput())).text); mutate(value);
    await assert.rejects(decodePeriodReportFile(JSON.stringify(value)), code("PERIOD_CHECKSUM"));
  });
}

test("a recomputed checksum is not authorship or proof of a valid onchain balance", async () => {
  const input = changedSlot(reportInput(), "DAT", entry => { entry.draft.later.balanceBaseUnits = "1"; });
  const decoded = await decodePeriodReportFile((await preparePeriodReportFile(input)).text);
  assert.equal(decoded.checksumVerified, true);
  assert.equal(decoded.authenticated, false);
  assert.equal(analyzePeriodReport(decoded.input).status, "attention");
});

test("fork and restriction remain visible after file round trip", async () => {
  const input = forkedInput("EMA", reportInput({ changes: { CAWELON: { requiresNewPlan: true, archived: true } } }));
  const decoded = await decodePeriodReportFile((await preparePeriodReportFile(input)).text);
  const report = analyzePeriodReport(decoded.input);
  assert.ok(report.issues.includes("BLOCK_HASH_CONFLICT"));
  assert.ok(report.issues.includes("QUARANTINED_SOURCE"));
  assert.ok(report.warnings.includes("ARCHIVED_SOURCE"));
});

for (const [name, mutate] of [
  ["wrong schema", value => { value.schema = "threecore.period-library-file.v1"; }],
  ["wrong algorithm", value => { value.algorithm = "MD5"; }],
  ["uppercase digest", value => { value.digest = value.digest.toUpperCase(); }],
  ["short digest", value => { value.digest = "ff"; }],
  ["numeric digest", value => { value.digest = 10; }],
]) {
  test("file rejects " + name, async () => {
    const value = JSON.parse((await preparePeriodReportFile(reportInput())).text); mutate(value);
    await assert.rejects(decodePeriodReportFile(JSON.stringify(value)), code("PERIOD_REPORT_FILE_SCHEMA"));
  });
}

test("forged extra success field cannot bypass recalculation", async () => {
  const value = JSON.parse((await preparePeriodReportFile(reportInput())).text);
  value.allArithmeticAgreement = true;
  await assert.rejects(decodePeriodReportFile(JSON.stringify(value)), code("PERIOD_SHAPE"));
});

test("library JSON must not be confused with a report JSON", async () => {
  const file = await preparePeriodLibraryFile(reportLibrary());
  await assert.rejects(decodePeriodReportFile(file.text));
});

for (const text of ["", " ", "not JSON", "{", "null", "[]", "0"]) {
  test("reject unusable text " + JSON.stringify(text), async () => {
    await assert.rejects(decodePeriodReportFile(text));
  });
}

test("file decoding respects byte limits, not just character count", async () => {
  const text = "あ".repeat(Math.floor(PERIOD_REPORT_FILE_LIMIT / 3) + 1);
  assert.ok(text.length < PERIOD_REPORT_FILE_LIMIT);
  await assert.rejects(decodePeriodReportFile(text), code("PERIOD_REPORT_FILE_SIZE"));
});

for (const name of ["bad.txt", "../report.json", "a/b.json", "a\\b.json", "bad\n.json", "x".repeat(181) + ".json"]) {
  test("reader rejects filename " + JSON.stringify(name), async () => {
    let reads = 0;
    await assert.rejects(readPeriodReportFile({ name, size: 1, async arrayBuffer() { reads++; return new ArrayBuffer(1); } }), code("PERIOD_FILENAME"));
    assert.equal(reads, 0);
  });
}

for (const size of [0, -1, 1.1, NaN, Infinity, PERIOD_REPORT_FILE_LIMIT + 1, "1"]) {
  test("reader rejects declared size " + String(size), async () => {
    let reads = 0;
    await assert.rejects(readPeriodReportFile({ name: "report.json", size, async arrayBuffer() { reads++; return new ArrayBuffer(1); } }), code("PERIOD_REPORT_FILE_SIZE"));
    assert.equal(reads, 0);
  });
}

test("reader accepts UTF-8 Japanese title and uppercase JSON extension", async () => {
  const file = await preparePeriodReportFile(reportInput({ title: "司令塔の確認用" }));
  const result = await readPeriodReportFile(fileFrom(file.text, "REPORT.JSON"));
  assert.equal(result.input.title, "司令塔の確認用");
});

test("reader rejects changing file length", async () => {
  const file = fileFrom((await preparePeriodReportFile(reportInput())).text);
  file.size++;
  await assert.rejects(readPeriodReportFile(file), code("PERIOD_REPORT_FILE_SIZE"));
});

test("reader rejects malformed UTF-8 instead of silently replacing bytes", async () => {
  await assert.rejects(readPeriodReportFile({ name: "report.json", size: 2,
    arrayBuffer: async () => new Uint8Array([0xc3, 0x28]).buffer }), code("PERIOD_FILE_ENCODING"));
});

test("reader maps denied file access to a safe error", async () => {
  await assert.rejects(readPeriodReportFile({ name: "report.json", size: 1,
    arrayBuffer: async () => { throw Error("private file location"); } }), code("PERIOD_FILE_READ"));
});

test("typed array masquerading as an ArrayBuffer is rejected", async () => {
  await assert.rejects(readPeriodReportFile({ name: "report.json", size: 1,
    arrayBuffer: async () => new Uint8Array(1) }), code("PERIOD_REPORT_FILE_SIZE"));
});

for (const [name, subtle] of [
  ["missing", null], ["no method", {}],
  ["reject", { digest: async () => { throw Error("crypto denied"); } }],
  ["wrong length", { digest: async () => new ArrayBuffer(31) }],
  ["typed array", { digest: async () => new Uint8Array(32) }],
]) {
  test("unavailable digest " + name + " never creates an unchecked backup", async () => {
    await assert.rejects(preparePeriodReportFile(reportInput(), { subtle }), code("PERIOD_CRYPTO"));
    const file = await preparePeriodReportFile(reportInput());
    await assert.rejects(decodePeriodReportFile(file.text, { subtle }), code("PERIOD_CRYPTO"));
  });
}

test("encoder captures a detached snapshot before asynchronous hashing", async () => {
  const source = clone(reportInput());
  const file = await preparePeriodReportFile(source, { subtle: { async digest(method, data) {
    source.title = "Changed during digest";
    return crypto.subtle.digest(method, data);
  } } });
  assert.notEqual(JSON.parse(file.text).input.title, source.title);
  assert.equal((await decodePeriodReportFile(file.text)).checksumVerified, true);
});
