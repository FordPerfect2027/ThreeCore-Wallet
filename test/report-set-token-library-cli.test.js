import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareReportSetFile } from "../src/report-set-file.js";
import { prepareReportSetTokenLibraryFile } from "../src/report-set-export.js";
import { sequenceSet, sequenceHistory, id, clone } from "./helpers/report-set-fixtures.js";
import { parseSetLibraryArgs } from "../scripts/recover-report-set-token-library.js";
const run=args=>spawnSync(process.execPath,["scripts/recover-report-set-token-library.js",...args],{encoding:"utf8",timeout:15000});
test("standalone recovery emits exact checked originals, discloses missing slots and never writes its source",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"threecore-token-library-"));
  try{
    const input=sequenceSet(sequenceHistory([0n,12n],(report,index)=>{report.slots.forEach((slot,n)=>{slot.entry.id=id(1000+3*index+n);});if(index===0)report.slots[0].entry=null;}));
    const file=await prepareReportSetFile(input),path=join(folder,"source.json");await writeFile(path,file.text);
    for(const agent of ["DAT","EMA","CAWELON"]){
      const result=run([path,"--agent",agent]),expected=await prepareReportSetTokenLibraryFile(input,agent);
      assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,expected.text);assert.match(result.stderr,/No import performed/);
      if(agent==="DAT")assert.match(result.stderr,/1 reports lacked this token/);
    }
    assert.equal(await readFile(path,"utf8"),file.text);
    await writeFile(path,(await prepareReportSetFile(sequenceSet())).text);
    const conflict=run([path,"--agent","DAT"]);assert.equal(conflict.status,1);assert.equal(conflict.stdout,"");assert.match(conflict.stderr,/PERIOD_SET_LIBRARY_CONFLICT/);
    const absent=clone(input);for(const row of absent.entries)row.report.slots[0].entry=null;await writeFile(path,(await prepareReportSetFile(absent)).text);
    const missing=run([path,"--agent","DAT"]);assert.equal(missing.status,1);assert.equal(missing.stdout,"");assert.match(missing.stderr,/PERIOD_SET_LIBRARY_EMPTY/);
    const altered=JSON.parse(file.text);altered.digest="0".repeat(64);await writeFile(path,JSON.stringify(altered));
    const bad=run([path,"--agent","DAT"]);assert.equal(bad.status,1);assert.equal(bad.stdout,"");assert.match(bad.stderr,/PERIOD_CHECKSUM/);
    await writeFile(path,new Uint8Array([0xc3,0x28]));assert.equal(run([path,"--agent","DAT"]).stdout,"");
    const hidden=run([join(folder,"PRIVATE_FILE.json"),"--agent","DAT"]);assert.equal(hidden.status,1);assert.doesNotMatch(hidden.stderr,/PRIVATE_FILE/);
  }finally{await rm(folder,{recursive:true,force:true});}
});
test("recovery requires one explicit token and explains that extraction is not history completeness",()=>{
  for(const args of [[],["x.json"],["x.json","--agent","all"],["x.json","--agent","DAT","--force"],["x.csv","--agent","DAT"]])assert.throws(()=>parseSetLibraryArgs(args));
  assert.match(run(["--help"]).stdout,/not complete history/);
});
