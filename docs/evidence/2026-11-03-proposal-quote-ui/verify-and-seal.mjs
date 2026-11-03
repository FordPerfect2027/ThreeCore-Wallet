import { readFile,writeFile,readdir,copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectProposalQuoteReviewFile } from '../../../src/proposal-quote-file.js';
const dir=fileURLToPath(new URL('.',import.meta.url)),root=resolve(dir,'../../..'),downloads='C:/Users/aseet/Downloads';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),records=[];
const expected=[[],['QUOTE_SLIPPAGE_LIMIT'],['PROPOSAL_CONDITIONS_UNSATISFIED','QUOTE_STALE','QUOTE_BLOCK_STALE'],['QUOTE_PROPOSAL_MISMATCH','QUOTE_BUDGET_BLOCK_MISMATCH','QUOTE_STALE','QUOTE_BLOCK_STALE']];
for(let i=0;i<4;i++){
 const original='ThreeCore-proposal-quote-review'+(i?' ('+i+')':'')+'.json',bytes=await readFile(resolve(downloads,original)),r=await inspectProposalQuoteReviewFile(bytes.toString('utf8'));
 if(JSON.stringify(r.recordedResult.reasons)!==JSON.stringify(expected[i])||r.recordedResult.checksSatisfied!==(i===0))throw Error('RESULT_MISMATCH');
 const file='browser-review-'+i+'.json';await writeFile(resolve(dir,file),bytes,{flag:'wx'});
 records.push({original,file,bytes:bytes.length,sha256:hash(bytes),reasons:r.recordedResult.reasons,recordedChecksSatisfied:r.recordedResult.checksSatisfied,syntheticProposal:true,syntheticQuote:i!==3});
}
for(const kind of ['pass','expired','mismatch'])await copyFile(resolve(downloads,'ThreeCore-proposal-quote-'+kind+'-20261103.png'),resolve(dir,'browser-'+kind+'.png'));
const sourcePaths=['src/proposal-quote-file.js','examples/proposal-quote.html','examples/proposal-quote-page.js','examples/operation-proposal.html','examples/dev-server.js','test/proposal-quote-file.test.js','test/proposal-quote-page.test.js','test/helpers/proposal-quote-fixture.js','integration/proposal-quote-server.test.mjs'];
const sources=[];for(const path of sourcePaths)sources.push({path,sha256:hash(await readFile(resolve(root,path)))});
const tap=await readFile(resolve(dir,'related-tests.tap'),'utf8');if(!tap.includes('# pass 48')||!tap.includes('# fail 0')||!tap.includes('# cancelled 0'))throw Error('TEST_RESULT');
await writeFile(resolve(dir,'summary.json'),JSON.stringify({baseCommit:'731f213',records,sources,relatedTestsPassed:48,actualBrowserDownloadAndReload:true,normalServerPort:4249,sourceFilesRetained:true,currentStateVerified:false,transactionExecuted:false,productModelCalled:false,overallReadinessPercent:null},null,2)+'\n',{flag:'wx'});
const lines=[];for(const file of (await readdir(dir)).sort()){if(file==='SHA256SUMS.txt')continue;lines.push(hash(await readFile(resolve(dir,file)))+'  '+file);}
await writeFile(resolve(dir,'SHA256SUMS.txt'),lines.join('\n')+'\n',{flag:'wx'});console.log(JSON.stringify({downloadsVerified:4,evidenceFiles:lines.length,sourceFiles:sources.length}));
