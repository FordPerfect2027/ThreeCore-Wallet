import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseEventReviewArgs, runEventReview } from "../scripts/verify-saved-event-comparison.js";
import { prepareReportSetEventComparisonFile, reviewReportSetEventComparisonFile } from "../src/report-set-export.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { sequenceSet, sequenceHistory, id } from "./helpers/report-set-fixtures.js";
const query = { beforeId: id(101), afterId: id(102), agent: "DAT" };
async function fixture(t) {
  const prefix = join(tmpdir(), "threecore-event-review-"), folder = await mkdtemp(prefix);
  t.after(async () => { assert.ok(resolve(folder).startsWith(resolve(prefix))); await rm(folder, { recursive: true, force: true }); });
  const input = sequenceSet(sequenceHistory([0n, 0n], (report, index) => { if (index) report.slots[0].entry.draft.records[0].events = []; }));
  const source = await prepareReportSetFile(input), comparison = await prepareReportSetEventComparisonFile(input, query);
  const sourcePath = join(folder, "source set.json"), comparisonPath = join(folder, "comparison.json");
  await writeFile(sourcePath, source.text); await writeFile(comparisonPath, comparison.text);
  return { input, source, comparison, sourcePath, comparisonPath, folder };
}
async function run(args) { let output = "", errors = ""; const code = await runEventReview(args, { stdout: { write(v) { output += v; } }, stderr: { write(v) { errors += v; } } }); return { code, output, errors }; }

test("event review CLI requires two files and identifies the meaning of exit 0", async () => {
  assert.deepEqual(parseEventReviewArgs(["source.JSON", "comparison.json", "--json"]), { source: "source.JSON", comparison: "comparison.json", json: true });
  for (const args of [[], ["source.json"], ["source.json", "compare.csv"], ["-s.json", "c.json"], ["s\0.json", "c.json"], ["s.json", "c.json", "--apply"]]) {
    const result = await run(args); assert.equal(result.code, 1); assert.equal(result.output, "");
  }
  const help = await run(["--help"]); assert.equal(help.code, 0); assert.match(help.output, /does not mean/);
});

test("standalone review reproduces the shared receipt for a faithful comparison that reports differences", async t => {
  const f = await fixture(t), result = spawnSync(process.execPath, ["scripts/verify-saved-event-comparison.js", f.sourcePath, f.comparisonPath, "--json"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, "");
  const expected = { ...await reviewReportSetEventComparisonFile(f.input, f.comparison.text), sourceChecksumVerified: true };
  assert.equal(expected.comparisonStatus, "differences"); assert.equal(result.stdout, JSON.stringify(expected, null, 2) + "\n");
  assert.equal(await readFile(f.sourcePath, "utf8"), f.source.text); assert.equal(await readFile(f.comparisonPath, "utf8"), f.comparison.text);
});

test("altered comparisons exit 2 but corrupt originals and invalid files emit no partial receipt", async t => {
  const f = await fixture(t), data = JSON.parse(f.comparison.text); data.comparison.counts.onlyBefore = 999;
  await writeFile(f.comparisonPath, JSON.stringify(data)); let result = await run([f.sourcePath, f.comparisonPath, "--json"]);
  assert.equal(result.code, 2); assert.equal(JSON.parse(result.output).matchesRecomputation, false);
  const source = JSON.parse(f.source.text); source.digest = "0".repeat(64); await writeFile(f.sourcePath, JSON.stringify(source));
  result = await run([f.sourcePath, f.comparisonPath, "--json"]); assert.equal(result.code, 1); assert.equal(result.output, "");
  await writeFile(f.sourcePath, f.source.text); await writeFile(f.comparisonPath, new Uint8Array([0xc3, 0x28]));
  result = await run([f.sourcePath, f.comparisonPath]); assert.equal(result.code, 1); assert.equal(result.output, "");
  result = await run([f.sourcePath, join(f.folder, "PRIVATE_NAME.json")]); assert.equal(result.code, 1); assert.equal(result.output, ""); assert.doesNotMatch(result.errors, /PRIVATE_NAME/);
});
