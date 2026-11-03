import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { prepareReportSetHistoryFile } from "../src/report-set-export.js";
import { sequenceSet, demoSetHistory } from "./helpers/report-set-fixtures.js";
import { parseSetHistoryArgs } from "../scripts/recover-report-set-history.js";
const run = args => spawnSync(process.execPath, ["scripts/recover-report-set-history.js", ...args], { encoding: "utf8", timeout: 15000 });
test("standalone history recovery matches shared output including original notes and changes no source", async () => {
  const folder = await mkdtemp(join(tmpdir(), "threecore-history-recovery-"));
  try {
    const source = sequenceSet(demoSetHistory()), file = await prepareReportSetFile(source), path = join(folder, "source.json");
    await writeFile(path, file.text); const actual = run([path]);
    assert.equal(actual.status, 0, actual.stderr); assert.equal(actual.stderr, "");
    assert.equal(actual.stdout, (await prepareReportSetHistoryFile(source)).text); assert.equal(await readFile(path, "utf8"), file.text);
    const damaged = JSON.parse(file.text); damaged.digest = "0".repeat(64); await writeFile(path, JSON.stringify(damaged));
    const corrupt = run([path]); assert.equal(corrupt.status, 1); assert.equal(corrupt.stdout, ""); assert.match(corrupt.stderr, /PERIOD_CHECKSUM/);
    await writeFile(path, new Uint8Array([0xc3, 0x28])); const invalid = run([path]); assert.equal(invalid.status, 1); assert.equal(invalid.stdout, "");
    const missing = run([join(folder, "PRIVATE_PATH.json")]); assert.equal(missing.status, 1); assert.doesNotMatch(missing.stderr, /PRIVATE_PATH/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test("history recovery requires one source file and describes its limited original scope", () => {
  for (const args of [[], ["a.json", "--force"], ["a.csv"], ["a.json", "b.json"], [null]]) assert.throws(() => parseSetHistoryArgs(args));
  const help = run(["--help"]); assert.equal(help.status, 0); assert.match(help.stdout, /Entries absent from the set cannot be recovered/);
});
