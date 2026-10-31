import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { inspectWalletSavedText } from "../src/file-read-status.js";
import { parseSavedInspectionArgs, runSavedFileInspection } from "../scripts/inspect-wallet-saved-file.js";
import { sampleHistory } from "./helpers/report-history-fixtures.js";

test("standalone saved-file inspection exactly reproduces the shared result and distinguishes auxiliary files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "threecore-saved-guide-")), path = join(directory, "source.json");
  const run = () => spawnSync(process.execPath, ["scripts/inspect-wallet-saved-file.js", path, "--json"], { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 20000 });
  try {
    const source = (await prepareReportHistoryFile(sampleHistory())).text; await writeFile(path, source);
    const result = run(); assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, JSON.stringify(await inspectWalletSavedText(source), null, 2) + "\n");
    assert.equal(await readFile(path, "utf8"), source); assert.doesNotMatch(result.stdout, /担当メモ/);
    const auxiliary = JSON.stringify({ schema: "threecore.report-set-history-coverage.v1", privateText: "PRIVATE" }); await writeFile(path, auxiliary);
    const partial = run(); assert.equal(partial.status, 2); assert.equal(JSON.parse(partial.stdout).checksumVerified, false); assert.ok(!partial.stdout.includes("PRIVATE"));
    assert.equal(await readFile(path, "utf8"), auxiliary);
    for (const text of ["\ufeff" + source, "{", JSON.stringify({ schema: "UNKNOWN_PRIVATE" })]) {
      await writeFile(path, text); const invalid = run(); assert.equal(invalid.status, 1); assert.equal(invalid.stdout, ""); assert.ok(!invalid.stderr.includes(directory));
    }
    await writeFile(path, Buffer.from([0xff])); assert.equal(run().status, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("saved-file inspection argument failures and errors cannot leak the supplied local path", async () => {
  for (const args of [[], ["file.txt"], ["file.json", "--execute"], ["file.json", "--json", "--json"], ["--json"]]) assert.throws(() => parseSavedInspectionArgs(args));
  let out = "", err = ""; const io = { stdout: { write: value => { out += value; } }, stderr: { write: value => { err += value; } } };
  assert.equal(await runSavedFileInspection(["--help"], io), 0); assert.match(out, /structure-only validation or auxiliary declaration/); assert.equal(err, "");
  out = ""; assert.equal(await runSavedFileInspection(["PRIVATE_DOES_NOT_EXIST.json", "--json"], io), 1); assert.equal(out, ""); assert.ok(!err.includes("PRIVATE_DOES_NOT_EXIST"));
});
