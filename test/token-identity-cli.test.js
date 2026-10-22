import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { parseIdentityCheckOptions, runIdentityCheck } from "../scripts/check-token-identity.js";
import { prepareTokenIdentityFile } from "../src/token-identity-report.js";
import { observation, OTHER } from "./helpers/identity-fixtures.js";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "threecore-identity-cli-"));
  try {
    const before = join(root, "before.json");
    const after = join(root, "after.json");
    await writeFile(before, (await prepareTokenIdentityFile(observation())).text);
    await writeFile(after, (await prepareTokenIdentityFile(observation({ blockNumber: "43", balanceBaseUnits: "1234567890123456790" }))).text);
    return await run({ root, before, after });
  } finally {
    const absolute = resolve(root);
    if (!absolute.startsWith(resolve(tmpdir()) + sep) || !absolute.includes("threecore-identity-cli-")) throw Error("Unsafe test cleanup");
    await rm(absolute, { recursive: true, force: true });
  }
}

function capture() {
  let out = "", err = "";
  return { output: { write: text => { out += text; } }, errors: { write: text => { err += text; } },
    result: () => ({ out, err }) };
}

test("CLI option parser accepts one record and optional baseline", () => {
  assert.deepEqual(parseIdentityCheckOptions(["record.json"]), { file: "record.json", baseline: null, json: false });
  assert.deepEqual(parseIdentityCheckOptions(["record.json", "--baseline", "old.json", "--json"]),
    { file: "record.json", baseline: "old.json", json: true });
});

for (const args of [[], ["--json"], ["a", "b"], ["a", "--upload"], ["a", "--baseline"],
  ["a", "--baseline", "--json"], ["a", "--json", "--json"], ["a", "--baseline", "b", "--baseline", "c"], [null]]) {
  test("CLI rejects ambiguous options " + JSON.stringify(args), () => {
    assert.throws(() => parseIdentityCheckOptions(args));
  });
}

test("CLI JSON verifies a record without modifying the original", async () => fixture(async ({ before }) => {
  const original = await readFile(before);
  const stream = capture();
  assert.equal(await runIdentityCheck([before, "--json"], stream.output, stream.errors), 0);
  const result = JSON.parse(stream.result().out);
  assert.equal(result.checksumVerified, true);
  assert.equal(result.authenticated, false);
  assert.equal(result.assessment.status, "matched");
  assert.equal(result.networkRequests, 0);
  assert.equal(result.walletRequests, 0);
  assert.equal(result.filesModified, 0);
  assert.deepEqual(await readFile(before), original);
  assert.equal(stream.result().err, "");
}));

test("CLI baseline comparison computes one base unit exactly", async () => fixture(async ({ before, after }) => {
  const stream = capture();
  assert.equal(await runIdentityCheck([after, "--baseline", before, "--json"], stream.output, stream.errors), 0);
  const result = JSON.parse(stream.result().out);
  assert.equal(result.comparison.deltaBaseUnits, "1");
  assert.equal(result.comparison.deltaAmount, "+0.000000000000000001");
}));

test("CLI text output includes network, account, block and historical context", async () => fixture(async ({ after }) => {
  const stream = capture();
  assert.equal(await runIdentityCheck([after], stream.output, stream.errors), 0);
  const { out } = stream.result();
  assert.match(out, /Base Mainnet/);
  assert.match(out, /参照ブロック: 43/);
  assert.match(out, /過去の記録/);
  assert.match(out, /真正性を証明しません/);
}));

test("CLI refuses wrong-identity comparison", async () => fixture(async ({ before, after }) => {
  await writeFile(after, (await prepareTokenIdentityFile(observation({ account: OTHER, blockNumber: "43" }))).text);
  const stream = capture();
  assert.equal(await runIdentityCheck([after, "--baseline", before], stream.output, stream.errors), 1);
  assert.equal(stream.result().out, "");
  assert.match(stream.result().err, /IDENTITY_COMPARISON_CONTEXT/);
}));

test("CLI refuses oversized and corrupted files", async () => fixture(async ({ before }) => {
  for (const value of ["x".repeat(32769), "{"]) {
    await writeFile(before, value);
    const stream = capture();
    assert.equal(await runIdentityCheck([before], stream.output, stream.errors), 1);
    assert.equal(stream.result().out, "");
    assert.match(stream.result().err, /IDENTITY_FILE_/);
  }
}));

test("CLI refuses a directory and missing file", async () => fixture(async ({ root }) => {
  for (const path of [root, join(root, "missing.json")]) {
    const stream = capture();
    assert.equal(await runIdentityCheck([path], stream.output, stream.errors), 1);
    assert.equal(stream.result().out, "");
    assert.notEqual(stream.result().err, "");
  }
}));

test("actual Node entry point emits the expected machine-readable result", async () => fixture(async ({ before }) => {
  const result = spawnSync(process.execPath, ["scripts/check-token-identity.js", before, "--json"], {
    encoding: "utf8", timeout: 5000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).schema, "threecore-local-identity-check-v1");
}));

test("actual Node entry point returns nonzero for invalid usage", () => {
  const result = spawnSync(process.execPath, ["scripts/check-token-identity.js", "--send"], {
    encoding: "utf8", timeout: 5000, windowsHide: true,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /IDENTITY_CLI_ARGUMENTS/);
});
