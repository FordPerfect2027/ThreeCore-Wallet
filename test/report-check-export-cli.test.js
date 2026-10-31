import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseReportCheckArgs, runReportCheckExport } from "../scripts/export-report-checks.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { reportSetDiagnosticsCSV } from "../src/report-set-export.js";
import { sequenceSet, demoSetHistory, clone } from "./helpers/report-set-fixtures.js";

async function sourceFile(t, source = sequenceSet(demoSetHistory())) {
  const prefix = join(tmpdir(), "threecore-checklist-cli-"), folder = await mkdtemp(prefix);
  t.after(async () => { assert.ok(resolve(folder).startsWith(resolve(prefix))); await rm(folder, { recursive: true, force: true }); });
  const path = join(folder, "synthetic source.json"), file = await prepareReportSetFile(source);
  await writeFile(path, file.text); return { folder, path, source, text: file.text, digest: file.digest };
}
async function run(args) {
  let output = "", errors = "";
  const exitCode = await runReportCheckExport(args, { stdout: { write(value) { output += value; } }, stderr: { write(value) { errors += value; } } });
  return { output, errors, exitCode };
}
test("check export parses every option, captures normalized filters and rejects ambiguous flags", async () => {
  const result = parseReportCheckArgs(["file.JSON", "--agent", "EMA", "--severity", "conflict", "--search", "  CHECK  ", "--format", "json", "--include-notes", "--full-addresses", "--require-continuous"]);
  assert.deepEqual(result.query, { agent: "EMA", severity: "conflict", search: "check" });
  assert.deepEqual(result.options, { includeNotes: true, shortAddresses: false }); assert.equal(result.requireContinuous, true);
  for (const args of [[], ["file.csv"], ["--file.json"], ["file.json", "--agent", "UNKNOWN"], ["file.json", "--severity", "danger"],
    ["file.json", "--format", "html"], ["file.json", "--page", "1"], ["file.json", "--search"],
    ["file.json", "--search", "x", "--search", "y"], ["file.json", "--include-notes", "--include-notes"],
    ["file.json", "--search", "x".repeat(101)], ["file.json", "--search", "\n"]]) {
    assert.throws(() => parseReportCheckArgs(args)); const failed = await run(args);
    assert.equal(failed.exitCode, 1); assert.equal(failed.output, "");
  }
});
test("help needs no file and explains unfiltered summary and privacy scope", async () => {
  const result = await run(["--help"]); assert.equal(result.exitCode, 0); assert.equal(result.errors, "");
  assert.match(result.output, /unfiltered summary/); assert.match(result.output, /names\/search may still contain addresses/);
});
test("standalone command reproduces all matching browser CSV bytes without changing source", async t => {
  const file = await sourceFile(t), args = [file.path, "--agent", "EMA", "--severity", "conflict"];
  const expected = reportSetDiagnosticsCSV(file.source, { agent: "EMA", severity: "conflict" }).text;
  const result = await run(args); assert.equal(result.exitCode, 0); assert.equal(result.errors, ""); assert.equal(result.output, expected);
  const child = spawnSync(process.execPath, ["scripts/export-report-checks.js", ...args], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0); assert.equal(child.stderr, ""); assert.equal(child.stdout, expected);
  assert.equal(await readFile(file.path, "utf8"), file.text);
});
test("JSON carries original digest and complete query/summary despite zero matching checks", async t => {
  const file = await sourceFile(t), result = await run([file.path, "--search", "nothing found", "--format", "json"]);
  assert.equal(result.exitCode, 0); const data = JSON.parse(result.output);
  assert.equal(data.matched, 0); assert.equal(data.total, 15); assert.equal(data.summary.counts.conflict, 8);
  assert.equal(data.query.search, "nothing found"); assert.equal(data.summary.allContinuous, false);
  assert.equal(data.summary.conclusionsUseAllSourceEvidence, true); assert.equal(data.sourcePayloadDigest, file.digest);
  for (const key of ["authenticated", "encrypted", "liveChainRechecked", "automaticRepairs", "restorable"]) assert.equal(data[key], false);
  assert.equal(data.checksumVerified, true); assert.equal(data.csv.trimEnd().split("\r\n").length, 2);
});
test("strict continuity cannot be concealed by token or search selection", async t => {
  const file = await sourceFile(t), result = await run([file.path, "--agent", "DAT", "--search", "nothing found", "--require-continuous", "--format", "json"]);
  assert.equal(result.exitCode, 2); assert.match(result.errors, /NOT_CONTINUOUS/);
  assert.equal(JSON.parse(result.output).matched, 0); assert.equal(JSON.parse(result.output).summary.allContinuous, false);
  const good = await sourceFile(t, sequenceSet()); assert.equal((await run([good.path, "--require-continuous"])).exitCode, 0);
});
test("note and address options reproduce browser export without claiming anonymization", async t => {
  const input = clone(sequenceSet(demoSetHistory())); input.entries[0].note = "PRIVATE_NOTE";
  const file = await sourceFile(t, input), ordinary = await run([file.path]);
  assert.doesNotMatch(ordinary.output, /PRIVATE_NOTE/);
  const full = await run([file.path, "--include-notes", "--full-addresses", "--format", "json"]);
  assert.equal(full.exitCode, 0); const data = JSON.parse(full.output);
  assert.match(data.csv, /PRIVATE_NOTE/); assert.deepEqual(data.options, { includeNotes: true, shortAddresses: false });
  assert.equal(data.csv, reportSetDiagnosticsCSV(input, {}, data.options).text);
});
test("checksum tampering has no partial stdout", async t => {
  const file = await sourceFile(t), parsed = JSON.parse(file.text); parsed.digest = "0".repeat(64);
  await writeFile(file.path, JSON.stringify(parsed)); const result = await run([file.path]);
  assert.equal(result.exitCode, 1); assert.equal(result.output, ""); assert.match(result.errors, /CHECKSUM/);
});
test("wrong file type, malformed UTF-8 and missing paths fail without disclosing paths", async t => {
  const file = await sourceFile(t), report = await preparePeriodReportFile(file.source.entries[0].report);
  await writeFile(file.path, report.text); const wrong = await run([file.path]); assert.equal(wrong.exitCode, 1); assert.equal(wrong.output, "");
  await writeFile(file.path, new Uint8Array([0xc3, 0x28])); const bad = await run([file.path]); assert.equal(bad.exitCode, 1); assert.equal(bad.output, "");
  const missing = await run([join(file.folder, "PRIVATE_PATH.json")]); assert.equal(missing.exitCode, 1); assert.equal(missing.output, "");
  assert.doesNotMatch(missing.errors, /PRIVATE_PATH/); assert.ok(!missing.errors.includes(file.folder));
});
