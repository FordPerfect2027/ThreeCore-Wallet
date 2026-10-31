import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseRecoverSetSourceArgs, runRecoverSetSource } from "../scripts/recover-report-set-source.js";
import { prepareReportSetComparisonEvidenceFile } from "../src/report-set-export.js";
import { decodeReportSetFile } from "../src/report-set-file.js";
import { sequenceSet, demoSetHistory } from "./helpers/report-set-fixtures.js";

async function fixture(t) {
  const prefix = join(tmpdir(), "threecore-recover-evidence-"), folder = await mkdtemp(prefix);
  t.after(async () => { assert.ok(resolve(folder).startsWith(resolve(prefix))); await rm(folder, { recursive: true, force: true }); });
  const file = await prepareReportSetComparisonEvidenceFile(sequenceSet(), sequenceSet(demoSetHistory()));
  const path = join(folder, "portable evidence.json"); await writeFile(path, file.text); return { file, path, folder };
}
async function run(args) {
  let output = "", errors = "";
  const code = await runRecoverSetSource(args, { stdout: { write(v) { output += v; } }, stderr: { write(v) { errors += v; } } });
  return { output, errors, code };
}
test("recovery requires an explicit original side and explains full plaintext output", async () => {
  assert.deepEqual(parseRecoverSetSourceArgs(["file.JSON", "--source", "after"]), { path: "file.JSON", role: "after" });
  for (const args of [[], ["file.json"], ["file.json", "--source"], ["a.csv", "--source", "before"],
    ["-a.json", "--source", "before"], ["a\0.json", "--source", "before"], ["a.json", "--source", "both"],
    ["a.json", "--output", "before"], ["a.json", "--source", "before", "--source", "after"]]) {
    const result = await run(args); assert.equal(result.code, 1); assert.equal(result.output, "");
  }
  const help = await run(["--help"]); assert.equal(help.code, 0); assert.match(help.output, /full unencrypted original/);
});
test("standalone recovery returns the exact embedded reloadable bytes for each side", async t => {
  const f = await fixture(t), data = JSON.parse(f.file.text);
  for (const role of ["before", "after"]) {
    const result = spawnSync(process.execPath, ["scripts/recover-report-set-source.js", f.path, "--source", role],
      { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, "");
    assert.equal(result.stdout, data[role + "FileText"]); await decodeReportSetFile(result.stdout);
  }
  assert.equal(await readFile(f.path, "utf8"), f.file.text);
});
test("comparison mismatch still yields a verified original with exit 2 and a visible notice", async t => {
  const f = await fixture(t), data = JSON.parse(f.file.text), comparison = JSON.parse(data.comparisonText);
  comparison.comparison.rows = []; data.comparisonText = JSON.stringify(comparison); await writeFile(f.path, JSON.stringify(data));
  const result = await run([f.path, "--source", "after"]);
  assert.equal(result.code, 2); assert.equal(result.output, data.afterFileText); assert.match(result.errors, /COMPARISON_DIFFERS/);
});
test("corruption on the unselected side and read failures refuse the whole bundle without partial original output", async t => {
  const f = await fixture(t), data = JSON.parse(f.file.text), after = JSON.parse(data.afterFileText);
  after.digest = "0".repeat(64); data.afterFileText = JSON.stringify(after); await writeFile(f.path, JSON.stringify(data));
  const corrupt = await run([f.path, "--source", "before"]); assert.equal(corrupt.code, 1); assert.equal(corrupt.output, "");
  assert.match(corrupt.errors, /CHECKSUM/);
  await writeFile(f.path, new Uint8Array([0xc3, 0x28])); const invalid = await run([f.path, "--source", "before"]);
  assert.equal(invalid.code, 1); assert.equal(invalid.output, "");
  const missing = await run([join(f.folder, "PRIVATE_PATH.json"), "--source", "before"]);
  assert.equal(missing.code, 1); assert.equal(missing.output, ""); assert.doesNotMatch(missing.errors, /PRIVATE_PATH/);
});
