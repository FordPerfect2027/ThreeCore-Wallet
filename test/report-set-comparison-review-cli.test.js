import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseComparisonReviewArgs, runComparisonReview } from "../scripts/verify-report-set-comparison.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { prepareReportSetComparisonFile, reviewReportSetComparisonFile } from "../src/report-set-export.js";
import { sequenceSet, demoSetHistory } from "./helpers/report-set-fixtures.js";

async function fixture(t) {
  const prefix = join(tmpdir(), "threecore-set-comparison-review-"), folder = await mkdtemp(prefix);
  t.after(async () => { assert.ok(resolve(folder).startsWith(resolve(prefix))); await rm(folder, { recursive: true, force: true }); });
  const before = sequenceSet(), after = sequenceSet(demoSetHistory());
  const texts = [(await prepareReportSetFile(before)).text, (await prepareReportSetFile(after)).text,
    (await prepareReportSetComparisonFile(before, after)).text];
  const paths = ["before source.json", "after source.json", "saved comparison.json"].map(name => join(folder, name));
  for (let i = 0; i < paths.length; i++) await writeFile(paths[i], texts[i]);
  return { before, after, texts, paths, folder };
}
async function run(args) {
  let output = "", errors = "";
  const exitCode = await runComparisonReview(args, { stdout: { write(value) { output += value; } }, stderr: { write(value) { errors += value; } } });
  return { output, errors, exitCode };
}
test("comparison-review CLI requires three ordered JSON paths and documents match versus identical", async () => {
  assert.deepEqual(parseComparisonReviewArgs(["a.JSON", "b.json", "c.json", "--json"]), { before: "a.JSON", after: "b.json", comparison: "c.json", json: true });
  for (const args of [[], ["a.json", "b.json"], ["a.json", "b.json", "c.txt"], ["--a.json", "b.json", "c.json"],
    ["a.json", "b.json", "c.json", "--repair"], ["a.json", "b.json", "c.json", "--json", "--json"], ["a\0.json", "b.json", "c.json"]]) {
    assert.throws(() => parseComparisonReviewArgs(args)); const result = await run(args); assert.equal(result.exitCode, 1); assert.equal(result.output, "");
  }
  const help = await run(["--help"]); assert.equal(help.exitCode, 0); assert.match(help.output, /File order matters/);
  assert.match(help.output, /does not mean the originals are equal/);
});
test("standalone CLI returns the same review as the screen helper and leaves all three inputs intact", async t => {
  const f = await fixture(t), result = spawnSync(process.execPath, ["scripts/verify-report-set-comparison.js", ...f.paths, "--json"],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 20000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, "");
  const expected = await reviewReportSetComparisonFile(f.before, f.after, f.texts[2]);
  assert.deepEqual(JSON.parse(result.stdout), { ...expected, beforeChecksumVerified: true, afterChecksumVerified: true });
  assert.equal(expected.sameContents, false);
  for (let i = 0; i < f.paths.length; i++) assert.equal(await readFile(f.paths[i], "utf8"), f.texts[i]);
});
test("changed comparison contents and swapped sources exit 2 with usable source-bound receipts", async t => {
  const f = await fixture(t), data = JSON.parse(f.texts[2]); data.comparison.counts.added = 0;
  await writeFile(f.paths[2], JSON.stringify(data)); const changed = await run([...f.paths, "--json"]);
  assert.equal(changed.exitCode, 2); assert.equal(JSON.parse(changed.output).beforeDigestMatches, true);
  assert.ok(JSON.parse(changed.output).differences.includes("comparison"));
  await writeFile(f.paths[2], f.texts[2]); const swapped = await run([f.paths[1], f.paths[0], f.paths[2], "--json"]);
  assert.equal(swapped.exitCode, 2); assert.equal(JSON.parse(swapped.output).beforeDigestMatches, false);
  const text = await run(f.paths); assert.equal(text.exitCode, 0); assert.match(text.output, /contents identical: false/);
  assert.match(text.output, /not authorship or live-chain verification/);
});
test("corrupt originals, invalid text and missing paths fail without emitting a partial review", async t => {
  const f = await fixture(t), data = JSON.parse(f.texts[1]); data.digest = "0".repeat(64);
  await writeFile(f.paths[1], JSON.stringify(data)); let result = await run([...f.paths, "--json"]);
  assert.equal(result.exitCode, 1); assert.equal(result.output, ""); assert.match(result.errors, /CHECKSUM/);
  await writeFile(f.paths[1], f.texts[1]); await writeFile(f.paths[2], new Uint8Array([0xc3, 0x28])); result = await run(f.paths);
  assert.equal(result.exitCode, 1); assert.equal(result.output, "");
  result = await run([f.paths[0], f.paths[1], join(f.folder, "PRIVATE_MISSING.json")]);
  assert.equal(result.exitCode, 1); assert.equal(result.output, ""); assert.doesNotMatch(result.errors, /PRIVATE_MISSING/);
});
