import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { inspectWalletSavedText, compareWalletSavedInspections } from "../src/file-read-status.js";
import { parseSavedComparisonArgs, runSavedFileComparison } from "../scripts/compare-wallet-saved-files.js";
import { sampleHistory, clone } from "./helpers/report-history-fixtures.js";

test("standalone saved-file comparison reproduces the shared result and preserves both source files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "threecore-file-comparison-")), a = join(directory, "before.json"), b = join(directory, "after.json");
  const run = () => spawnSync(process.execPath, ["scripts/compare-wallet-saved-files.js", a, b, "--json"], { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 20000 });
  try {
    const history = sampleHistory(), before = (await prepareReportHistoryFile(history)).text, changed = clone(history); changed.entries[0].note = "Changed private note";
    await writeFile(a, before);
    for (const [after, exitCode, kind] of [[before,0,"identical"], [JSON.stringify(JSON.parse(before),null,2),0,"format-only"], [(await prepareReportHistoryFile(changed)).text,2,"changed-original"], [JSON.stringify({schema:"threecore.saved-file-inspection.v1"}),2,"unverified"]]) {
      await writeFile(b, after); const result = run(); assert.equal(result.status, exitCode, result.stderr);
      assert.equal(result.stdout, JSON.stringify(compareWalletSavedInspections(await inspectWalletSavedText(before), await inspectWalletSavedText(after)),null,2)+"\n");
      assert.equal(JSON.parse(result.stdout).kind, kind); assert.equal(await readFile(a,"utf8"),before); assert.equal(await readFile(b,"utf8"),after);
    }
    const corrupt = JSON.parse(before); corrupt.digest = "0".repeat(64); await writeFile(b,JSON.stringify(corrupt));
    const invalid = run(); assert.equal(invalid.status,1); assert.equal(invalid.stdout,""); assert.match(invalid.stderr,/PERIOD_CHECKSUM/); assert.ok(!invalid.stderr.includes(directory));
  } finally { await rm(directory,{recursive:true,force:true}); }
});
test("comparison CLI rejects ambiguous arguments and documents equal saved content versus live verification", async () => {
  for (const args of [[],["one.json"],["a.json","b.json","--apply"],["a.json","b.json","--json","--json"]]) assert.throws(()=>parseSavedComparisonArgs(args));
  let out="",err="";const io={stdout:{write:value=>{out+=value;}},stderr:{write:value=>{err+=value;}}};
  assert.equal(await runSavedFileComparison(["--help"],io),0);assert.match(out,/No network/);assert.equal(err,"");
  out="";assert.equal(await runSavedFileComparison(["PRIVATE_MISSING.json","other.json","--json"],io),1);assert.equal(out,"");assert.ok(!err.includes("PRIVATE_MISSING"));
});
