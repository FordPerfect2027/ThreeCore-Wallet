#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {compareWalletSavedBatchManifests,encodeWalletSavedLocalBatchComparison,walletSavedBatchErrorCode,WalletSavedBatchError} from './wallet-saved-batch.js';
const usage='Usage: node scripts/compare-wallet-saved-batches.js BEFORE_SHA256SUMS.txt AFTER_SHA256SUMS.txt [--format json|csv]\n'+
 'Reads both explicit local manifests, validates their file hashes and supported original wallet formats, then compares exact relative paths.\n'+
 'Each manifest permits 50 JSON files, 16 MiB per file and 64 MiB total. Checks are sequential, not an atomic filesystem snapshot.\n'+
 'Distinguishes identical originals/text, formatting-only changes, content changes, different formats, unverified pairs and one-sided selections.\n'+
 'An omitted selection is not a filesystem deletion. CSV is a viewing table; import columns as text. Preserve originals and both manifests.\n'+
 'No network, wallet operations, source writes, imports or repairs. No source-authenticity or live-chain guarantee.\n'+
 'Exit 0: all selected originals and text are identical; 2: any difference or unverified selection; 1: invalid input.\n';
export async function runWalletSavedBatchComparison(args,{stdout=process.stdout,stderr=process.stderr}={}){
 try{if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){stdout.write(usage);return 0;}
  if(!Array.isArray(args)||![2,4].includes(args.length)||args.some(value=>typeof value!=='string'||!value||value.includes('\0'))||args.slice(0,2).some(value=>value.startsWith('-'))||(args.length===4&&(args[2]!=='--format'||!['json','csv'].includes(args[3]))))throw new WalletSavedBatchError('CLI_ARGUMENTS');
  const result=await compareWalletSavedBatchManifests(args[0],args[1]);stdout.write(encodeWalletSavedLocalBatchComparison(result,args[3]??'json'));return result.allSelectedOriginalsIdentical?0:2;
 }catch(error){stderr.write('Wallet saved-file batch comparison failed: '+walletSavedBatchErrorCode(error)+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runWalletSavedBatchComparison(process.argv.slice(2));
