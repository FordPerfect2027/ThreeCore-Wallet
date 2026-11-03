import { readFile,writeFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../../../',import.meta.url),dir=new URL('./',import.meta.url);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceNames=['src/operation-proposal.js','src/operation-proposal-file.js','scripts/check-operation-proposal.js','examples/operation-proposal-page.js','examples/operation-proposal.html','examples/dev-server.js','examples/operation-budget-evidence.html','package.json','test/operation-proposal.test.js','test/operation-proposal-cli.test.js','test/operation-proposal-file.test.js','test/operation-proposal-page.test.js','test/helpers/proposal-fixtures.js','integration/operation-proposal-server.test.mjs'];
const source=[];for(const path of sourceNames){const bytes=await readFile(new URL(path,root));source.push({path,bytes:bytes.length,sha256:sha(bytes)});}
await writeFile(new URL('source-inventory.json',dir),JSON.stringify({baseCommit:'7272e81',sources:source},null,2)+'\n',{flag:'wx'});
const feature=await readFile(new URL('final-proposal-tests.tap',dir),'utf8'),related=await readFile(new URL('related-regression.tap',dir),'utf8');
for(const [log,count] of [[feature,25],[related,207]])if(!log.includes('# tests '+count+'\n')||!log.includes('# pass '+count+'\n')||!log.includes('# fail 0\n')||!log.includes('# cancelled 0\n'))throw Error('TEST_SUMMARY');
await writeFile(new URL('summary.json',dir),JSON.stringify({recordedAt:new Date().toISOString(),baseCommit:'7272e81',featureTests:25,relatedTests:207,failures:0,cancellations:0,actualBrowser:'actual-browser-verification.json',syntheticBrowserData:true,productAiIntegration:false,liveDappQuotes:false,userWalletTransactions:false,wholeProject90PercentClaimed:false},null,2)+'\n',{flag:'wx'});
async function walk(path=''){const entries=await readdir(new URL(path,dir),{withFileTypes:true});const files=[];for(const entry of entries){const name=path+entry.name;if(entry.isDirectory())files.push(...await walk(name+'/'));else if(entry.isFile()&&name!=='SHA256SUMS.txt')files.push(name);else throw Error('UNEXPECTED_ENTRY');}return files;}
const names=(await walk()).sort(),lines=[];for(const name of names)lines.push(sha(await readFile(new URL(name,dir)))+'  '+name);
await writeFile(new URL('SHA256SUMS.txt',dir),lines.join('\n')+'\n',{flag:'wx'});console.log(JSON.stringify({sourceFiles:source.length,evidenceFiles:names.length}));
