#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {inspectWalletSavedBatch,encodeWalletSavedBatch,walletSavedBatchErrorCode,WalletSavedBatchError} from './wallet-saved-batch.js';
const usage='Usage: node scripts/inspect-wallet-saved-batch.js SHA256SUMS.txt [--format json|csv]\n'+
 'Inspects up to 50 explicitly listed wallet JSON files under the manifest directory. Per file: 16 MiB; total: 64 MiB.\n'+
 'Checks exact external hashes, then validates supported original period, library, report, history and report-set files and their internal checksums.\n'+
 'Known auxiliary formats are declaration-only, never validated originals. Results contain destinations and counts, not account/balance/note contents.\n'+
 'No network, source writes, wallet operations, restoration or automatic repair. This is not an atomic filesystem snapshot or a source-authenticity claim.\n'+
 'CSV is a viewing summary; retain originals and the checksum list. Import all columns as text.\n'+
 'Exit 0: all selected files are validated originals; 2: any declaration-only or failed file; 1: invalid/changing manifest or arguments.\n';
export async function runWalletSavedBatch(args,{stdout=process.stdout,stderr=process.stderr}={}){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){stdout.write(usage);return 0;}
  if(!Array.isArray(args)||![1,3].includes(args.length)||args.some(value=>typeof value!=='string'||!value||value.includes('\0'))||args[0].startsWith('-')||(args.length===3&&(args[1]!=='--format'||!['json','csv'].includes(args[2]))))throw new WalletSavedBatchError('CLI_ARGUMENTS');
  const result=await inspectWalletSavedBatch(args[0]);stdout.write(encodeWalletSavedBatch(result,args[2]??'json'));return result.allOriginalsValidated?0:2;
 }catch(error){stderr.write('Wallet saved-file batch inspection failed: '+walletSavedBatchErrorCode(error)+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runWalletSavedBatch(process.argv.slice(2));
