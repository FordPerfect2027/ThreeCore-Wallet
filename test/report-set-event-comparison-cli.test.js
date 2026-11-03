import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseSavedEventArgs, runSavedEventComparison } from "../scripts/compare-saved-events.js";
import { prepareReportSetEventComparisonFile } from "../src/report-set-export.js";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { sequenceSet, sequenceHistory, id } from "./helpers/report-set-fixtures.js";
const query = { beforeId: id(101), afterId: id(102), agent: "DAT" };
const args = path => [path, "--before", query.beforeId, "--after", query.afterId, "--agent", query.agent];
async function fixture(t, source = sequenceSet(sequenceHistory([0n, 0n]))) {
  const prefix = join(tmpdir(), "threecore-event-compare-"), folder = await mkdtemp(prefix);
  t.after(async () => { assert.ok(resolve(folder).startsWith(resolve(prefix))); await rm(folder, { recursive: true, force: true }); });
  const file = await prepareReportSetFile(source), path = join(folder, "source set.json"); await writeFile(path, file.text);
  return { source, file, path, folder };
}
async function run(values) {
  let output = "", errors = "";
  const code = await runSavedEventComparison(values, { stdout: { write(v) { output += v; } }, stderr: { write(v) { errors += v; } } });
  return { output, errors, code };
}
test("saved-event CLI demands explicit pair and token before reading any input", async () => {
  assert.deepEqual(parseSavedEventArgs(args("input.JSON")), { path: "input.JSON", query });
  for (const values of [[], ["input.json"], args("input.csv"), args("-input.json"), args("x\0.json"),
    [...args("a.json"), "--send"], ["a.json", "--before", id(101), "--after", id(101), "--agent", "DAT"]]) {
    const result = await run(values); assert.equal(result.code, 1); assert.equal(result.output, "");
  }
  const help = await run(["--help"]); assert.equal(help.code, 0); assert.match(help.output, /full event values and addresses/);
});
test("standalone comparison reproduces complete screen JSON and leaves source unchanged", async t => {
  const f = await fixture(t);
  const result = spawnSync(process.execPath, ["scripts/compare-saved-events.js", ...args(f.path)],
    { cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 15000 });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, "");
  assert.equal(result.stdout, (await prepareReportSetEventComparisonFile(f.source, query)).text);
  assert.equal(await readFile(f.path, "utf8"), f.file.text);
});
test("differences and absent common saved coverage both exit 2 with distinguishable results", async t => {
  const changed = sequenceSet(sequenceHistory([0n, 0n], (report, index) => { if (index === 1) report.slots[0].entry.draft.records[0].events = []; }));
  const f = await fixture(t, changed); let result = await run(args(f.path));
  assert.equal(result.code, 2); assert.equal(JSON.parse(result.output).comparison.status, "differences");
  await writeFile(f.path, (await prepareReportSetFile(sequenceSet())).text); result = await run(args(f.path));
  assert.equal(result.code, 2); assert.equal(JSON.parse(result.output).comparison.status, "no-common-coverage");
});
test("checksum errors, bad encoding and missing paths yield no partial comparison", async t => {
  const f = await fixture(t), data = JSON.parse(f.file.text); data.digest = "0".repeat(64); await writeFile(f.path, JSON.stringify(data));
  const changed = await run(args(f.path)); assert.equal(changed.code, 1); assert.equal(changed.output, ""); assert.match(changed.errors, /CHECKSUM/);
  await writeFile(f.path, new Uint8Array([0xc3, 0x28])); const invalid = await run(args(f.path)); assert.equal(invalid.code, 1); assert.equal(invalid.output, "");
  const missing = await run(args(join(f.folder, "PRIVATE_PATH.json"))); assert.equal(missing.code, 1); assert.equal(missing.output, ""); assert.doesNotMatch(missing.errors, /PRIVATE_PATH/);
});
