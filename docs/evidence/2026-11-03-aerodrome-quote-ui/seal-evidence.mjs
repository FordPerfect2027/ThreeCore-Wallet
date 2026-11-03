import { readFile,writeFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=fileURLToPath(new URL('.',import.meta.url)),root=resolve(dir,'../../..'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const downloads=JSON.parse(await readFile(resolve(dir,'browser-download-verification.json'),'utf8'));
if(downloads.records.length!==3||!downloads.records.every(r=>r.referenceFieldsMatchExceptAcquisitionTime))throw Error('DOWNLOAD_RESULT');
for(const r of downloads.records)if(hash(await readFile(resolve(dir,r.file)))!==r.sha256)throw Error('DOWNLOAD_HASH');
const tap=await readFile(resolve(dir,'related-tests.tap'),'utf8');if(!tap.includes('# pass 56')||!tap.includes('# fail 0')||!tap.includes('# cancelled 0'))throw Error('TEST_RESULT');
const paths=['src/aerodrome-quote-request.js','src/aerodrome-quote-client.js','examples/aerodrome-quote-http.js','examples/aerodrome-quote-page.js','examples/aerodrome-quote.html','examples/dev-server.js','examples/proposal-quote.html','integration/aerodrome-quote-server.test.mjs','integration/proposal-quote-server.test.mjs','test/aerodrome-quote-client.test.js','test/aerodrome-quote-page.test.js'];
const sources=[];for(const path of paths)sources.push({path,sha256:hash(await readFile(resolve(root,path)))});
await writeFile(resolve(dir,'summary.json'),JSON.stringify({baseCommit:'852a519',sources,relatedTestsPassed:56,realBrowserQuotes:3,canonicalBlock:'53457078',noWalletCalls:true,noTransactions:true,overallReadinessPercent:null,nextScope:['USDC spending budgets','gas and allowance linkage','isolated execution','AI connection pending user credential choice']},null,2)+'\n',{flag:'wx'});
const lines=[];for(const file of (await readdir(dir)).sort()){if(file==='SHA256SUMS.txt')continue;lines.push(hash(await readFile(resolve(dir,file)))+'  '+file);}
await writeFile(resolve(dir,'SHA256SUMS.txt'),lines.join('\n')+'\n',{flag:'wx'});console.log(JSON.stringify({evidenceFiles:lines.length,sources:sources.length}));
