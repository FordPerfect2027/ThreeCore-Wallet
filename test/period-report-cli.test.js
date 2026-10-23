import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseReportArgs, inspectReportPath, runReportCheck } from "../scripts/check-period-report.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { reportInput, changedSlot, forkedInput, ACCOUNT, OTHER } from "./helpers/period-report-fixtures.js";

async function temporary(callback) {
  const directory = await mkdtemp(join(tmpdir(), "threecore-report-test-"));
  try { await callback(directory); }
  finally {
    if (!resolve(directory).startsWith(resolve(tmpdir()) + "/".replace("/", process.platform === "win32" ? "\\" : "/") + "threecore-report-test-")) throw Error("Unexpected test directory");
    await rm(directory, { recursive: true, force: true });
  }
}

async function saved(directory, input = reportInput()) {
  const path = join(directory, "report.json");
  await writeFile(path, (await preparePeriodReportFile(input)).text, "utf8");
  return path;
}

function output() {
  let stdout = "", stderr = "";
  return { streams: { stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } },
    get stdout() { return stdout; }, get stderr() { return stderr; } };
}

test("CLI arguments support independent flag order and uppercase file extension", () => {
  assert.deepEqual(parseReportArgs(["--json", "FILE.JSON", "--require-agreement"]),
    { path: "FILE.JSON", json: true, requireAgreement: true });
  assert.deepEqual(parseReportArgs(["report.json"]), { path: "report.json", json: false, requireAgreement: false });
});

for (const args of [[], ["--json"], ["file.txt"], ["a.json", "b.json"], ["a.json", "--unknown"],
  ["a.json", "--json", "--json"], ["a.json", "--require-agreement", "--require-agreement"],
  ["-unsafe.json"], [null], [1]]) {
  test("CLI rejects arguments " + JSON.stringify(args), () => {
    assert.throws(() => parseReportArgs(args), /PERIOD_REPORT_CLI_ARGUMENTS/);
  });
}

test("CLI reports all-three agreement without exposing addresses or amounts", () => temporary(async directory => {
  const path = await saved(directory), before = await readFile(path);
  const value = await inspectReportPath(path);
  assert.equal(value.status, "arithmetic-agreement");
  assert.equal(value.allArithmeticAgreement, true);
  assert.equal(value.checksumVerified, true);
  assert.equal(value.authenticated, false);
  assert.equal(value.liveChainRechecked, false);
  assert.equal(value.securityAudit, false);
  const text = JSON.stringify(value);
  assert.ok(!text.includes(ACCOUNT)); assert.ok(!text.includes(OTHER));
  assert.ok(!text.includes("107000000000000000000"));
  assert.ok(!text.includes("期間確認"));
  assert.deepEqual(await readFile(path), before);
}));

test("CLI strict mode distinguishes missing evidence from an invalid file", () => temporary(async directory => {
  const path = await saved(directory, reportInput({ counts: [3, 5, 5] }));
  const strict = output();
  assert.equal(await runReportCheck([path, "--json", "--require-agreement"], strict.streams), 2);
  assert.equal(JSON.parse(strict.stdout).status, "incomplete");
  assert.match(strict.stderr, /PERIOD_REPORT_CLI_NO_AGREEMENT/);
  const ordinary = output();
  assert.equal(await runReportCheck([path], ordinary.streams), 0);
  assert.match(ordinary.stdout, /DAT: partial/);
  assert.equal(ordinary.stderr, "");
}));

test("CLI strict success requires all three same-period records", () => temporary(async directory => {
  const path = await saved(directory), sink = output();
  assert.equal(await runReportCheck([path, "--require-agreement"], sink.streams), 0);
  assert.match(sink.stdout, /historical report: arithmetic-agreement/);
  assert.equal(sink.stderr, "");
}));

test("CLI conflict reports contain only counts and diagnostic codes", () => temporary(async directory => {
  const path = await saved(directory, forkedInput());
  const result = await inspectReportPath(path);
  assert.ok(result.conflictingBlocks > 0);
  assert.ok(result.issues.includes("BLOCK_HASH_CONFLICT"));
  assert.equal(result.allArithmeticAgreement, false);
  assert.ok(!JSON.stringify(result).includes("0x"));
}));

test("CLI quarantined record cannot satisfy strict mode despite matching arithmetic", () => temporary(async directory => {
  const path = await saved(directory, reportInput({ changes: { EMA: { requiresNewPlan: true } } }));
  const sink = output();
  assert.equal(await runReportCheck([path, "--require-agreement"], sink.streams), 2);
  assert.match(sink.stdout, /EMA: requires-new-plan/);
}));

test("CLI refuses corrupted checksums without leaking source text", () => temporary(async directory => {
  const path = await saved(directory), value = JSON.parse(await readFile(path, "utf8"));
  value.input.title = "PRIVATE LABEL"; await writeFile(path, JSON.stringify(value));
  const sink = output();
  assert.equal(await runReportCheck([path], sink.streams), 1);
  assert.equal(sink.stdout, "");
  assert.match(sink.stderr, /PERIOD_CHECKSUM/);
  assert.doesNotMatch(sink.stderr, /PRIVATE LABEL/);
}));

test("CLI unreadable path does not print filesystem locations", () => temporary(async directory => {
  const sink = output(), path = join(directory, "sensitive-name.json");
  assert.equal(await runReportCheck([path], sink.streams), 1);
  assert.match(sink.stderr, /PERIOD_REPORT_CLI_READ_FAILED/);
  assert.ok(!sink.stderr.includes(path));
  assert.ok(!sink.stderr.includes("sensitive-name"));
}));

test("CLI rejects directories and empty files", () => temporary(async directory => {
  const subdir = join(directory, "folder.json"), empty = join(directory, "empty.json");
  await mkdir(subdir); await writeFile(empty, "");
  for (const path of [subdir, empty]) {
    const sink = output(); assert.equal(await runReportCheck([path], sink.streams), 1);
    assert.match(sink.stderr, /VAULT_CLI_FILE_SIZE/);
  }
}));

test("CLI rejects invalid UTF-8 bytes", () => temporary(async directory => {
  const path = join(directory, "invalid.json"); await writeFile(path, Buffer.from([0xc3, 0x28]));
  const sink = output(); assert.equal(await runReportCheck([path], sink.streams), 1);
  assert.equal(sink.stdout, "");
}));

test("real CLI entrypoint exits zero and leaves the file untouched", () => temporary(async directory => {
  const path = await saved(directory), before = await readFile(path);
  const child = spawnSync(process.execPath, [resolve("scripts/check-period-report.js"), path, "--json", "--require-agreement"],
    { encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).selectedCount, 3);
  assert.equal(child.stderr, "");
  assert.deepEqual(await readFile(path), before);
}));

test("real CLI strict entrypoint exits two for a valid arithmetic discrepancy", () => temporary(async directory => {
  const input = changedSlot(reportInput(), "DAT", entry => { entry.draft.later.balanceBaseUnits = "0"; });
  const path = await saved(directory, input);
  const child = spawnSync(process.execPath, [resolve("scripts/check-period-report.js"), path, "--require-agreement"],
    { encoding: "utf8", timeout: 10000, windowsHide: true });
  assert.equal(child.status, 2);
  assert.match(child.stderr, /NO_AGREEMENT/);
}));
