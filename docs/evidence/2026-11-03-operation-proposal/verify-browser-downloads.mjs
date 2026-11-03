import assert from 'node:assert/strict';
import { readFile,writeFile,copyFile,constants,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inspectOperationProposalReviewFile } from '../../../src/operation-proposal-file.js';
import { runOperationProposalCheck } from '../../../scripts/check-operation-proposal.js';
const root=new URL('./',import.meta.url),downloadDir='C:/Users/aseet/Downloads/';
const archiveDir=new URL('./browser-downloads/',root);await mkdir(archiveDir);
const rows=[];
for(const [name,expected,reason] of [['ThreeCore-proposal-review.json',true,null],['ThreeCore-proposal-review (1).json',false,'PROPOSAL_EXPIRED'],['ThreeCore-proposal-review (2).json',false,'TOKEN_SPEND_LIMIT']]){
  const path=downloadDir+name,bytes=await readFile(path),source=bytes.toString('utf8'),checked=await inspectOperationProposalReviewFile(source);
  assert.equal(checked.recordedResult.checksSatisfied,expected);if(reason)assert(checked.recordedResult.reasons.includes(reason));assert.equal(checked.authorizesExecution,false);
  let output='',errors='';const code=await runOperationProposalCheck(['--verify-saved',path],{write:s=>{output+=s;}},{write:s=>{errors+=s;}});
  assert.equal(code,expected?0:2);assert.equal(errors,'');assert.equal(JSON.parse(output).savedResultReproduced,true);
  if(!reason||reason==='TOKEN_SPEND_LIMIT'){
    assert.equal(checked.files.proposalFile,await readFile(new URL('browser-fixtures/proposal.json',root),'utf8'));
    assert.equal(checked.files.policyFile,await readFile(new URL('browser-fixtures/'+(reason?'policy-over-limit.json':'policy.json'),root),'utf8'));
    assert.equal(checked.files.budgetEvidenceFile,await readFile(new URL('browser-fixtures/budget-evidence.json',root),'utf8'));
  }else{
    const historical=await inspectOperationProposalReviewFile(await readFile(new URL('browser-fixtures/previously-passed-now-expired.json',root),'utf8'));
    assert.equal(historical.recordedResult.checksSatisfied,true);assert.deepEqual(checked.files,historical.files);
  }
  assert.deepEqual(await readFile(path),bytes);
  await copyFile(path,new URL(name,archiveDir),constants.COPYFILE_EXCL);
  rows.push({file:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),exactOriginalInputs:true,recordedResultReproduced:true,checksSatisfied:expected,reasons:checked.recordedResult.reasons,cliExitCode:code,evaluatedAtSeconds:checked.recordedResult.evaluatedAtSeconds});
}
const screenshots=[];
for(const name of ['ThreeCore-proposal-reviewed-20261103.jpg','ThreeCore-proposal-expiry-20261103.png','ThreeCore-proposal-limit-20261103.png']){
  const bytes=await readFile(downloadDir+name);await copyFile(downloadDir+name,new URL(name,archiveDir),constants.COPYFILE_EXCL);
  screenshots.push({file:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const report={verifiedAt:new Date().toISOString(),origin:'http://127.0.0.1:4248/proposals/',syntheticData:true,actualBrowserFileSelection:true,actualBrowserDownloads:true,actualModelCalls:0,actualWalletCalls:0,files:rows,screenshots};
await writeFile(new URL('actual-browser-verification.json',root),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));
