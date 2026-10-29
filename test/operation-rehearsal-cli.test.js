import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { rehearsalExampleV2 } from "../src/operation-rehearsal-examples.js";
import { encodeRehearsal, REHEARSAL_LIMIT } from "../src/operation-rehearsal.js";
import { inspectRehearsalFile, parseRehearsalCheckArgs, runRehearsalCheck } from "../scripts/check-rehearsal.js";
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), "threecore-rehearsal-")), file = join(dir, "rehearsal.json");
  try { await writeFile(file, encodeRehearsal(rehearsalExampleV2())); await fn(file, dir); }
  finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("threecore-rehearsal-"));
    await rm(dir, { recursive: true });
  }
}
test("offline checker recalculates and checks an optional expected checksum", () => fixture(async file => {
  const r = await inspectRehearsalFile(file); assert.equal(r.report.realizedPnl, "28000000");
  assert.equal(r.expectedChecksumMatched, null); assert.equal(r.authenticated, false);
  assert.equal(r.networkRequests, 0); assert.equal(r.walletRequests, 0); assert.equal(r.filesModified, 0);
  assert.equal((await inspectRehearsalFile(file, r.sha256)).expectedChecksumMatched, true);
  await assert.rejects(inspectRehearsalFile(file, "0".repeat(64)), { code: "CHECKSUM_MISMATCH" });
}));
test("rejects oversized, malformed UTF-8, duplicate-key JSON and directories", () => fixture(async (file, dir) => {
  await writeFile(file, " ".repeat(REHEARSAL_LIMIT + 1)); await assert.rejects(inspectRehearsalFile(file), { code: "FILE_TOO_LARGE" });
  await writeFile(file, new Uint8Array([255])); await assert.rejects(inspectRehearsalFile(file), { code: "INVALID_UTF8" });
  await writeFile(file, '{"x":1,"x":2}'); await assert.rejects(inspectRehearsalFile(file), { code: "INVALID_JSON" });
  await assert.rejects(inspectRehearsalFile(dir));
}));
test("CLI separates success, violated constraints and invalid files", () => fixture(async file => {
  let output = "", errors = "";
  const stdout = { write: s => { output += s; } }, stderr = { write: s => { errors += s; } };
  assert.equal(await runRehearsalCheck([file, "--json"], stdout, stderr), 0);
  assert.equal(JSON.parse(output).constraintsSatisfied, true); assert.equal(errors, "");
  await writeFile(file, encodeRehearsal(rehearsalExampleV2("DAT", "limit")));
  output = ""; assert.equal(await runRehearsalCheck([file, "--json"], stdout, stderr), 2);
  assert.equal(JSON.parse(output).constraintsSatisfied, false);
  await writeFile(file, "bad"); assert.equal(await runRehearsalCheck([file], stdout, stderr), 1);
  assert.match(errors, /INVALID_JSON/);
}));
for (const args of [[], ["--unknown"], ["a", "b"], ["a", "--json", "--json"], ["a", "--sha256"], ["a", "--sha256", "bad"]])
  test("reject CLI arguments " + JSON.stringify(args), () => assert.throws(() => parseRehearsalCheckArgs(args), { code: "CLI_ARGUMENTS" }));
