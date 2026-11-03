#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBoundedLocalBytes } from './read-bounded-local-file.js';
import { withDiagnosticInterrupt } from './public-diagnostic-interrupt.js';
import { readPublicUsdc } from '../src/public-usdc-reader.js';
import { PublicUsdcError,PUBLIC_USDC_FILE_LIMIT,preparePublicUsdcFile,decodePublicUsdcFile,failPublicUsdc as fail } from '../src/public-usdc-model.js';
export async function runPublicUsdc(args,output=process.stdout,errors=process.stderr,{read=readPublicUsdc,signal}={}){
 try{
  if(!Array.isArray(args)||args.some(v=>typeof v!=='string'))fail('USDC_CLI_ARGS');
  if(args.length===1&&args[0]==='--help'){output.write('Usage: usdc:read -- read PUBLIC_ACCOUNT [BLOCK_NUMBER]\n       usdc:read -- verify SAVED_FILE\nBase Mainnet read-only USDC and ETH. No wallet connection or transactions.\n');return 0;}
  if(args[0]==='read'&&(args.length===2||args.length===3)){const observation=await read({account:args[1],...(args[2]===undefined?{}:{blockNumber:args[2]}),signal});output.write((await preparePublicUsdcFile(observation,{signal})).text);return 0;}
  if(args[0]==='verify'&&args.length===2&&args[1]&&!args[1].startsWith('--')){const bytes=await readBoundedLocalBytes(resolve(args[1]),PUBLIC_USDC_FILE_LIMIT,{fail,sizeCode:'USDC_FILE_SIZE',changedCode:'FILE_CHANGED'});let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('INVALID_UTF8');}output.write(JSON.stringify(await decodePublicUsdcFile(text,{signal}),null,2)+'\n');return 0;}
  fail('USDC_CLI_ARGS');
 }catch(error){errors.write('USDC read failed: '+(error instanceof PublicUsdcError?error.code:'SOURCE_OR_RPC_VALIDATION_FAILED')+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await withDiagnosticInterrupt(signal=>runPublicUsdc(process.argv.slice(2),process.stdout,process.stderr,{signal}));
