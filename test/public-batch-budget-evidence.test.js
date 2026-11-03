import test from "node:test";
import assert from "node:assert/strict";
import {publicBatchFixture} from "./helpers/public-batch-fixture.js";
import {preparePublicTokenBatchFile} from "../src/public-token-batch-model.js";
import {operationBudgetExample,encodeOperationBudget} from "../src/operation-budget.js";
import {SHARED_BUDGET_SCHEMA,encodeSharedOperationBudget} from "../src/shared-operation-budget.js";
import {BUDGET_EVIDENCE_SCHEMA,inspectBudgetEvidence,encodeBudgetEvidence,decodeBudgetEvidence} from "../src/operation-budget-evidence.js";
async function input(){const batch=publicBatchFixture(),file=await preparePublicTokenBatchFile(batch);
 const budgets=batch.tokens.map(t=>{const b=structuredClone(operationBudgetExample());b.agent=t.agent;b.fees.operatorFeeBudgetWei="0";return b;});
 return {schema:BUDGET_EVIDENCE_SCHEMA,budgetFile:encodeSharedOperationBudget({schema:SHARED_BUDGET_SCHEMA,simulationOnly:true,sameAccount:true,budgets}),observationFiles:[file.text]};}
test("one public batch supplies all three same-block sources while retaining its different provenance",async()=>{
 const data=await input(),r=await inspectBudgetEvidence(data);assert.equal(r.consistent,true);assert.equal(r.sourceHashes.length,1);
 assert.equal(r.comparisons.length,3);assert.ok(r.comparisons.every(c=>c.observation.source==="public-rpc"&&c.observation.walletConnected===false));
 assert.equal(r.authenticated,false);assert.equal(r.currentBalanceVerified,false);assert.equal(r.authorizesExecution,false);
 const saved=encodeBudgetEvidence(r.input);assert.equal(encodeBudgetEvidence((await inspectBudgetEvidence(decodeBudgetEvidence(saved))).input),saved);
});
test("one- or two-token budgets select their referenced members from the full original batch",async()=>{
 const data=await input();data.budgetFile=encodeOperationBudget(operationBudgetExample());const r=await inspectBudgetEvidence(data);
 assert.equal(r.consistent,true);assert.equal(r.comparisons.length,1);assert.equal(r.comparisons[0].agent,"DAT");
 const shared=JSON.parse((await input()).budgetFile);shared.budgets.pop();data.budgetFile=encodeSharedOperationBudget(shared);
 assert.equal((await inspectBudgetEvidence(data)).comparisons.length,2);assert.equal((await inspectBudgetEvidence(data)).consistent,true);
});
test("unknown token identity, changed original bytes, and duplicate public batches cannot pass",async()=>{
 const data=await input(),batch=publicBatchFixture();batch.tokens[0].metadata.symbol="OTHER";data.observationFiles=[(await preparePublicTokenBatchFile(batch)).text];
 assert.equal((await inspectBudgetEvidence(data)).consistent,false);
 const raw=JSON.parse(data.observationFiles[0]);raw.batch.nativeBalanceBaseUnits="1";data.observationFiles=[JSON.stringify(raw)];
 await assert.rejects(inspectBudgetEvidence(data),{code:"BATCH_FILE_CHECKSUM"});
 const valid=await input();valid.observationFiles.push(valid.observationFiles[0]);await assert.rejects(inspectBudgetEvidence(valid),{code:"DUPLICATE_SOURCE_AGENT"});
});
