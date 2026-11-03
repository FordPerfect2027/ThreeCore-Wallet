import {readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {inspectProposalAllowanceReviewFile} from '../../../src/proposal-allowance.js';
const here=new URL('./',import.meta.url),downloads=new URL('file:///C:/Users/aseet/Downloads/');
const mapping=[['ThreeCore-proposal-allowance-review.json','browser-synthetic-pass.json'],['ThreeCore-proposal-allowance-review (1).json','browser-account2.json'],['ThreeCore-proposal-allowance-review (2).json','browser-account2-recheck.json']];
const hash=data=>createHash('sha256').update(data).digest('hex'),results=[];
for(const [from,to] of mapping){const bytes=await readFile(new URL(from,downloads));const result=await inspectProposalAllowanceReviewFile(bytes.toString('utf8'));results.push({file:to,sha256:hash(bytes),bytes:bytes.length,checked:result});await writeFile(new URL(to,here),bytes);}
assert.equal(results[0].checked.recordedResult.checksSatisfied,true);
const live=results[1].checked,recheck=results[2].checked;
assert.equal(live.files.observation.account,'0xcfae42798e867968c60fedf38d7ee401120072c8');assert.equal(live.files.observation.blockNumber,'53457078');
assert.equal(live.files.observation.allowanceBaseUnits,'0');assert.equal(live.files.observation.tokenBalanceBaseUnits,'0');assert.equal(live.files.observation.nativeBalanceBaseUnits,'700000000000000');
assert.deepEqual(live.recordedResult.reasons,['QUOTE_CONDITIONS_UNSATISFIED','ALLOWANCE_SHORTFALL','ALLOWANCE_BALANCE_SHORTFALL']);
assert.equal(live.files.quoteReviewFile,await readFile(new URL('historical-account2-input.json',here),'utf8'));assert.deepEqual(recheck.files,live.files);assert.equal(recheck.recordedResult.authorizesExecution,false);
for(const [from,to]of [['ThreeCore-proposal-allowance-pass-20261103.png','browser-synthetic-pass.png'],['ThreeCore-proposal-allowance-account2-20261103.png','browser-account2.png']])await copyFile(new URL(from,downloads),new URL(to,here));
const summary={files:results.map(({file,sha256,bytes,checked})=>({file,sha256,bytes,checksSatisfied:checked.recordedResult.checksSatisfied,reasons:checked.recordedResult.reasons,evaluatedAtSeconds:checked.recordedResult.evaluatedAtSeconds})),originalSourcesPreserved:true,livePublicRead:true,syntheticPassIsNotLiveEvidence:true,noSigningOrTransactions:true};
await writeFile(new URL('browser-verification.json',here),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
