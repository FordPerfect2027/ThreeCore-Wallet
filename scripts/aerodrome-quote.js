#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedLocalBytes } from './read-bounded-local-file.js';
import { withDiagnosticInterrupt } from './public-diagnostic-interrupt.js';
import { PROPOSAL_REVIEW_FILE_LIMIT } from '../src/operation-proposal-file.js';
import { readAerodromeQuote } from '../src/aerodrome-quote-reader.js';
import { AerodromeQuoteError,AERODROME_QUOTE_FILE_LIMIT,prepareAerodromeQuoteFile,inspectAerodromeQuoteFile,inspectProposalQuote } from '../src/aerodrome-quote-model.js';
const fail=code=>{throw new AerodromeQuoteError(code);};
const usage='Usage:\n  npm run dapp:quote -- read DAT|EMA|CAWELON buy|sell INPUT_BASE_UNITS SLIPPAGE_BPS [BLOCK_NUMBER]\n  npm run dapp:quote -- verify QUOTE_FILE\n  npm run dapp:quote -- review PROPOSAL_REVIEW_FILE QUOTE_FILE MAX_QUOTE_AGE_SECONDS MAX_BLOCK_AGE_SECONDS MAX_SHORTFALL_BPS MAX_SLIPPAGE_BPS\nRead-only observations. No wallet connection, signing or transaction.\n';
const integer=text=>{if(typeof text!=='string'||!/^(0|[1-9][0-9]{0,7})$/.test(text))fail('CLI_ARGUMENTS');return Number(text);};
async function file(path,limit){if(typeof path!=='string'||!path||path.startsWith('--'))fail('CLI_ARGUMENTS');const bytes=await readBoundedLocalBytes(resolve(path),limit,{fail,sizeCode:'FILE_TOO_LARGE',changedCode:'FILE_CHANGED'});try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('INVALID_UTF8');}}
export async function runAerodromeQuote(args,output=process.stdout,errors=process.stderr,{read=readAerodromeQuote,signal}={}){
  try{
    if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){output.write(usage);return 0;}
    if(!Array.isArray(args)||args.some(v=>typeof v!=='string'))fail('CLI_ARGUMENTS');
    if(args[0]==='read'&&(args.length===5||args.length===6)){
      const q=await read({agent:args[1],direction:args[2],inputBaseUnits:args[3],slippageBps:integer(args[4]),...(args[5]===undefined?{}:{blockNumber:args[5]}),signal});
      output.write((await prepareAerodromeQuoteFile(q,{signal})).text);return 0;
    }
    if(args[0]==='verify'&&args.length===2){const r=await inspectAerodromeQuoteFile(await file(args[1],AERODROME_QUOTE_FILE_LIMIT),{signal});output.write(JSON.stringify(r,null,2)+'\n');return 0;}
    if(args[0]==='review'&&args.length===7){
      const maxQuoteAgeSeconds=integer(args[3]),maxBlockAgeSeconds=integer(args[4]),maxOutputShortfallBps=integer(args[5]),maxSlippageBps=integer(args[6]);
      const result=await inspectProposalQuote(await file(args[1],PROPOSAL_REVIEW_FILE_LIMIT),await file(args[2],AERODROME_QUOTE_FILE_LIMIT),{signal,maxQuoteAgeSeconds,maxBlockAgeSeconds,maxOutputShortfallBps,maxSlippageBps});
      output.write(JSON.stringify(result,null,2)+'\n');return result.checksSatisfied?0:2;
    }
    fail('CLI_ARGUMENTS');
  }catch(error){errors.write('DApp quote failed: '+(error instanceof AerodromeQuoteError?error.code:'SOURCE_OR_RPC_VALIDATION_FAILED')+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  process.exitCode=await withDiagnosticInterrupt(signal=>runAerodromeQuote(process.argv.slice(2),process.stdout,process.stderr,{signal}));
