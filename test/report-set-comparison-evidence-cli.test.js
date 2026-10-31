import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseSetEvidenceArgs, runSetEvidenceReview } from "../scripts/verify-report-set-evidence.js";
import { prepareReportSetComparisonEvidenceFile, reviewReportSetComparisonEvidence } from "../src/report-set-export.js";
import { sequenceSet, demoSetHistory } from "./helpers/report-set-fixtures.js";

async function fixture(t) {
  const prefix = join(tmpdir(), "threecore-comparison-evidence-cli-"), folder = await mkdtemp(prefix);
  t.after(async () => { assert.ok(resolve(folder).startsWith(resolve(prefix))); await rm(folder, { recursive: true, force: true }); });
  const file = await prepareReportSetComparisonEvidenceFile(sequenceSet(), sequenceSet(demoSetHistory()));
  const path = join(folder, "evidence set.json"); await writeFile(path, file.text); return { file, path, folder };
}
async function run(args) {
  let output = "", errors = "";
  const exitCode = await runSetEvidenceReview(args, { stdout: { write(value) { output += value; } }, stderr: { write(value) { errors += value; } } });
  return { output, errors, exitCode };
}
test("one-file evidence CLI validates arguments and explains full source disclosure", async () => {
  assert.deepEqual(parseSetEvidenceArgs(["evidence.JSON", "--json"]), { path: "evidence.JSON", json: true });
  for (const args of [[], ["file.csv"], ["--file.json"], ["a\0.json"], ["file.json", "--restore"], ["file.json", "--json", "--json"]]) {
    assert.throws(() => parseSetEvidenceArgs(args)); const result = await run(args); assert.equal(result.exitCode, 1); assert.equal(result.output, "");
  }
  const help = await run(["--help"]); assert.equal(help.exitCode, 0); assert.match(help.output, /full unencrypted original evidence/); assert.match(help.output, /No external source files/);
});
test("standalone evidence verification exactly reproduces the screen receipt using only the bundle", async t => {
  const f = await fixture(t), result = spawnSync(process.execPath, ["scripts/verify-report-set-evidence.js", f.path, "--json"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, "");
  assert.equal(result.stdout, JSON.stringify(await reviewReportSetComparisonEvidence(f.file.text), null, 2) + "\n");
  assert.equal(await readFile(f.path, "utf8"), f.file.text); assert.equal(JSON.parse(result.stdout).imported, false);
});
test("altered comparison results exit 2, while a changed embedded source checksum exits 1", async t => {
  const f = await fixture(t), data = JSON.parse(f.file.text), comparison = JSON.parse(data.comparisonText);
  comparison.comparison.rows = []; data.comparisonText = JSON.stringify(comparison); await writeFile(f.path, JSON.stringify(data));
  const changed = await run([f.path, "--json"]); assert.equal(changed.exitCode, 2); assert.equal(JSON.parse(changed.output).comparisonReview.matchesRecomputation, false);
  const before = JSON.parse(data.beforeFileText); before.digest = "0".repeat(64); data.beforeFileText = JSON.stringify(before); await writeFile(f.path, JSON.stringify(data));
  const broken = await run([f.path]); assert.equal(broken.exitCode, 1); assert.equal(broken.output, ""); assert.match(broken.errors, /CHECKSUM/);
});
test("invalid encoding and missing paths cannot leak inputs or produce partial receipts", async t => {
  const f = await fixture(t); await writeFile(f.path, new Uint8Array([0xc3, 0x28]));
  const invalid = await run([f.path]); assert.equal(invalid.exitCode, 1); assert.equal(invalid.output, "");
  const missing = await run([join(f.folder, "PRIVATE_PATH.json")]); assert.equal(missing.exitCode, 1); assert.equal(missing.output, ""); assert.doesNotMatch(missing.errors, /PRIVATE_PATH/);
});
