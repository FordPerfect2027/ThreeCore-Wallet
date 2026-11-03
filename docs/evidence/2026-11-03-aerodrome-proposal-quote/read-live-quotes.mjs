import { readFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readAerodromeQuote } from '../../../src/aerodrome-quote-reader.js';
import { prepareAerodromeQuoteFile,inspectAerodromeQuoteFile } from '../../../src/aerodrome-quote-model.js';
import { runAerodromeQuote } from '../../../scripts/aerodrome-quote.js';
import { fileURLToPath } from 'node:url';
const mode=process.argv[2]??'sell';if(!['sell','buy','sell1000'].includes(mode))throw Error('MODE');
const suffix=mode==='sell'?'':'-'+mode,direction=mode==='buy'?'buy':'sell',inputBaseUnits=mode==='buy'?'1000000':mode==='sell1000'?'1000000000000000000000':'1000000000000000000';
const dir=new URL('./',import.meta.url),rows=[];let blockNumber=mode==='sell'?undefined:JSON.parse(await readFile(new URL('live-results.json',dir),'utf8')).rows.find(r=>r.ok).blockNumber;
for(const agent of ['DAT','EMA','CAWELON']){
  const calls=[],startedAt=new Date().toISOString();
  const fetchImpl=async(url,options)=>{const request=JSON.parse(options.body);calls.push({method:request.method,params:request.params});return fetch(url,options);};
  try{
    const quote=await readAerodromeQuote({agent,direction,inputBaseUnits,slippageBps:50,...(blockNumber?{blockNumber}:{}),fetchImpl});blockNumber??=quote.blockNumber;
    const prepared=await prepareAerodromeQuoteFile(quote),path=new URL(agent+suffix+'-quote.json',dir);await writeFile(path,prepared.text,{flag:'wx'});
    const checked=await inspectAerodromeQuoteFile(await readFile(path,'utf8'));let stdout='',stderr='';const code=await runAerodromeQuote(['verify',fileURLToPath(path)],{write:s=>{stdout+=s;}},{write:s=>{stderr+=s;}});
    if(code!==0||stderr)throw Error('CLI_REPLAY_FAILED');
    const row={agent,startedAt,completedAt:new Date().toISOString(),ok:true,blockNumber:quote.blockNumber,blockHash:quote.blockHash,pool:quote.poolAddress,feeBps:quote.feeBps,inputBaseUnits:quote.inputBaseUnits,outputBaseUnits:quote.poolOutputBaseUnits,minimumOutputBaseUnits:checked.minimumOutputBaseUnits,outputShortfallBpsCeil:checked.outputShortfallBpsCeil,cliVerified:true,fileSha256:createHash('sha256').update(prepared.text).digest('hex'),requests:calls};rows.push(row);console.log(JSON.stringify({...row,requests:calls.length}));
  }catch(error){const row={agent,startedAt,completedAt:new Date().toISOString(),ok:false,errorCode:error.code??'UNEXPECTED_ERROR',requests:calls};rows.push(row);console.log(JSON.stringify({...row,requests:calls.length}));}
}
await writeFile(new URL('live-results'+suffix+'.json',dir),JSON.stringify({recordedAt:new Date().toISOString(),endpoint:'https://mainnet.base.org',direction,inputBaseUnits,readOnly:true,walletConnected:false,transactionsExecuted:false,rows},null,2)+'\n',{flag:'wx'});
if(rows.some(r=>!r.ok))process.exitCode=1;
