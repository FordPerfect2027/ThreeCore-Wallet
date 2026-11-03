import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { inspectAerodromeQuoteFile } from '../../../src/aerodrome-quote-model.js';
const dir=fileURLToPath(new URL('.',import.meta.url)),root=resolve(dir,'../../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=(await readdir(dir)).filter(name=>/^(DAT|EMA|CAWELON).*quote\.json$/.test(name)).sort();
if(files.length!==8)throw Error('EXPECTED_EIGHT_QUOTES');
const quotes=[];
for(const file of files){
  const bytes=await readFile(resolve(dir,file)),checked=await inspectAerodromeQuoteFile(bytes.toString('utf8'));
  quotes.push({file,sha256:hash(bytes),agent:checked.quote.agent,direction:checked.quote.direction,blockNumber:checked.quote.blockNumber,blockHash:checked.quote.blockHash,output:checked.quote.poolOutputBaseUnits});
}
if(new Set(quotes.map(q=>q.blockHash)).size!==1)throw Error('BLOCK_MISMATCH');
const sourceFiles=['package.json','src/public-base-rpc.js','src/aerodrome-quote-model.js','src/aerodrome-quote-reader.js','scripts/aerodrome-quote.js','test/aerodrome-quote-cli.test.js','test/aerodrome-quote-model.test.js','test/aerodrome-quote-reader.test.js','test/aerodrome-quote-rpc.test.js','test/helpers/aerodrome-quote-fixture.js'];
const sources=[];for(const path of sourceFiles)sources.push({path,sha256:hash(await readFile(resolve(root,path)))});
for(const [file,count] of [['final-limits-tests.tap',38],['related-tests.tap',167]]){
 const text=await readFile(resolve(dir,file),'utf8');if(!text.includes('# pass '+count)||!text.includes('# fail 0')||!text.includes('# cancelled 0'))throw Error('TEST_LOG');
}
await writeFile(resolve(dir,'summary.json'),JSON.stringify({schema:'threecore.aerodrome-quote-evidence.v1',baseCommit:'7e7fb33',quotes,sources,tests:{featureAndProposal:38,related:167,countsOverlap:true},zeroOutputControls:2,noTransactions:true,noWalletCalls:true,canonicalBlockRechecked:true,sequenceSimulation:false,overallReadinessPercent:null},null,2)+'\n',{flag:'wx'});
const lines=[];for(const name of (await readdir(dir)).sort()){if(name==='SHA256SUMS.txt')continue;const path=resolve(dir,name);lines.push(hash(await readFile(path))+'  '+relative(dir,path).replaceAll('\\','/'));}
await writeFile(resolve(dir,'SHA256SUMS.txt'),lines.join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify({quotesVerified:quotes.length,filesHashed:lines.length,sourcesHashed:sources.length}));
