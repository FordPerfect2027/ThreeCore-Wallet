import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectOperationProposalReviewFile} from '../../../src/operation-proposal-file.js';
const here=dirname(fileURLToPath(import.meta.url)),dir='C:/Users/aseet/Downloads',records=[];
const names=[['ThreeCore-manual-proposal-review.json','browser-pass.json'],['ThreeCore-manual-proposal-review (1).json','browser-limit.json'],['ThreeCore-manual-proposal-review (2).json','browser-live-insufficient.json'],['ThreeCore-proposal-review (3).json','browser-recheck.json']];
const checked=[];
for(const [download,name] of names){const bytes=await readFile(resolve(dir,download)),result=await inspectOperationProposalReviewFile(bytes.toString('utf8'));checked.push(result);await writeFile(resolve(here,name),bytes,{flag:'wx'});records.push({download,file:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),checksSatisfied:result.recordedResult.checksSatisfied,reasons:result.recordedResult.reasons});}
const [pass,limit,live,recheck]=checked;
assert.equal(pass.recordedResult.checksSatisfied,true);assert.equal(pass.recordedResult.proposal.source.kind,'manual');assert.equal(pass.recordedResult.proposal.spendUnits,'4000000');
assert.equal(pass.files.budgetEvidenceFile,await readFile(resolve(here,'synthetic-usdc-evidence.json'),'utf8'));
assert.deepEqual(limit.recordedResult.reasons,['TOKEN_SPEND_LIMIT']);assert.equal(limit.recordedResult.policy.maxTokenSpendUnits,'3000000');assert.equal(limit.files.budgetEvidenceFile,pass.files.budgetEvidenceFile);
assert(live.recordedResult.reasons.includes('BUDGET_CONSTRAINTS_UNSATISFIED'));assert.equal(live.recordedResult.proposal.account,'0xcfae42798e867968c60fedf38d7ee401120072c8');assert.equal(live.files.budgetEvidenceFile,await readFile(resolve(here,'../2026-11-03-usdc-budget/browser-live-evidence.json'),'utf8'));
assert.deepEqual(recheck.files,pass.files);assert.equal(recheck.recordedResult.proposal.expiresAtSeconds,pass.recordedResult.proposal.expiresAtSeconds);assert(recheck.recordedResult.evaluatedAtSeconds>=pass.recordedResult.evaluatedAtSeconds);
for(const [source,target] of [['ThreeCore-manual-proposal-pass-20261103.png','browser-pass.png'],['ThreeCore-manual-proposal-insufficient-20261103.png','browser-live-insufficient.png'],['ThreeCore-manual-proposal-recheck-20261103.png','browser-recheck.png']])await copyFile(resolve(dir,source),resolve(here,target));
await writeFile(resolve(here,'browser-verification.json'),JSON.stringify({checkedAt:new Date().toISOString(),records,savedSourceTextPreserved:true,recheckDidNotExtendExpiry:true,noTransactions:true},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({files:records.length,recordedResultsVerified:true,sourcesPreserved:true,expiryPreserved:true}));
