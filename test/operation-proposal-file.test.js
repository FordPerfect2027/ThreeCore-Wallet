import test from "node:test";
import assert from "node:assert/strict";
import { proposalFixture } from "./helpers/proposal-fixtures.js";
import { encodeOperationProposal, encodeProposalReviewPolicy } from "../src/operation-proposal.js";
import { prepareOperationProposalReview, inspectOperationProposalReviewFile, PROPOSAL_REVIEW_FILE_LIMIT } from "../src/operation-proposal-file.js";
export const proposalFiles = f => ({ proposalFile: encodeOperationProposal(f.proposal), policyFile: encodeProposalReviewPolicy(f.policy), budgetEvidenceFile: f.evidenceText });

test("saved proposal review retains original text and recomputes historical success and failure",async()=>{
  const f=await proposalFixture(),files=proposalFiles(f);
  files.proposalFile="  "+files.proposalFile+"\n";
  for(const nowSeconds of [f.nowSeconds,f.nowSeconds+700]){
    const saved=await prepareOperationProposalReview(files,{nowSeconds}),checked=await inspectOperationProposalReviewFile(saved.text);
    assert.deepEqual(checked.files,files);assert.equal(checked.recordedResult.evaluatedAtSeconds,nowSeconds);
    assert.equal(checked.recordedResult.checksSatisfied,nowSeconds===f.nowSeconds);
    assert.equal(checked.timestampAuthenticated,false);assert.equal(checked.authorizesExecution,false);
    assert.equal((await prepareOperationProposalReview(checked.files,{nowSeconds})).text,saved.text);
  }
});
test("saved verdict, reasons, time and permissions cannot substitute for recomputation",async()=>{
  const f=await proposalFixture(),saved=await prepareOperationProposalReview(proposalFiles(f),{nowSeconds:f.nowSeconds});
  for(const [edit,code] of [
    [v=>{v.result.checksSatisfied=false;},"RECORDED_REVIEW_MISMATCH"],
    [v=>{v.result.reasons=["PROPOSAL_EXPIRED"];},"RECORDED_REVIEW_MISMATCH"],
    [v=>{v.evaluatedAtSeconds=f.nowSeconds+700;},"RECORDED_REVIEW_MISMATCH"],
    [v=>{v.evaluatedAtSeconds=null;},"INVALID_TIME"],
    [v=>{v.result.authorizesExecution=true;},"INVALID_REVIEW_FILE"],
    [v=>{v.result.extra=true;},"INVALID_REVIEW_FILE"],
    [v=>{v.budgetEvidenceFile+="\n";},"BUDGET_EVIDENCE_HASH_MISMATCH"]]){
    const value=JSON.parse(saved.text);edit(value);await assert.rejects(inspectOperationProposalReviewFile(JSON.stringify(value)),{code});
  }
  await assert.rejects(inspectOperationProposalReviewFile(" ".repeat(PROPOSAL_REVIEW_FILE_LIMIT+1)),{code:"FILE_TOO_LARGE"});
  const abort=new AbortController();abort.abort();await assert.rejects(inspectOperationProposalReviewFile(saved.text,{signal:abort.signal}));
});
