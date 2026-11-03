#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {reviewWalletSavedLocalBatchComparison,encodeWalletSavedLocalBatchComparisonReview,walletSavedBatchErrorCode,WalletSavedBatchError} from './wallet-saved-batch.js';
const usage='Usage: node scripts/verify-wallet-saved-batch-comparison.js BEFORE_SHA256SUMS.txt AFTER_SHA256SUMS.txt comparison.json\n'+
 'Recomputes a CLI batch comparison from both original local manifests and their files, then checks every saved comparison field.\n'+
 'Comparison JSON is limited to 4 MiB. Browser comparison receipts use a separate format and must be checked in the browser.\n'+
 'Exit 0: the saved comparison matches recomputation, even if its originals differ or are unverified; 2: comparison mismatch; 1: invalid input.\n'+
 'Inspect allSelectedOriginalsIdentical and expectedSummary separately. No wallet operations, network, source writes, imports or repairs.\n'+
 'This is not an atomic filesystem snapshot, authentication or a live-chain check. Preserve both manifests and originals.\n';
export async function runWalletSavedBatchComparisonVerification(args,{stdout=process.stdout,stderr=process.stderr}={}){
 try{if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){stdout.write(usage);return 0;}
  if(!Array.isArray(args)||args.length!==3||args.some(value=>typeof value!=='string'||!value||value.includes('\0')||value.startsWith('-'))||!args[2].toLowerCase().endsWith('.json'))throw new WalletSavedBatchError('CLI_ARGUMENTS');
  const result=await reviewWalletSavedLocalBatchComparison(...args);stdout.write(encodeWalletSavedLocalBatchComparisonReview(result));return result.matchesRecomputation?0:2;
 }catch(error){stderr.write('Wallet saved-file batch comparison verification failed: '+walletSavedBatchErrorCode(error)+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runWalletSavedBatchComparisonVerification(process.argv.slice(2));
