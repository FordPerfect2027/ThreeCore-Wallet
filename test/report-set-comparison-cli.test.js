import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseSetComparisonArgs, runSetComparison } from "../scripts/compare-report-sets.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { prepareReportSetComparisonFile } from "../src/report-set-export.js";
import { sequenceSet, demoSetHistory, clone } from "./helpers/report-set-fixtures.js";

async function pair(t, before = sequenceSet(), after = sequenceSet(demoSetHistory())) {
  const prefix = join(tmpdir(), "threecore-set-comparison-cli-"), folder = await mkdtemp(prefix);
  t.after(async () => { assert.ok(resolve(folder).startsWith(resolve(prefix))); await rm(folder, { recursive: true, force: true }); });
  const left = await prepareReportSetFile(before), right = await prepareReportSetFile(after);
  const beforePath = join(folder, "before source.json"), afterPath = join(folder, "after source.json");
  await writeFile(beforePath, left.text); await writeFile(afterPath, right.text);
  return { before, after, left, right, beforePath, afterPath, folder, args: [beforePath, afterPath] };
}
async function run(args) {
  let output = "", errors = "";
  const exitCode = await runSetComparison(args, { stdout: { write(value) { output += value; } }, stderr: { write(value) { errors += value; } } });
  return { exitCode, output, errors };
}
test("comparison CLI parses explicit paired files and rejects duplicate or unknown options", async () => {
  assert.deepEqual(parseSetComparisonArgs(["before.JSON", "after.json", "--json", "--require-same"]), { before: "before.JSON", after: "after.json", json: true, requireSame: true });
  for (const args of [[], ["one.json"], ["one.json", "two.csv"], ["one.json", "--two.json"], ["one.json", "two.json", "--json", "--json"],
    ["one.json", "two.json", "--overwrite"], ["one.json", "two.json", "--format", "json"], ["one\0.json", "two.json"]]) {
    assert.throws(() => parseSetComparisonArgs(args)); const result = await run(args); assert.equal(result.exitCode, 1); assert.equal(result.output, "");
  }
});
test("comparison CLI help needs no original files and explains strict comparison scope", async () => {
  const result = await run(["--help"]); assert.equal(result.exitCode, 0); assert.equal(result.errors, "");
  assert.match(result.output, /including metadata or order/); assert.match(result.output, /No network, merge or input-file writes/);
});
test("standalone comparison JSON reproduces every byte of the screen receipt and leaves originals unchanged", async t => {
  const f = await pair(t), expected = await prepareReportSetComparisonFile(f.before, f.after);
  const result = spawnSync(process.execPath, ["scripts/compare-report-sets.js", ...f.args, "--json"], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, ""); assert.equal(result.stdout, expected.text);
  const data = JSON.parse(result.stdout); assert.equal(data.beforePayloadDigest, f.left.digest); assert.equal(data.afterPayloadDigest, f.right.digest);
  assert.equal(await readFile(f.beforePath, "utf8"), f.left.text); assert.equal(await readFile(f.afterPath, "utf8"), f.right.text);
});
test("strict comparison ignores original-file formatting but detects metadata and order changes", async t => {
  const source = sequenceSet(), f = await pair(t, source, clone(source));
  await writeFile(f.afterPath, JSON.stringify(JSON.parse(f.right.text)));
  const same = await run([...f.args, "--json", "--require-same"]); assert.equal(same.exitCode, 0); assert.equal(JSON.parse(same.output).comparison.sameContents, true);
  const changed = clone(source); changed.title = "Renamed";
  await writeFile(f.afterPath, (await prepareReportSetFile(changed)).text);
  const renamed = await run([...f.args, "--json", "--require-same"]); assert.equal(renamed.exitCode, 2); assert.match(renamed.errors, /DIFFERENT/);
  changed.title = source.title; changed.entries.reverse(); await writeFile(f.afterPath, (await prepareReportSetFile(changed)).text);
  const reordered = await run([...f.args, "--json", "--require-same"]); assert.equal(reordered.exitCode, 2); assert.equal(JSON.parse(reordered.output).comparison.orderChanged, true);
});
test("text comparison keeps the old-versus-new scope and both source digests", async t => {
  const f = await pair(t), result = await run(f.args);
  assert.equal(result.exitCode, 0); assert.match(result.output, /現在表示中の確認セットとの差/);
  assert.ok(result.output.includes(f.left.digest)); assert.ok(result.output.includes(f.right.digest));
  assert.match(result.output, /PC内の保存履歴を削除しません/); assert.match(result.output, /current chain state remain unverified/);
});
test("neither malformed second inputs nor corrupt checksums can produce partial comparison output", async t => {
  const f = await pair(t), altered = JSON.parse(f.right.text); altered.digest = "0".repeat(64);
  await writeFile(f.afterPath, JSON.stringify(altered));
  const corrupted = await run([...f.args, "--json"]); assert.equal(corrupted.exitCode, 1); assert.equal(corrupted.output, ""); assert.match(corrupted.errors, /CHECKSUM/);
  await writeFile(f.afterPath, new Uint8Array([0xc3, 0x28]));
  const encoding = await run(f.args); assert.equal(encoding.exitCode, 1); assert.equal(encoding.output, "");
  const missing = await run([f.beforePath, join(f.folder, "PRIVATE_PATH.json")]);
  assert.equal(missing.exitCode, 1); assert.equal(missing.output, ""); assert.doesNotMatch(missing.errors, /PRIVATE_PATH/);
});
