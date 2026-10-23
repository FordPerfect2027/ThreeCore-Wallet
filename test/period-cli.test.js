import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, stat, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parsePeriodArgs, inspectPeriodPath, runPeriodCheck } from "../scripts/check-period.js";
import { preparePeriodFile } from "../src/period-file.js";
import { checkpoint, ACCOUNT } from "./helpers/period-fixtures.js";

async function withFile(draft, run) {
  const directory = await mkdtemp(join(tmpdir(), "threecore-period-test-"));
  const path = join(directory, "synthetic.json");
  try {
    const text = (await preparePeriodFile(draft)).text;
    await writeFile(path, text, "utf8");
    return await run({ path, directory, text });
  } finally {
    await unlink(path).catch(error => { if (error.code !== "ENOENT") throw error; });
    await rmdir(directory);
  }
}

function streams() {
  let output = "", errors = "";
  return { stdout: { write: value => { output += value; } }, stderr: { write: value => { errors += value; } },
    get output() { return output; }, get errors() { return errors; } };
}

test("period CLI accepts a path and optional switches in either order", () => {
  assert.deepEqual(parsePeriodArgs(["file.json"]), { path: "file.json", json: false, requireComplete: false });
  assert.deepEqual(parsePeriodArgs(["--json", "file.JSON", "--require-complete"]),
    { path: "file.JSON", json: true, requireComplete: true });
});

for (const args of [[], ["--json"], ["a.txt"], ["a.json", "b.json"], ["a.json", "--json", "--json"],
  ["a.json", "--require-complete", "--require-complete"], ["a.json", "--write"], ["-a.json"], [null]]) {
  test("period CLI rejects ambiguous argument list: " + JSON.stringify(args), () => {
    assert.throws(() => parsePeriodArgs(args), /PERIOD_CLI_ARGUMENTS/);
  });
}

test("offline inspection preserves original bytes and modification time", async () => withFile(checkpoint(), async ({ path, text }) => {
  const before = await stat(path);
  const result = await inspectPeriodPath(path);
  assert.equal(result.complete, true);
  assert.equal(result.authenticated, false);
  assert.equal(result.liveChainRechecked, false);
  assert.equal(result.checksumVerified, true);
  assert.equal(await readFile(path, "utf8"), text);
  assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
}));

test("normal CLI permits a valid resumable partial checkpoint", async () => withFile(checkpoint(3), async ({ path }) => {
  const io = streams();
  assert.equal(await runPeriodCheck([path], io), 0);
  assert.match(io.output, /Collected: 3\/5/);
  assert.equal(io.errors, "");
}));

test("strict CLI distinguishes incomplete evidence without claiming that it is corrupt", async () => withFile(checkpoint(3), async ({ path }) => {
  const io = streams();
  assert.equal(await runPeriodCheck([path, "--json", "--require-complete"], io), 2);
  const report = JSON.parse(io.output);
  assert.equal(report.complete, false);
  assert.equal(report.checksumVerified, true);
  assert.match(io.errors, /PERIOD_CLI_INCOMPLETE/);
}));

test("complete strict output omits account addresses, balances and counterparties", async () => withFile(checkpoint(), async ({ path }) => {
  const io = streams();
  assert.equal(await runPeriodCheck([path, "--json", "--require-complete"], io), 0);
  const report = JSON.parse(io.output);
  assert.equal(report.complete, true);
  assert.equal(report.liveChainRechecked, false);
  assert.equal(io.output.includes(ACCOUNT), false);
  assert.equal(io.output.includes(checkpoint().earlier.balanceBaseUnits), false);
  assert.equal(Object.hasOwn(report, "draft"), false);
  assert.equal(io.errors, "");
}));

test("CLI emits sanitized errors for a corrupt downloaded envelope", async () => withFile(checkpoint(), async ({ path }) => {
  await writeFile(path, "{invalid", "utf8");
  const io = streams();
  assert.equal(await runPeriodCheck([path], io), 1);
  assert.match(io.errors, /PERIOD_FILE_JSON/);
  assert.equal(io.output, "");
  assert.equal(io.errors.includes(path), false);
}));

test("CLI refuses directories and missing files", async () => withFile(checkpoint(), async ({ path, directory }) => {
  await assert.rejects(inspectPeriodPath(directory));
  const io = streams();
  assert.equal(await runPeriodCheck([join(directory, "missing.json")], io), 1);
  assert.match(io.errors, /PERIOD_CLI_READ_FAILED/);
  assert.ok((await stat(path)).isFile());
}));

test("actual Node command returns the documented exit code and JSON report", async () => withFile(checkpoint(2), async ({ path }) => {
  const result = spawnSync(process.execPath, ["scripts/check-period.js", path, "--json", "--require-complete"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).completed, 2);
  assert.match(result.stderr, /PERIOD_CLI_INCOMPLETE/);
}));

test("actual complete command exits successfully without altering its source", async () => withFile(checkpoint(), async ({ path, text }) => {
  const result = spawnSync(process.execPath, ["scripts/check-period.js", path], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /DAT \/ chain 8453/);
  assert.equal(result.stderr, "");
  assert.equal(await readFile(path, "utf8"), text);
}));
