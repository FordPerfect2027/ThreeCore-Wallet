#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {readSavedTextPath,savedJSONPath,savedCLIError} from './saved-file-cli-io.js';
import {reviewWalletSavedBatchEvidence,encodeWalletSavedBatchEvidenceReview,WALLET_SAVED_BATCH_EVIDENCE_LIMIT} from '../src/file-read-status.js';
export async function runWalletBatchEvidence(args,output=process.stdout,errors=process.stderr){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){output.write('Usage: node scripts/verify-wallet-batch-evidence.js evidence.json\nOffline recomputation of embedded saved-file inspections. 48 MiB bundle, 24 MiB combined sources, 20 files. Does not restore, contact a provider or write the source.\nExit 0: faithful evidence, including faithful negative or non-checksummed results; inspect allOriginalsValidated and expectedSummary separately. Exit 2: changed claims. Exit 1: invalid/incomplete input.\n');return 0;}
  if(!Array.isArray(args)||args.length!==1||!savedJSONPath(args[0]))throw Error('FILE_CLI_ARGUMENTS');
  const review=await reviewWalletSavedBatchEvidence(await readSavedTextPath(args[0],WALLET_SAVED_BATCH_EVIDENCE_LIMIT));output.write(encodeWalletSavedBatchEvidenceReview(review));return review.matchesRecomputation?0:2;
 }catch(error){errors.write(savedCLIError(error)+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runWalletBatchEvidence(process.argv.slice(2));
