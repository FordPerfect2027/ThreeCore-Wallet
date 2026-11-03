import { readFile,writeFile,copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectAerodromeQuoteFile } from '../../../src/aerodrome-quote-model.js';
const dir=fileURLToPath(new URL('.',import.meta.url)),prior=resolve(dir,'../2026-11-03-aerodrome-proposal-quote'),downloads='C:/Users/aseet/Downloads',records=[];
for(const [agent,direction,reference]of [['DAT','sell','DAT-sell1000-quote.json'],['EMA','buy','EMA-buy-quote.json'],['CAWELON','buy','CAWELON-buy-quote.json']]){
 const original='ThreeCore-Aerodrome-'+agent+'-'+direction+'-quote.json',bytes=await readFile(resolve(downloads,original)),checked=await inspectAerodromeQuoteFile(bytes.toString('utf8')),baseline=await inspectAerodromeQuoteFile(await readFile(resolve(prior,reference),'utf8'));
 for(const key of Object.keys(baseline.quote))if(key!=='observedAtSeconds'&&baseline.quote[key]!==checked.quote[key])throw Error('REFERENCE_MISMATCH:'+key);
 const file=agent+'-'+direction+'-browser-quote.json';await writeFile(resolve(dir,file),bytes,{flag:'wx'});
 records.push({original,file,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,reference,referenceFieldsMatchExceptAcquisitionTime:true,blockNumber:checked.quote.blockNumber,blockHash:checked.quote.blockHash,observedAtSeconds:checked.quote.observedAtSeconds,inputBaseUnits:checked.quote.inputBaseUnits,outputBaseUnits:checked.quote.poolOutputBaseUnits});
}
await copyFile(resolve(downloads,'ThreeCore-Aerodrome-DAT-20261103.png'),resolve(dir,'browser-DAT.png'));
await writeFile(resolve(dir,'browser-download-verification.json'),JSON.stringify({records,realPublicChain:true,normalServerPort:4250,walletCalled:false,transactionExecuted:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({downloadsVerified:records.length,fieldsMatched:true}));
