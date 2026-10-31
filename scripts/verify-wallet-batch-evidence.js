#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {readSavedTextPath,savedJSONPath,savedCLIError} from './saved-file-cli-io.js';
import {reviewWalletSavedBatchEvidence,encodeWalletSavedBatchEvidenceReview,extractWalletSavedBatchEvidenceSource,WALLET_SAVED_BATCH_EVIDENCE_LIMIT} from '../src/file-read-status.js';
export async function runWalletBatchEvidence(args,output=process.stdout,errors=process.stderr){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){output.write('Usage: node scripts/verify-wallet-batch-evidence.js evidence.json\n       node scripts/verify-wallet-batch-evidence.js extract evidence.json exact-name.json\nOffline recomputation of embedded saved-file inspections. 48 MiB bundle, 24 MiB combined sources, 20 files. Does not restore, contact a provider or write the source.\nExtract emits only the exact named source to stdout after a faithful review; names are case-sensitive and no destination paths are accepted. Faithfully recorded negative/invalid sources can be extracted for inspection, without becoming validated originals.\nExit 0: faithful evidence, including faithful negative or non-checksummed results; inspect allOriginalsValidated and expectedSummary separately. Exit 2: changed claims (no extracted bytes). Exit 1: invalid/incomplete input or missing source name.\n');return 0;}
  const extract=Array.isArray(args)&&args.length===3&&args[0]==='extract';
  if(!Array.isArray(args)||!(args.length===1||extract)||!savedJSONPath(args[extract?1:0])||(extract&&(typeof args[2]!=='string'||!args[2])))throw Error('FILE_CLI_ARGUMENTS');
  const review=await reviewWalletSavedBatchEvidence(await readSavedTextPath(args[extract?1:0],WALLET_SAVED_BATCH_EVIDENCE_LIMIT));
  if(extract){if(!review.matchesRecomputation){errors.write('FILE_BATCH_EVIDENCE_UNVERIFIED\n');return 2;}output.write(extractWalletSavedBatchEvidenceSource(review,args[2]).text);return 0;}
  output.write(encodeWalletSavedBatchEvidenceReview(review));return review.matchesRecomputation?0:2;
 }catch(error){errors.write(savedCLIError(error)+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runWalletBatchEvidence(process.argv.slice(2));
