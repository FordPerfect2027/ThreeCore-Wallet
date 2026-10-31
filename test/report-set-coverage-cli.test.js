import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseCoverageExportArgs, runCoverageExport } from "../scripts/export-history-coverage.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { prepareReportSetCoverageFile } from "../src/report-set-export.js";
import { sequenceSet, demoSetHistory, sequenceHistory } from "./helpers/report-set-fixtures.js";

async function fixture(t, input = sequenceSet(demoSetHistory())) {
  const prefix = join(tmpdir(), "threecore-history-coverage-cli-"), folder = await mkdtemp(prefix);
  t.after(async () => { assert.ok(resolve(folder).startsWith(resolve(prefix))); await rm(folder, { recursive: true, force: true }); });
  const file = await prepareReportSetFile(input), path = join(folder, "source set.json"); await writeFile(path, file.text);
  return { input, file, path, folder };
}
async function run(args) {
  let output = "", errors = "";
  const exitCode = await runCoverageExport(args, { stdout: { write(value) { output += value; } }, stderr: { write(value) { errors += value; } } });
  return { output, errors, exitCode };
}
test("coverage CLI validates its limited format/privacy/continuity options", async () => {
  assert.deepEqual(parseCoverageExportArgs(["a.JSON", "--format", "csv", "--full-addresses", "--require-continuous"]),
    { path: "a.JSON", format: "csv", options: { shortAddresses: false }, requireContinuous: true });
  for (const args of [[], ["a.csv"], ["--a.json"], ["a\0.json"], ["a.json", "--format"], ["a.json", "--format", "xml"],
    ["a.json", "--full-addresses", "--full-addresses"], ["a.json", "--include-notes"], ["a.json", "--format", "json", "--repair"]]) {
    assert.throws(() => parseCoverageExportArgs(args)); const result = await run(args); assert.equal(result.exitCode, 1); assert.equal(result.output, "");
  }
  const help = await run(["--help"]); assert.equal(help.exitCode, 0); assert.match(help.output, /Do not sum summaries/); assert.match(help.output, /not complete chain history/);
});
test("standalone JSON and CSV reproduce screen files byte-for-byte without altering source", async t => {
  const f = await fixture(t);
  for (const format of ["json", "csv"]) for (const shortAddresses of [true, false]) {
    const args = ["scripts/export-history-coverage.js", f.path, "--format", format, ...(shortAddresses ? [] : ["--full-addresses"])];
    const result = spawnSync(process.execPath, args, { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, (await prepareReportSetCoverageFile(f.input, format, { shortAddresses })).text);
  }
  assert.equal(await readFile(f.path, "utf8"), f.file.text);
});
test("strict exit uses the complete source even if some groups have full saved coverage", async t => {
  const f = await fixture(t), result = await run([f.path, "--require-continuous"]);
  assert.equal(result.exitCode, 2); assert.match(result.errors, /NOT_CONTINUOUS/);
  const data = JSON.parse(result.output); assert.ok(data.groups.some(group => group.pendingPlannedBlocks === "0")); assert.equal(data.summary.allContinuous, false);
  const good = await fixture(t, sequenceSet()); const success = await run([good.path, "--require-continuous"]);
  assert.equal(success.exitCode, 0); assert.equal(JSON.parse(success.output).completeHistory, false);
  const missing = await fixture(t, sequenceSet(sequenceHistory([0n], report => { report.slots[1].entry = null; report.slots[2].entry = null; })));
  const absent = await run([missing.path, "--format", "csv", "--require-continuous"]);
  assert.equal(absent.exitCode, 2); assert.match(absent.output, /source-summary/); assert.match(absent.output, /EMA/); assert.match(absent.output, /CAWELON/);
  assert.equal((absent.output.match(/"group-summary"/g) ?? []).length, 1);
});
test("corrupt wrappers and malformed encodings produce no partial exported evidence", async t => {
  const f = await fixture(t), data = JSON.parse(f.file.text); data.digest = "0".repeat(64);
  await writeFile(f.path, JSON.stringify(data)); const corrupted = await run([f.path]); assert.equal(corrupted.exitCode, 1); assert.equal(corrupted.output, ""); assert.match(corrupted.errors, /CHECKSUM/);
  await writeFile(f.path, new Uint8Array([0xc3, 0x28])); const invalid = await run([f.path]); assert.equal(invalid.exitCode, 1); assert.equal(invalid.output, "");
  const missing = await run([join(f.folder, "PRIVATE_PATH.json")]); assert.equal(missing.exitCode, 1); assert.equal(missing.output, ""); assert.doesNotMatch(missing.errors, /PRIVATE_PATH/);
});
