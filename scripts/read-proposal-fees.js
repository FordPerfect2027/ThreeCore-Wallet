#!/usr/bin/env node
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readBoundedLocalBytes} from './read-bounded-local-file.js';
import {withDiagnosticInterrupt} from './public-diagnostic-interrupt.js';
import {SIMULATION_PLAN_FILE_LIMIT} from '../src/proposal-simulation-plan.js';
import {readProposalFeeReview} from '../src/proposal-fee-reader.js';
import {readBaseFeeBounds,BaseFeeReadError,failBaseFee as fail} from '../src/base-fee-reader.js';
export async function runReadProposalFees(args,output=process.stdout,errors=process.stderr,{signal,read=readProposalFeeReview,bounds=readBaseFeeBounds}={}){
 try{
  if(!Array.isArray(args)||args.some(s=>typeof s!=='string'))fail('FEE_CLI_ARGUMENTS');
  if(args.length===1&&args[0]==='--help'){output.write('Usage:\n  node scripts/read-proposal-fees.js read SIMULATION_PLAN_FILE\n  node scripts/read-proposal-fees.js bounds UNSIGNED_TX_BYTES GAS_LIMIT [BLOCK_NUMBER]\nFixed public Base read/simulation only. Bounds alone do not simulate a swap. No signing or broadcast.\n');return 0;}
  if(args[0]==='read'&&args.length===2&&args[1]&&!args[1].startsWith('--')){
   const bytes=await readBoundedLocalBytes(resolve(args[1]),SIMULATION_PLAN_FILE_LIMIT,{fail,sizeCode:'FEE_FILE_SIZE',changedCode:'FEE_FILE_CHANGED'});let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('FEE_FILE_ENCODING');}
   const result=await read(text,{signal});output.write(result.review.text);return result.review.result.checksSatisfied?0:2;
  }
  if(args[0]==='bounds'&&(args.length===3||args.length===4)&&/^[1-9][0-9]{0,4}$/.test(args[1])){
   const result=await bounds({blockNumber:args[3]??null,blockHash:null,unsignedTransactionBytes:Number(args[1]),gasLimit:args[2]},{signal});output.write(JSON.stringify(result,null,2)+'\n');return result.failures.length?2:0;
  }
  fail('FEE_CLI_ARGUMENTS');
 }catch(error){errors.write('Public fee read failed: '+(error instanceof BaseFeeReadError?error.code:'SOURCE_OR_RPC_VALIDATION_FAILED')+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await withDiagnosticInterrupt(signal=>runReadProposalFees(process.argv.slice(2),process.stdout,process.stderr,{signal}));
