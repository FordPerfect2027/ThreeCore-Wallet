import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { parseReconciliationArgs, inspectReconciliationPath, runReconciliationCheck } from "../scripts/check-reconciliation.js";
import { prepareReconciliationFile } from "../src/reconciliation-file.js";
import { workspace, scenario, previewWorkspace } from "./helpers/reconciliation-fixtures.js";

async function withFile(value, run) {
  const directory = await mkdtemp(join(tmpdir(), "threecore-reconciliation-test-"));
  const path = join(directory, "synthetic.json");
  try {
    const text = (await prepareReconciliationFile(value)).text;
    await writeFile(path, text, "utf8");
    await run({ path, directory, text });
  } finally {
    // mkdtemp owns this newly created, test-only directory.
    await rm(directory, { recursive: true, force: true });
  }
}

function streams() {
  let output = "", error = "";
  return {
    stdout: { write: value => { output += value; } },
    stderr: { write: value => { error += value; } },
    get output() { return output; }, get error() { return error; },
  };
}

test("CLI parses positional file and independent optional switches", () => {
  assert.deepEqual(parseReconciliationArgs(["file.json"]), { path: "file.json", json: false, strict: false });
  assert.deepEqual(parseReconciliationArgs(["--json", "file.JSON", "--require-agreement"]),
    { path: "file.JSON", json: true, strict: true });
});

for (const args of [[], ["--json"], ["a.txt"], ["a.json", "b.json"], ["a.json", "--json", "--json"],
  ["a.json", "--require-agreement", "--require-agreement"], ["a.json", "--write"], ["-a.json"], [1]]) {
  test("CLI rejects ambiguous arguments " + JSON.stringify(args), () => {
    assert.throws(() => parseReconciliationArgs(args), /RECONCILIATION_CLI_ARGUMENTS/);
  });
}

test("CLI validation does not modify source file bytes or timestamps", async () => withFile(previewWorkspace(), async ({ path, text }) => {
  const before = await stat(path);
  const result = await inspectReconciliationPath(path);
  assert.equal(result.checksumVerified, true);
  assert.equal(result.authenticated, false);
  assert.deepEqual(result.report.slots.map(row => row.status),
    ["arithmetic-agreement", "unexplained-difference", "incomplete-history"]);
  assert.equal(await readFile(path, "utf8"), text);
  assert.equal((await stat(path)).mtimeMs, before.mtimeMs);
}));

test("CLI normal mode validates evidence rather than pretending all differences are errors", async () => withFile(previewWorkspace(), async ({ path }) => {
  const io = streams();
  assert.equal(await runReconciliationCheck([path], io), 0);
  assert.match(io.output, /説明できない差額: 2 EMA/);
  assert.equal(io.error, "");
}));

test("CLI strict mode returns 2 for missing, incomplete or mismatching slots", async () => withFile(workspace(), async ({ path }) => {
  const io = streams();
  assert.equal(await runReconciliationCheck([path, "--require-agreement", "--json"], io), 2);
  const result = JSON.parse(io.output);
  assert.equal(result.report.slots[1].status, "missing-input");
  assert.equal(result.report.securityAudit, false);
  assert.match(io.error, /RECONCILIATION_CLI_NOT_ALL_AGREE/);
}));

test("CLI strict mode accepts three arithmetic agreements without upgrading provenance", async () =>
  withFile(workspace([scenario("DAT"), scenario("EMA"), scenario("CAWELON")]), async ({ path }) => {
    const io = streams();
    assert.equal(await runReconciliationCheck([path, "--json", "--require-agreement"], io), 0);
    const result = JSON.parse(io.output);
    assert.equal(result.authenticated, false);
    assert.equal(result.report.independentlyVerified, false);
    assert.equal(result.report.completeHistory, false);
  }));

test("CLI reports invalid checksum without echoing untrusted file text", async () => withFile(workspace(), async ({ path, text }) => {
  const parsed = JSON.parse(text);
  parsed.digest = "0".repeat(64);
  await writeFile(path, JSON.stringify(parsed));
  const io = streams();
  assert.equal(await runReconciliationCheck([path], io), 1);
  assert.equal(io.output, "");
  assert.match(io.error, /RECONCILIATION_CHECKSUM/);
  assert.ok(!io.error.includes(path));
}));

test("CLI rejects empty, non-file and invalid UTF-8 inputs", async () => withFile(workspace(), async ({ path, directory }) => {
  await writeFile(path, "");
  await assert.rejects(inspectReconciliationPath(path), /VAULT_CLI_FILE_SIZE/);
  await assert.rejects(inspectReconciliationPath(directory), /VAULT_CLI_FILE_SIZE/);
  await writeFile(path, Buffer.from([0xc0, 0xaf]));
  await assert.rejects(inspectReconciliationPath(path));
}));

test("standalone CLI process exits with expected code and machine-readable output", async () => withFile(workspace(), async ({ path }) => {
  const child = spawnSync(process.execPath, ["scripts/check-reconciliation.js", path, "--json"], { encoding: "utf8", timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).checksumVerified, true);
  assert.equal(child.stderr, "");
}));

test("CLI missing file produces a bounded safe error", async () => {
  const io = streams();
  assert.equal(await runReconciliationCheck(["missing-private-name.json"], io), 1);
  assert.match(io.error, /RECONCILIATION_CLI_READ_FAILED/);
  assert.doesNotMatch(io.error, /missing-private-name/);
});
