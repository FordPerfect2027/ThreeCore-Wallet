import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseMissingHistoryArgs, runMissingHistoryPlan } from "../scripts/plan-missing-history.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { reportSetMissingHistoryQueue, missingHistoryQueueText } from "../src/report-set-timeline.js";
import { sequenceSet, sequenceHistory, demoSetHistory } from "./helpers/report-set-fixtures.js";

function unfinished() { return sequenceSet(sequenceHistory([0n], report => {
  const draft = report.slots[0].entry.draft; draft.plan.laterBlock = "24030"; draft.plan.windowSize = 2000;
  draft.earlier = null; draft.later = null; draft.records = [];
})); }
async function sourceFile(t, input = unfinished()) {
  const prefix = join(tmpdir(), "threecore-missing-queue-cli-"), folder = await mkdtemp(prefix);
  t.after(async () => { assert.ok(resolve(folder).startsWith(resolve(prefix))); await rm(folder, { recursive: true, force: true }); });
  const file = await prepareReportSetFile(input), path = join(folder, "synthetic source.json");
  await writeFile(path, file.text); return { input, path, folder, ...file };
}
async function run(args) {
  let output = "", errors = "";
  const exitCode = await runMissingHistoryPlan(args, { stdout: { write(value) { output += value; } }, stderr: { write(value) { errors += value; } } });
  return { exitCode, output, errors };
}
test("queue CLI requires an explicit group, validates flags and converts one-based pages exactly", async () => {
  const parsed = parseMissingHistoryArgs(["file.JSON", "--group", "EMA-2", "--kind", "unplanned", "--window-size", "17", "--page", "9007199254740999", "--format", "text", "--require-empty"]);
  assert.deepEqual(parsed.query, { groupId: "EMA-2", kind: "unplanned", windowSize: 17, page: "9007199254740998" });
  assert.equal(parsed.requireEmpty, true);
  for (const args of [[], ["file.json"], ["file.csv", "--group", "DAT-1"], ["file.json", "--group", "all"],
    ["file.json", "--group", "DAT-1", "--page", "0"], ["file.json", "--group", "DAT-1", "--page", "01"],
    ["file.json", "--group", "DAT-1", "--window-size", "2001"], ["file.json", "--group", "DAT-1", "--window-size", "1e3"],
    ["file.json", "--group", "DAT-1", "--kind", "recorded"], ["file.json", "--group", "DAT-1", "--format", "csv"],
    ["file.json", "--group", "DAT-1", "--group", "EMA-1"], ["file.json", "--group", "DAT-1", "--require-empty", "--require-empty"]]) {
    assert.throws(() => parseMissingHistoryArgs(args)); const failed = await run(args); assert.equal(failed.exitCode, 1); assert.equal(failed.output, "");
  }
});
test("help explains grouping, planning-only scope and strict exit semantics without reading a file", async () => {
  const result = await run(["--help"]); assert.equal(result.exitCode, 0); assert.equal(result.errors, "");
  assert.match(result.output, /Nothing is executed/); assert.match(result.output, /across all pages/); assert.match(result.output, /one-based/);
});
test("standalone JSON equals shared queue fields and binds the verified original without modifying it", async t => {
  const f = await sourceFile(t), args = [f.path, "--group", "DAT-1"];
  const child = spawnSync(process.execPath, ["scripts/plan-missing-history.js", ...args], { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15000 });
  assert.equal(child.error, undefined); assert.equal(child.status, 0); assert.equal(child.stderr, "");
  const data = JSON.parse(child.stdout), expected = reportSetMissingHistoryQueue(f.input, { groupId: "DAT-1" });
  for (const key of Object.keys(expected)) assert.deepEqual(data[key], expected[key]);
  assert.equal(data.sourcePayloadDigest, f.digest); assert.equal(data.sourceChecksumVerified, true); assert.equal(data.pageBlocks, "20000");
  assert.equal(data.sourceSummary.allContinuous, false); assert.equal(data.authenticated, false); assert.equal(data.restorable, false);
  assert.equal(await readFile(f.path, "utf8"), f.text);
});
test("second-page strict output retains all-page missing counts and text matches the UI proposal", async t => {
  const f = await sourceFile(t), args = [f.path, "--group", "DAT-1", "--page", "2", "--require-empty"];
  const result = await run(args); assert.equal(result.exitCode, 2); assert.match(result.errors, /MISSING_RANGES/);
  const data = JSON.parse(result.output); assert.equal(data.pageBlocks, "4000"); assert.equal(data.totalBlocks, "24000"); assert.equal(data.items[0].number, "11");
  const text = await run([...args, "--format", "text"]); assert.equal(text.exitCode, 2);
  assert.ok(text.output.startsWith(missingHistoryQueueText(reportSetMissingHistoryQueue(f.input, { groupId: "DAT-1", page: "1" }))));
});
test("an empty selected queue preserves whole-source conflicts and excluded recorded review ranges", async t => {
  const f = await sourceFile(t, sequenceSet(demoSetHistory())), result = await run([f.path, "--group", "DAT-1", "--require-empty"]);
  assert.equal(result.exitCode, 0); const data = JSON.parse(result.output);
  assert.equal(data.totalWindows, "0"); assert.equal(data.sourceSummary.allContinuous, false); assert.ok(data.sourceSummary.issues.includes("HASH_CONFLICTS"));
  assert.ok(BigInt(data.reviewRecordedBlocks) > 0n); assert.equal(data.includesRecordedReviewRanges, false);
});
test("an explicit unplanned gap can be queried on its final huge-offset page", async t => {
  const f = await sourceFile(t, sequenceSet(sequenceHistory([0n, 9007199254741011n])));
  const first = JSON.parse((await run([f.path, "--group", "DAT-1", "--kind", "unplanned"])).output);
  const last = await run([f.path, "--group", "DAT-1", "--kind", "unplanned", "--page", first.pageCount, "--require-empty"]);
  assert.equal(last.exitCode, 2); assert.equal(JSON.parse(last.output).items.at(-1).fromBlock, "43");
});
test("missing groups and out-of-range pages have no partial stdout", async t => {
  const f = await sourceFile(t);
  for (const args of [[f.path, "--group", "DAT-2"], [f.path, "--group", "DAT-1", "--page", "3"]]) {
    const result = await run(args); assert.equal(result.exitCode, 1); assert.equal(result.output, "");
  }
});
test("corrupt checksums, wrong formats, malformed bytes and missing paths produce safe errors", async t => {
  const f = await sourceFile(t), parsed = JSON.parse(f.text); parsed.digest = "0".repeat(64);
  await writeFile(f.path, JSON.stringify(parsed)); const bad = await run([f.path, "--group", "DAT-1"]);
  assert.equal(bad.exitCode, 1); assert.equal(bad.output, ""); assert.match(bad.errors, /CHECKSUM/);
  await writeFile(f.path, (await preparePeriodReportFile(f.input.entries[0].report)).text);
  assert.equal((await run([f.path, "--group", "DAT-1"])).output, "");
  await writeFile(f.path, new Uint8Array([0xc3, 0x28])); const encoding = await run([f.path, "--group", "DAT-1"]);
  assert.equal(encoding.exitCode, 1); assert.equal(encoding.output, "");
  const missing = await run([join(f.folder, "PRIVATE_PATH.json"), "--group", "DAT-1"]);
  assert.equal(missing.exitCode, 1); assert.equal(missing.output, ""); assert.doesNotMatch(missing.errors, /PRIVATE_PATH/);
});
