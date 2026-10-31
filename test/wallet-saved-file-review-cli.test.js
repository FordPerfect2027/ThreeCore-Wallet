import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { prepareReportHistoryFile } from "../src/report-history-file.js";
import { inspectWalletSavedText,compareWalletSavedInspections } from "../src/file-read-status.js";
import { sampleHistory,clone } from "./helpers/report-history-fixtures.js";
const invoke=(script,args)=>spawnSync(process.execPath,["scripts/"+script,...args],{cwd:new URL("../",import.meta.url),encoding:"utf8",timeout:20000});
test("CLI creates, verifies and extracts exact originals; comparison mismatch never emits extracted text",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"threecore-saved-bundle-")),a=join(directory,"before.json"),b=join(directory,"after.json"),c=join(directory,"comparison.json"),d=join(directory,"bundle.json");
  try{
    const history=sampleHistory(),changed=clone(history);changed.entries[0].note="Private changed memo";
    const before=(await prepareReportHistoryFile(history)).text,after=JSON.stringify(JSON.parse((await prepareReportHistoryFile(changed)).text),null,2)+"\r\n";
    const comparison=compareWalletSavedInspections(await inspectWalletSavedText(before),await inspectWalletSavedText(after));
    await writeFile(a,before);await writeFile(b,after);await writeFile(c,JSON.stringify(comparison));
    const review=invoke("verify-wallet-saved-comparison.js",[a,b,c,"--json"]);assert.equal(review.status,0,review.stderr);assert.equal(JSON.parse(review.stdout).expectedSameOriginal,false);
    const made=invoke("wallet-saved-bundle.js",["create",a,b]);assert.equal(made.status,0,made.stderr);await writeFile(d,made.stdout);
    const checked=invoke("wallet-saved-bundle.js",["check",d,"--json"]);assert.equal(checked.status,0,checked.stderr);assert.equal(JSON.parse(checked.stdout).originalsAvailable,true);
    for(const [role,text] of [["before",before],["after",after]]){const extracted=invoke("wallet-saved-bundle.js",["extract",d,role]);assert.equal(extracted.status,0,extracted.stderr);assert.equal(extracted.stdout,text);}
    const wrong={...comparison,sameOriginal:true};await writeFile(c,JSON.stringify(wrong));
    const mismatched=invoke("verify-wallet-saved-comparison.js",[a,b,c,"--json"]);assert.equal(mismatched.status,2);assert.equal(JSON.parse(mismatched.stdout).matchesRecomputation,false);
    const bundle=JSON.parse(made.stdout);bundle.comparisonText=JSON.stringify(wrong);await writeFile(d,JSON.stringify(bundle));
    const badExtract=invoke("wallet-saved-bundle.js",["extract",d,"after"]);assert.equal(badExtract.status,2);assert.equal(badExtract.stdout,"");
    assert.equal(await readFile(a,"utf8"),before);assert.equal(await readFile(b,"utf8"),after);
    await writeFile(d,"\ufeff"+made.stdout);const bom=invoke("wallet-saved-bundle.js",["check",d,"--json"]);assert.equal(bom.status,1);assert.equal(bom.stdout,"");assert.ok(!bom.stderr.includes(directory));
  }finally{await rm(directory,{recursive:true,force:true});}
});
test("offline tools reject ambiguous commands without partial output or path disclosure",()=>{
  for(const [script,args] of [["verify-wallet-saved-comparison.js",[]],["verify-wallet-saved-comparison.js",["a.json","b.json","c.json","--apply"]],
    ["wallet-saved-bundle.js",["extract","a.json","all"]],["wallet-saved-bundle.js",["create","PRIVATE.json","missing.json"]],["wallet-saved-bundle.js",["check","a.json","--apply"]]]){
    const result=invoke(script,args);assert.equal(result.status,1);assert.equal(result.stdout,"");assert.doesNotMatch(result.stderr,/PRIVATE/);
  }
  for(const script of ["verify-wallet-saved-comparison.js","wallet-saved-bundle.js"]){const result=invoke(script,["--help"]);assert.equal(result.status,0);assert.match(result.stdout,/No network/);}
});
