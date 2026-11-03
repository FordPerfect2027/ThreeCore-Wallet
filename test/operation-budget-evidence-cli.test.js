import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,dirname,basename,resolve } from "node:path";
import { operationBudgetExample,encodeOperationBudget } from "../src/operation-budget.js";
import { BUDGET_EVIDENCE_SCHEMA,encodeBudgetEvidence } from "../src/operation-budget-evidence.js";
import { prepareTokenIdentityFile } from "../src/token-identity-report.js";
import { observation } from "./helpers/identity-fixtures.js";
import { runBudgetEvidenceCheck } from "../scripts/check-operation-budget-evidence.js";
test("offline proof inspection keeps original bytes, reports discrepancies and rejects malformed input",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"threecore-budget-evidence-"));try{
  const file=join(dir,"evidence.json"),b=structuredClone(operationBudgetExample());b.fees.operatorFeeBudgetWei="0";
  const data={schema:BUDGET_EVIDENCE_SCHEMA,budgetFile:encodeOperationBudget(b),observationFiles:[(await prepareTokenIdentityFile(observation({balanceBaseUnits:b.token.balanceUnits,nativeBalanceBaseUnits:b.native.balanceWei},"DAT",84532))).text]};
  let output="",errors="";const out={write:s=>{output+=s;}},err={write:s=>{errors+=s;}};
  const text=encodeBudgetEvidence(data);await writeFile(file,text);assert.equal(await runBudgetEvidenceCheck([file],out,err),0);
  const report=JSON.parse(output);assert.equal(report.result.consistent,true);assert.equal(report.result.currentBalanceVerified,false);assert.equal(report.walletRequests,0);assert.equal(await readFile(file,"utf8"),text);
  b.token.balanceUnits="1";data.budgetFile=encodeOperationBudget(b);await writeFile(file,encodeBudgetEvidence(data));assert.equal(await runBudgetEvidenceCheck([file],out,err),2);
  for(const bytes of ["{",new Uint8Array([255])]){await writeFile(file,bytes);assert.equal(await runBudgetEvidenceCheck([file],out,err),1);}
  for(const args of [[],[file,"extra"],["--invalid"]])assert.equal(await runBudgetEvidenceCheck(args,out,err),1);
  assert.doesNotMatch(errors,/threecore-budget-evidence-/);
 }finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith("threecore-budget-evidence-"));await rm(dir,{recursive:true});}
});
