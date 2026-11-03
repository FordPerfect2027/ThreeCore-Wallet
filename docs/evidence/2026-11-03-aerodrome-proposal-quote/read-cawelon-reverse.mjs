import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { readAerodromeQuote } from '../../../src/aerodrome-quote-reader.js';
import { prepareAerodromeQuoteFile,inspectAerodromeQuoteFile } from '../../../src/aerodrome-quote-model.js';
const dir=new URL('./',import.meta.url),buy=(await inspectAerodromeQuoteFile(await readFile(new URL('CAWELON-buy-quote.json',dir),'utf8'))).quote;
// Derive the input from an observed quote, rather than guessing token denomination.
const quote=await readAerodromeQuote({agent:'CAWELON',direction:'sell',inputBaseUnits:buy.poolOutputBaseUnits,slippageBps:50,blockNumber:buy.blockNumber});
assert.equal(quote.blockHash,buy.blockHash);const file=await prepareAerodromeQuoteFile(quote);await writeFile(new URL('CAWELON-derived-reverse-quote.json',dir),file.text,{flag:'wx'});
const checks=[];for(const amount of [10n**18n,1000n*10n**18n]){const net=amount-amount*BigInt(buy.feeBps)/10000n;const result=net*BigInt(buy.reserveInBaseUnits)/(BigInt(buy.reserveOutBaseUnits)+net);assert.equal(result,0n);checks.push({inputBaseUnits:amount.toString(),computedOutputBaseUnits:result.toString()});}
const report={recordedAt:new Date().toISOString(),readOnly:true,transactionsExecuted:false,source:'CAWELON-buy-quote.json',sourceOutputUsedAsReverseInput:true,blockNumber:quote.blockNumber,blockHash:quote.blockHash,inputBaseUnits:quote.inputBaseUnits,outputBaseUnits:quote.poolOutputBaseUnits,zeroInputControls:checks};
await writeFile(new URL('cawelon-reverse-result.json',dir),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report,null,2));
