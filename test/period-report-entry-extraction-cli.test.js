import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { preparePeriodReportFile, preparePeriodReportEntryFile } from "../src/period-report-file.js";
import { reportInput, changedSlot } from "./helpers/period-report-fixtures.js";
import { parseExtractPeriodEntryArgs } from "../scripts/extract-period-report-entry.js";
const run = args => spawnSync(process.execPath, ["scripts/extract-period-report-entry.js", ...args], { encoding: "utf8", timeout: 15000 });
test("standalone extraction verifies the source and exactly reproduces the selected restricted original", async () => {
  const folder = await mkdtemp(join(tmpdir(), "threecore-entry-"));
  try {
    const input = reportInput({ changes: { DAT: { requiresNewPlan: true, archived: true } } }), file = await preparePeriodReportFile(input), path = join(folder, "source.json");
    await writeFile(path, file.text);
    for (const agent of ["DAT", "EMA", "CAWELON"]) {
      const result = run([path, "--agent", agent]); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, "");
      assert.equal(result.stdout, (await preparePeriodReportEntryFile(input, agent)).text);
    }
    assert.equal(await readFile(path, "utf8"), file.text);
    const malformed = JSON.parse(file.text); malformed.digest = "0".repeat(64); await writeFile(path, JSON.stringify(malformed));
    const bad = run([path, "--agent", "DAT"]); assert.equal(bad.status, 1); assert.equal(bad.stdout, ""); assert.match(bad.stderr, /PERIOD_CHECKSUM/);
    const missing = changedSlot(input, "EMA", (_entry, slot) => { slot.entry = null; }); await writeFile(path, (await preparePeriodReportFile(missing)).text);
    const absent = run([path, "--agent", "EMA"]); assert.equal(absent.status, 1); assert.equal(absent.stdout, ""); assert.match(absent.stderr, /PERIOD_REPORT_ENTRY_MISSING/);
    await writeFile(path, new Uint8Array([0xc3, 0x28])); const utf8 = run([path, "--agent", "DAT"]); assert.equal(utf8.status, 1); assert.equal(utf8.stdout, "");
    const hidden = run([join(folder, "PRIVATE_FILENAME.json"), "--agent", "DAT"]); assert.equal(hidden.status, 1); assert.doesNotMatch(hidden.stderr, /PRIVATE_FILENAME/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
test("entry CLI requires a single explicit token and documents extraction limits", () => {
  for (const args of [[], ["a.json"], ["a.json", "--agent", "all"], ["a.json", "--agent", "dat"], ["a.json", "--agent", "DAT", "--json"], ["a.csv", "--agent", "DAT"]]) assert.throws(() => parseExtractPeriodEntryArgs(args));
  const result = run(["--help"]); assert.equal(result.status, 0); assert.match(result.stdout, /not that the record is complete/);
});
