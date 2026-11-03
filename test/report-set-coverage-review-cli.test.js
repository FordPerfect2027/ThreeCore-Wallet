import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseCoverageReviewArgs, runCoverageReview } from "../scripts/verify-history-coverage.js";
import { prepareReportSetCoverageFile, reviewReportSetCoverageFile } from "../src/report-set-export.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { sequenceSet, sequenceHistory } from "./helpers/report-set-fixtures.js";
async function fixture(t) {
  const prefix = join(tmpdir(), "threecore-coverage-review-"), folder = await mkdtemp(prefix);
  t.after(async () => { assert.ok(resolve(folder).startsWith(resolve(prefix))); await rm(folder, { recursive: true, force: true }); });
  const input = sequenceSet(sequenceHistory([0n, 24n], report => { report.slots[0].entry.draft.records = report.slots[0].entry.draft.records.slice(0, 1); }));
  const source = await prepareReportSetFile(input), coverage = await prepareReportSetCoverageFile(input);
  const sourcePath = join(folder, "source set.json"), coveragePath = join(folder, "coverage.json");
  await writeFile(sourcePath, source.text); await writeFile(coveragePath, coverage.text);
  return { input, source, coverage, sourcePath, coveragePath, folder };
}
async function run(args) { let output = "", errors = ""; const code = await runCoverageReview(args, { stdout: { write(v) { output += v; } }, stderr: { write(v) { errors += v; } } }); return { code, output, errors }; }

test("coverage verification CLI requires two files and explains that a match is not complete history", async () => {
  assert.deepEqual(parseCoverageReviewArgs(["source.JSON", "coverage.json", "--json"]), { source: "source.JSON", coverage: "coverage.json", json: true });
  for (const args of [[], ["source.json"], ["source.json", "coverage.csv"], ["-s.json", "c.json"], ["s\0.json", "c.json"], ["s.json", "c.json", "--apply"]]) {
    const result = await run(args); assert.equal(result.code, 1); assert.equal(result.output, "");
  }
  const help = await run(["--help"]); assert.equal(help.code, 0); assert.match(help.output, /does not prove complete/);
});

test("standalone coverage verification reproduces the shared receipt while retaining pending and unplanned ranges", async t => {
  const f = await fixture(t), result = spawnSync(process.execPath, ["scripts/verify-history-coverage.js", f.sourcePath, f.coveragePath, "--json"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, "");
  const expected = { ...await reviewReportSetCoverageFile(f.input, f.coverage.text), sourceChecksumVerified: true };
  assert.equal(expected.groups[0].pendingPlannedBlocks, "14"); assert.equal(expected.groups[0].unplannedBlocks, "12");
  assert.equal(result.stdout, JSON.stringify(expected, null, 2) + "\n");
  assert.equal(await readFile(f.sourcePath, "utf8"), f.source.text); assert.equal(await readFile(f.coveragePath, "utf8"), f.coverage.text);
});

test("altered coverage exits 2 while bad original checksums and unreadable inputs yield no partial result", async t => {
  const f = await fixture(t), data = JSON.parse(f.coverage.text); data.groups[0].pendingPlannedBlocks = "0";
  await writeFile(f.coveragePath, JSON.stringify(data)); let result = await run([f.sourcePath, f.coveragePath, "--json"]);
  assert.equal(result.code, 2); assert.equal(JSON.parse(result.output).matchesRecomputation, false);
  const source = JSON.parse(f.source.text); source.digest = "0".repeat(64); await writeFile(f.sourcePath, JSON.stringify(source));
  result = await run([f.sourcePath, f.coveragePath]); assert.equal(result.code, 1); assert.equal(result.output, "");
  await writeFile(f.sourcePath, f.source.text); await writeFile(f.coveragePath, new Uint8Array([0xc3, 0x28]));
  result = await run([f.sourcePath, f.coveragePath]); assert.equal(result.code, 1); assert.equal(result.output, "");
  result = await run([f.sourcePath, join(f.folder, "PRIVATE_NAME.json")]); assert.equal(result.code, 1); assert.equal(result.output, ""); assert.doesNotMatch(result.errors, /PRIVATE_NAME/);
});
