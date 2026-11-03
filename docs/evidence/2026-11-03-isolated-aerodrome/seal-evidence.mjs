import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inspectProposalFeeReviewFile} from '../../../src/proposal-fee-review.js';
const here=new URL('./',import.meta.url),root=new URL('../../../',here),sha=b=>createHash('sha256').update(b).digest('hex');
const original=await readFile(new URL('DAT-buy-fee-review.json',here),'utf8'),download=await readFile(new URL('browser-original.json',here),'utf8'),current=await readFile(new URL('browser-current.json',here),'utf8');
assert.equal(download,original);
const saved=await inspectProposalFeeReviewFile(download),rechecked=await inspectProposalFeeReviewFile(current);
assert.deepEqual(saved.files,rechecked.files);assert.equal(saved.recordedResult.totalFeeUpperBoundWei,null);assert(rechecked.recordedResult.reasons.includes('FEE_PLAN_BLOCKED'));assert(rechecked.recordedResult.reasons.includes('FEE_OBSERVATION_EXPIRED'));
const names=['scripts/prepare-local-aerodrome.js','scripts/compile-local-aerodrome.js','scripts/run-local-aerodrome-simulation.js','scripts/verify-local-aerodrome-evidence.js','integration/local-aerodrome-simulation.mjs','integration/fixtures/ThreeCoreTestUSDC.sol','integration/fixtures/local-proposal-source.js','src/proposal-fee-review.js','scripts/proposal-fee-review.js','examples/proposal-fee-page.js','examples/proposal-fee.html','examples/dev-server.js','examples/proposal-allowance.html','test/proposal-fee-review.test.js','test/proposal-fee-page.test.js'];
const sources=[];for(const path of names){const bytes=await readFile(new URL(path,root));sources.push({path,bytes:bytes.length,sha256:sha(bytes)});}
await writeFile(new URL('source-inventory.json',here),JSON.stringify({baseCommit:'01848e6',sources},null,2)+'\n');
await writeFile(new URL('browser-verification.json',here),JSON.stringify({browser:'Codex in-app browser',url:'http://127.0.0.1:4255/proposals/fees/',originalDownloadSha256:sha(download),originalReexportByteIdentical:true,currentDownloadSha256:sha(current),originalSourceAndObservationPreserved:true,currentReasons:rechecked.recordedResult.reasons,sourceEnvironment:saved.recordedResult.environment,userWalletUsed:false},null,2)+'\n');
const lines=[];for(const name of(await readdir(here)).filter(n=>n!=='SHA256SUMS.txt').sort())lines.push(sha(await readFile(new URL(name,here)))+'  '+name);
await writeFile(new URL('SHA256SUMS.txt',here),lines.join('\n')+'\n');console.log(JSON.stringify({sourceFiles:sources.length,evidenceFiles:lines.length,browserDownloadsVerified:2}));
