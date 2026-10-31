import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { preparePeriodLibraryFile } from "../src/period-library-file.js";
import { inspectPeriodLibraryImport } from "../src/period-library-model.js";
import { entry, library } from "./helpers/period-library-fixtures.js";
import { parseLibraryInspectionArgs } from "../scripts/inspect-period-library-import.js";
const run = args => spawnSync(process.execPath, ["scripts/inspect-period-library-import.js", ...args], { encoding: "utf8", timeout: 15000 });
test("standalone inspection checks both source hashes, exactly matches shared comparison and changes neither source", async () => {
  const folder = await mkdtemp(join(tmpdir(), "threecore-import-inspection-"));
  try {
    const before = library([entry(1, { requiresNewPlan: true })]), a = await preparePeriodLibraryFile(before), aPath = join(folder,"before.json"), bPath = join(folder,"incoming.json");
    await writeFile(aPath, a.text);
    for (const incoming of [library([entry(1)]), library([entry(2)]), library()]) {
      const b = await preparePeriodLibraryFile(incoming); await writeFile(bPath, b.text);
      const expected = inspectPeriodLibraryImport(before,incoming), actual = run([aPath,bPath,"--json"]);
      assert.equal(actual.status,expected.compatible?0:2,actual.stderr); assert.equal(actual.stderr,"");
      assert.equal(actual.stdout,JSON.stringify({...expected,sourceChecksumsVerified:true,beforeDigest:a.digest,incomingDigest:b.digest},null,2)+"\n");
      assert.equal(await readFile(aPath,"utf8"),a.text); assert.equal(await readFile(bPath,"utf8"),b.text);
    }
    const modified = JSON.parse(a.text); modified.digest = "0".repeat(64);
    for (const bad of [aPath,bPath]) {
      await writeFile(aPath,a.text); await writeFile(bPath,a.text); await writeFile(bad,JSON.stringify(modified));
      const result = run([aPath,bPath,"--json"]); assert.equal(result.status,1); assert.equal(result.stdout,""); assert.match(result.stderr,/PERIOD_CHECKSUM/);
    }
    const missing=run([join(folder,"PRIVATE_FILENAME.json"),bPath]); assert.equal(missing.status,1);assert.doesNotMatch(missing.stderr,/PRIVATE_FILENAME/);
  } finally { await rm(folder,{recursive:true,force:true}); }
});
test("offline inspection reports capacity failure and validates its arguments",async()=>{
  for(const args of [[],["a.json"],["a.json","b.json","--force"],["a.csv","b.json"],["a.json","b.json","--json","extra"]])assert.throws(()=>parseLibraryInspectionArgs(args));
  assert.match(run(["--help"]).stdout,/No network, replacement or writes/);
  const folder=await mkdtemp(join(tmpdir(),"threecore-capacity-inspection-"));
  try{
    const aPath=join(folder,"a.json"),bPath=join(folder,"b.json");
    await writeFile(aPath,(await preparePeriodLibraryFile(library(Array.from({length:12},(_,i)=>entry(i+1))))).text);
    await writeFile(bPath,(await preparePeriodLibraryFile(library([entry(13)]))).text);
    const result=run([aPath,bPath,"--json"]);assert.equal(result.status,2);const report=JSON.parse(result.stdout);assert.equal(report.capacity.entriesAfter,13);assert.equal(report.conflicts,0);
  }finally{await rm(folder,{recursive:true,force:true});}
});
