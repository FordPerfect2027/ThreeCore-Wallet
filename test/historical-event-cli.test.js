import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseHistoricalEventArgs, runHistoricalEventExport } from "../scripts/export-historical-events.js";
import { prepareReconciliationFile } from "../src/reconciliation-file.js";
import { preparePeriodReportFile } from "../src/period-report-file.js";
import { reconciliationFilteredEventsCSV } from "../src/reconciliation-view.js";
import { periodReportEventsCSV } from "../src/period-report-export.js";
import { previewWorkspace } from "./helpers/reconciliation-fixtures.js";
import { manyEventsInput, reportInput } from "./helpers/period-report-fixtures.js";

async function files(t) {
  const prefix = join(tmpdir(), "threecore-filtered-cli-");
  const folder = await mkdtemp(prefix);
  t.after(async () => {
    assert.ok(resolve(folder).startsWith(resolve(prefix)));
    await rm(folder, { recursive: true, force: true });
  });
  const reconciliation = previewWorkspace(), period = manyEventsInput();
  const inputs = { reconciliation, period }, paths = {}, sources = {};
  for (const [kind, prepare] of [["reconciliation", prepareReconciliationFile], ["period", preparePeriodReportFile]]) {
    paths[kind] = join(folder, kind + " source.json");
    sources[kind] = (await prepare(inputs[kind])).text;
    await writeFile(paths[kind], sources[kind]);
  }
  return { folder, paths, sources, inputs };
}
async function run(args) {
  let output = "", errors = "";
  const exitCode = await runHistoricalEventExport(args, { stdout: { write(value) { output += value; } }, stderr: { write(value) { errors += value; } } });
  return { output, errors, exitCode };
}
test("CLI options require explicit source kind and reject ambiguous combinations before any read", async () => {
  const parsed = parseHistoricalEventArgs(["period", "input.JSON", "--search", "  0XABC  ", "--agent", "EMA"]);
  assert.equal(parsed.query.search, "0xabc"); assert.equal(parsed.query.agent, "EMA"); assert.equal(parsed.query.page, 0);
  for (const args of [[], ["unknown", "file.json"], ["period", "file.csv"], ["period", "file.json", "--agent", "all"],
    ["reconciliation", "file.json", "--format", "yaml"], ["period", "file.json", "--search"],
    ["period", "file.json", "--search", "a", "--search", "b"], ["period", "file.json", "--page", "2"],
    ["period", "file.json", "--require-agreement", "--require-agreement"], ["period", "file.json", "--help"]]) {
    assert.throws(() => parseHistoricalEventArgs(args));
    const result = await run(args); assert.equal(result.exitCode, 1); assert.equal(result.output, "");
  }
});
test("help requires no file and states all-match scope and output privacy", async () => {
  const result = await run(["--help"]);
  assert.equal(result.exitCode, 0); assert.equal(result.errors, "");
  assert.match(result.output, /Every matching page/); assert.match(result.output, /unencrypted/);
});
for (const kind of ["reconciliation", "period"]) {
  test(kind + " command reproduces browser CSV bytes and leaves its input unchanged", async t => {
    const f = await files(t), args = [kind, f.paths[kind], "--agent", "DAT", "--direction", "incoming"];
    const result = await run(args);
    const query = { agent: "DAT", direction: "incoming", search: "", page: 0 };
    const expected = (kind === "period" ? periodReportEventsCSV : reconciliationFilteredEventsCSV)(f.inputs[kind], query).text;
    assert.equal(result.exitCode, 0); assert.equal(result.errors, ""); assert.equal(result.output, expected);
    assert.equal(await readFile(f.paths[kind], "utf8"), f.sources[kind]);
    const child = spawnSync(process.execPath, ["scripts/export-historical-events.js", ...args], {
      cwd: fileURLToPath(new URL("../", import.meta.url)), encoding: "utf8", timeout: 10000,
    });
    assert.equal(child.error, undefined); assert.equal(child.status, 0); assert.equal(child.stdout, expected); assert.equal(child.stderr, "");
  });
  test(kind + " JSON records an empty selection and unfiltered conclusions", async t => {
    const f = await files(t);
    const result = await run([kind, f.paths[kind], "--agent", "DAT", "--search", "no result", "--format", "json"]);
    assert.equal(result.exitCode, 0);
    const data = JSON.parse(result.output);
    assert.equal(data.matched, 0); assert.ok(data.total > 0); assert.equal(data.query.search, "no result");
    assert.equal(data.summary.statuses.length, 3); assert.equal(data.summary.conclusionsUseAllSourceEvidence, true);
    assert.match(data.sourcePayloadDigest, /^[a-f0-9]{64}$/); assert.equal(data.checksumVerified, true);
    assert.equal(data.authenticated, false); assert.equal(data.restorable, false); assert.equal(data.liveChainRechecked, false);
    assert.equal(data.csv.trimEnd().split("\r\n").length, 1);
  });
  test(kind + " rejects tampered checksum without partial stdout", async t => {
    const f = await files(t), parsed = JSON.parse(f.sources[kind]); parsed.digest = "0".repeat(64);
    await writeFile(f.paths[kind], JSON.stringify(parsed));
    const result = await run([kind, f.paths[kind]]);
    assert.equal(result.exitCode, 1); assert.equal(result.output, ""); assert.match(result.errors, /CHECKSUM/);
  });
}
test("strict status is based on all source slots even when the query hides every issue", async t => {
  const f = await files(t);
  const result = await run(["reconciliation", f.paths.reconciliation, "--agent", "DAT", "--search", "no result", "--format", "json", "--require-agreement"]);
  assert.equal(result.exitCode, 2); assert.match(result.errors, /NOT_ALL_AGREE/);
  const data = JSON.parse(result.output); assert.equal(data.matched, 0); assert.equal(data.summary.allArithmeticAgreement, false);
  const agreement = (await preparePeriodReportFile(reportInput())).text; await writeFile(f.paths.period, agreement);
  assert.equal((await run(["period", f.paths.period, "--require-agreement"])).exitCode, 0);
});
test("wrong source type, invalid UTF-8 and missing path fail without echoing file paths", async t => {
  const f = await files(t);
  for (const args of [["period", f.paths.reconciliation], ["reconciliation", f.paths.period], ["period", join(f.folder, "PRIVATE_PATH.json")]]) {
    const result = await run(args); assert.equal(result.exitCode, 1); assert.equal(result.output, "");
    assert.ok(!result.errors.includes(f.folder)); assert.doesNotMatch(result.errors, /PRIVATE_PATH/);
  }
  await writeFile(f.paths.period, new Uint8Array([0xc3, 0x28]));
  const result = await run(["period", f.paths.period]); assert.equal(result.exitCode, 1); assert.equal(result.output, "");
});
