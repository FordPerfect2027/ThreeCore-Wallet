import { captureDataRecord } from './security-data.js';
import { THREECORE_BASE_TOKENS } from './aerodrome-readonly.js';
import { quoteUnits,failAerodromeQuote as fail } from './aerodrome-quote-model.js';
export function validateAerodromeQuoteRequest(input){
 let data;try{data=captureDataRecord(input,['agent','direction','inputBaseUnits','slippageBps','blockNumber']);}catch{fail('QUOTE_REQUEST');}
 if(typeof data.agent!=='string'||!Object.hasOwn(THREECORE_BASE_TOKENS,data.agent)||!['buy','sell'].includes(data.direction))fail('QUOTE_REQUEST');
 quoteUnits(data.inputBaseUnits);if(data.inputBaseUnits==='0'||!Number.isInteger(data.slippageBps)||data.slippageBps<0||data.slippageBps>9999)fail('QUOTE_REQUEST');
 if(data.blockNumber!==null)quoteUnits(data.blockNumber);return Object.freeze({...data});
}
