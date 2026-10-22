import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseAllowanceCheckOptions, inspectAllowanceFiles, runAllowanceCheck } from "../scripts/check-allowance-file.js";
import { prepareAllowanceFile } from "../src/allowance-file.js";
import { record, targets, nextRecord, code } from "./helpers/allowance-fixtures.js";

async function temp(run) {
  const root = await mkdtemp(join(tmpdir(), "threecore-allowance-test-"));
  try { await run(root); }
  finally {
    const absolute = resolve(root);
    assert.equal(dirname(absolute), resolve(tmpdir()));
    assert(basename(absolute).startsWith("threecore-allowance-test-"));
    await rm(absolute, { recursive: true, force: true });
  }
}
async function save(root, name, kind, value) {
  const path = join(root, name);
  await writeFile(path, (await prepareAllowanceFile(kind, value)).text, { flag: "wx" });
  return path;
}
for (const args of [[], ["--json"], ["--baseline"], ["a", "b"], ["--upload", "a"],
  ["a", "--json", "--json"], ["a", "--baseline", "b", "--baseline", "c"], ["a", "--baseline", "--json"],
  [null], [""]]) {
  test("allowance CLI: rejects malformed arguments " + JSON.stringify(args), () => {
    assert.throws(() => parseAllowanceCheckOptions(args), code("ALLOWANCE_CLI_ARGUMENTS"));
  });
}
test("allowance CLI: supported option orders and spaces in path", () => {
  assert.deepEqual(parseAllowanceCheckOptions(["my file.json", "--baseline", "before file.json", "--json"]),
    { file: "my file.json", baseline: "before file.json", json: true });
  assert.deepEqual(parseAllowanceCheckOptions(["--json", "a.json"]), { file: "a.json", baseline: null, json: true });
});
test("allowance CLI: local observation and comparison without modifying inputs", async () => {
  await temp(async root => {
    const before = record();
    const after = nextRecord(before);
    after.rows[1].allowanceBaseUnits = "11";
    const baseline = await save(root, "before.json", "observation", before);
    const file = await save(root, "after.json", "observation", after);
    const original = await readFile(file);
    const result = await inspectAllowanceFiles({ file, baseline });
    assert.equal(result.comparison.rows[1].deltaBaseUnits, "1");
    assert.equal(result.walletRequests, 0);
    assert.equal(result.networkRequests, 0);
    assert.equal(result.filesModified, 0);
    assert.equal(result.authenticated, false);
    assert.deepEqual(await readFile(file), original);
  });
});
test("allowance CLI: target plan inspection has no fabricated balances", async () => {
  await temp(async root => {
    const file = await save(root, "targets.json", "targets", targets());
    const result = await inspectAllowanceFiles({ file });
    assert.equal(result.kind, "targets");
    assert.equal(result.assessment, null);
    assert.equal(result.comparison, null);
    assert(result.text.includes("確認する相手: 2件"));
    await assert.rejects(inspectAllowanceFiles({ file, baseline: file }), code("ALLOWANCE_COMPARE_KIND"));
  });
});
test("allowance CLI: JSON output and process status", async () => {
  await temp(async root => {
    const file = await save(root, "record.json", "observation", record());
    let stdout = "", stderr = "";
    const status = await runAllowanceCheck([file, "--json"],
      { write(text) { stdout += text; } }, { write(text) { stderr += text; } });
    assert.equal(status, 0);
    assert.equal(stderr, "");
    assert.equal(JSON.parse(stdout).assessment.requested, 2);
  });
});
test("allowance CLI: invalid file reports failure and no successful payload", async () => {
  await temp(async root => {
    const file = join(root, "broken.json");
    await writeFile(file, "{");
    let stdout = "", stderr = "";
    const status = await runAllowanceCheck([file],
      { write(text) { stdout += text; } }, { write(text) { stderr += text; } });
    assert.equal(status, 1);
    assert.equal(stdout, "");
    assert(stderr.includes("ALLOWANCE_FILE_JSON"));
  });
});
test("allowance CLI: empty, oversized, directory and missing paths fail", async () => {
  await temp(async root => {
    for (const [name, content] of [["empty", ""], ["big", "x".repeat(65537)]]) {
      const path = join(root, name);
      await writeFile(path, content);
      await assert.rejects(inspectAllowanceFiles({ file: path }), code("ALLOWANCE_FILE_SIZE"));
    }
    await assert.rejects(inspectAllowanceFiles({ file: root }));
    await assert.rejects(inspectAllowanceFiles({ file: join(root, "missing") }));
  });
});
test("allowance CLI: real node entry point executes on Windows-compatible path", async () => {
  await temp(async root => {
    const file = await save(root, "space in file.json", "observation", record());
    const script = fileURLToPath(new URL("../scripts/check-allowance-file.js", import.meta.url));
    const result = spawnSync(process.execPath, [script, file, "--json"], { encoding: "utf8", timeout: 10000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).checksumVerified, true);
  });
});
