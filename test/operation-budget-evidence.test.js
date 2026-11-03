import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { operationBudgetExample, encodeOperationBudget } from "../src/operation-budget.js";
import { SHARED_BUDGET_SCHEMA, encodeSharedOperationBudget } from "../src/shared-operation-budget.js";
import { prepareTokenIdentityFile } from "../src/token-identity-report.js";
import { observation } from "./helpers/identity-fixtures.js";
import { BUDGET_EVIDENCE_SCHEMA, BUDGET_EVIDENCE_LIMIT, inspectBudgetEvidence, encodeBudgetEvidence, decodeBudgetEvidence } from "../src/operation-budget-evidence.js";
async function fixture(changes = {}) {
  const budgets = ["DAT", "EMA", "CAWELON"].map(agent => { const b=structuredClone(operationBudgetExample()); b.agent=agent; b.fees.operatorFeeBudgetWei="0"; return b; });
  const observations = budgets.map(b => observation({ balanceBaseUnits:b.token.balanceUnits, nativeBalanceBaseUnits:b.native.balanceWei, ...changes[b.agent] }, b.agent, b.chainId));
  return { schema:BUDGET_EVIDENCE_SCHEMA, budgetFile:encodeSharedOperationBudget({schema:SHARED_BUDGET_SCHEMA,simulationOnly:true,sameAccount:true,budgets}),
    observationFiles:await Promise.all(observations.map(async o => (await prepareTokenIdentityFile(o)).text)) };
}
test("matching historical records bind original bytes and amounts without claiming current or authenticated balances", async () => {
  const data=await fixture(), text=encodeBudgetEvidence(data), r=await inspectBudgetEvidence(decodeBudgetEvidence(text));
  assert.equal(r.consistent,true); assert.equal(r.budgetResult.constraintsSatisfied,true);
  assert.equal(r.currentBalanceVerified,false); assert.equal(r.authenticated,false); assert.equal(r.authorizesExecution,false);
  assert.equal(r.historicalOnly,true); assert.equal(r.comparisons.length,3); assert.equal(r.sourceHashes.length,3);
  assert.equal(encodeBudgetEvidence(r.input),text); assert.ok(Object.isFrozen(r.comparisons[0].observation));
});
for (const [change, code] of [
  [{ account:"0x2222222222222222222222222222222222222222" },"SOURCE_ACCOUNT_MISMATCH"],
  [{ blockNumber:"43" },"SOURCE_BLOCK_MISMATCH"],
  [{ blockHash:"0x"+"3".repeat(64) },"SOURCE_BLOCK_MISMATCH"],
  [{ nativeBalanceBaseUnits:"0" },"SOURCE_ETH_MISMATCH"]]) test("shared records reject " + code + " context differences", async () => {
    const r=await inspectBudgetEvidence(await fixture({EMA:change})); assert.equal(r.consistent,false); assert.ok(r.groupReasons.includes(code));
});
test("individual budget balance, decimals and network discrepancies are kept distinct", async () => {
  for (const [edit, expected] of [
    [b=>{b.token.balanceUnits="1";},"BUDGET_TOKEN_BALANCE_MISMATCH"],
    [b=>{b.token.decimals=6;},"BUDGET_DECIMALS_MISMATCH"],
    [b=>{b.chainId=8453;},"BUDGET_NETWORK_MISMATCH"],
    [b=>{b.native.balanceWei="1";},"BUDGET_ETH_BALANCE_MISMATCH"]]) {
    const data=await fixture(), b=structuredClone(operationBudgetExample());edit(b);data.budgetFile=encodeOperationBudget(b);data.observationFiles=data.observationFiles.slice(0,1);
    const r=await inspectBudgetEvidence(data);assert.equal(r.consistent,false);assert.ok(r.comparisons[0].reasons.includes(expected));
  }
});
test("sources from different supported networks cannot form a shared-account observation", async () => {
  const data=await fixture(), b=operationBudgetExample();
  data.observationFiles[1]=(await prepareTokenIdentityFile(observation({balanceBaseUnits:b.token.balanceUnits,nativeBalanceBaseUnits:b.native.balanceWei},"EMA",8453))).text;
  const r=await inspectBudgetEvidence(data);assert.equal(r.consistent,false);assert.ok(r.groupReasons.includes("SOURCE_NETWORK_MISMATCH"));
});
test("matching zero balance and insufficient budget are different conclusions", async () => {
  const data=await fixture(), b=structuredClone(operationBudgetExample());b.token.balanceUnits="0";
  data.budgetFile=encodeOperationBudget(b);data.observationFiles=[(await prepareTokenIdentityFile(observation({balanceBaseUnits:"0",nativeBalanceBaseUnits:b.native.balanceWei},"DAT",84532))).text];
  const r=await inspectBudgetEvidence(data);assert.equal(r.consistent,true);assert.equal(r.budgetResult.constraintsSatisfied,false);
});
test("missing, extra and duplicate token sources do not produce an accepted shared proof", async () => {
  const data=await fixture();data.observationFiles.pop();let r=await inspectBudgetEvidence(data);
  assert.equal(r.consistent,false);assert.ok(r.groupReasons.includes("SOURCE_SET_MISMATCH"));assert.deepEqual(r.comparisons[2].reasons,["SOURCE_MISSING"]);
  data.budgetFile=encodeOperationBudget(operationBudgetExample());r=await inspectBudgetEvidence(data);assert.ok(r.groupReasons.includes("SOURCE_SET_MISMATCH"));
  data.observationFiles[1]=data.observationFiles[0];await assert.rejects(inspectBudgetEvidence(data),{code:"DUPLICATE_SOURCE_AGENT"});
});
test("missing code or mismatched token metadata cannot be treated as a verified budget balance", async () => {
  const data=await fixture(), file=JSON.parse(data.observationFiles[0]);file.observation.metadata.symbol="OTHER";
  data.observationFiles[0]=(await prepareTokenIdentityFile(file.observation)).text;
  const r=await inspectBudgetEvidence(data);assert.ok(r.comparisons[0].reasons.includes("TOKEN_IDENTITY_UNCONFIRMED"));assert.equal(r.consistent,false);
  Object.assign(file.observation,{hasCode:false,metadata:null,balanceBaseUnits:null});
  data.observationFiles[0]=(await prepareTokenIdentityFile(file.observation)).text;
  assert.ok((await inspectBudgetEvidence(data)).comparisons[0].reasons.includes("TOKEN_IDENTITY_UNCONFIRMED"));
});
test("changed source bytes fail checksum while rechecksummed statements remain unauthenticated", async () => {
  const data=await fixture(), original=data.observationFiles[0], file=JSON.parse(original);file.observation.balanceBaseUnits="1";data.observationFiles[0]=JSON.stringify(file);
  await assert.rejects(inspectBudgetEvidence(data),{code:"IDENTITY_CHECKSUM"});
  data.observationFiles[0]=(await prepareTokenIdentityFile(file.observation)).text;
  const r=await inspectBudgetEvidence(data);assert.equal(r.authenticated,false);assert.equal(r.consistent,false);
});
test("bounded strict data capture prevents getters and protects asynchronous input comparison", async () => {
  const data=await fixture(), original=data.observationFiles[0];
  let release, entered;const started=new Promise(resolve=>{entered=resolve;});let once=true;
  const subtle={async digest(...args){if(once){once=false;entered();await new Promise(resolve=>{release=resolve;});}return webcrypto.subtle.digest(...args);}};
  const pending=inspectBudgetEvidence(data,{subtle});await started;data.observationFiles[0]="bad";release();
  const r=await pending;assert.equal(r.input.observationFiles[0],original);assert.equal(r.consistent,true);
  let calls=0;Object.defineProperty(data,"budgetFile",{get(){calls++;return "";}});await assert.rejects(inspectBudgetEvidence(data));assert.equal(calls,0);
  assert.throws(()=>decodeBudgetEvidence(" ".repeat(BUDGET_EVIDENCE_LIMIT+1)),{code:"FILE_TOO_LARGE"});
  assert.throws(()=>decodeBudgetEvidence('{"schema":"a","schema":"b"}'),{code:"INVALID_JSON"});
});
test("aborted hashing cannot finish a source-linked result", async () => {
  const data=await fixture(), controller=new AbortController();controller.abort();
  await assert.rejects(inspectBudgetEvidence(data,{signal:controller.signal}));
});
