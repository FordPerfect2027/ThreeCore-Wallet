#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {readSavedTextPath,savedJSONPath,savedCLIError} from './saved-file-cli-io.js';
import {reviewWalletSavedBatchEvidence,encodeWalletSavedBatchEvidenceReview,extractWalletSavedBatchEvidenceSource,WALLET_SAVED_BATCH_EVIDENCE_LIMIT} from '../src/file-read-status.js';
import {reviewWalletSavedBatchEvidenceReceipt,encodeWalletSavedBatchEvidenceReceiptCheck} from '../src/file-read-status.js';
import {reviewWalletBatchComparisonEvidence,encodeWalletBatchComparisonEvidenceReview,extractWalletBatchComparisonEvidenceSource,WALLET_BATCH_COMPARISON_EVIDENCE_LIMIT} from '../src/file-read-status.js';
import {queryWalletBatchComparisonDifferences,encodeWalletBatchComparisonDifferences} from '../src/file-read-status.js';
export async function runWalletBatchEvidence(args,output=process.stdout,errors=process.stderr){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){output.write('Usage: node scripts/verify-wallet-batch-evidence.js evidence.json\n       node scripts/verify-wallet-batch-evidence.js extract evidence.json exact-name.json\n       node scripts/verify-wallet-batch-evidence.js verify-receipt evidence.json receipt.json\n       node scripts/verify-wallet-batch-evidence.js comparison comparison-evidence.json\n       node scripts/verify-wallet-batch-evidence.js extract-comparison comparison-evidence.json before|after exact-name.json\n       node scripts/verify-wallet-batch-evidence.js differences comparison-evidence.json same-name.json [--path text] [--offset 0|40|80|...]\nLocation pages compare embedded JSON values by position (2 MiB each), emit paths and hashes only, and do not validate the originals. A zero filtered count is not global equality.\nExact-role extraction requires a faithful comparison review and emits only the original bytes to stdout; current selections and files are unchanged.\nComparison bundles: 96 MiB maximum, 24 MiB source text per group; fresh snapshots, no processing-history proof.\nOffline recomputation of embedded saved-file inspections. 48 MiB bundle, 24 MiB combined sources, 20 files. Does not restore, contact a provider or write the source.\nExtract emits only the exact named source to stdout after a faithful review; names are case-sensitive and no destination paths are accepted. Faithfully recorded negative/invalid sources can be extracted for inspection, without becoming validated originals.\nReceipt mode compares every field and the bundle hash; a faithful negative receipt can pass without making its source evidence valid.\nExit 0: faithful evidence, including faithful negative or non-checksummed results; inspect allOriginalsValidated and expectedSummary separately. Exit 2: changed claims (no extracted bytes). Exit 1: invalid/incomplete input or missing source name.\n');return 0;}
  if(Array.isArray(args)&&args[0]==='differences'){
   if(args.length<3||args.length>7||args.length%2!==1||!savedJSONPath(args[1])||typeof args[2]!=='string'||!args[2])throw Error('FILE_CLI_ARGUMENTS');
   const options={},seen=new Set();for(let i=3;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!['--offset','--path'].includes(flag)||seen.has(flag)||typeof value!=='string')throw Error('FILE_CLI_ARGUMENTS');seen.add(flag);if(flag==='--offset'){if(!/^(0|[1-9][0-9]{0,6})$/.test(value))throw Error('FILE_CLI_ARGUMENTS');options.offset=Number(value);}else options.pathIncludes=value;}
   const checked=await reviewWalletBatchComparisonEvidence(await readSavedTextPath(args[1],WALLET_BATCH_COMPARISON_EVIDENCE_LIMIT));if(!checked.matchesRecomputation){errors.write('FILE_BATCH_COMPARISON_UNVERIFIED\n');return 2;}
   output.write(encodeWalletBatchComparisonDifferences(queryWalletBatchComparisonDifferences(checked,args[2],options)));return 0;
  }
  if(Array.isArray(args)&&['comparison','extract-comparison'].includes(args[0])){
   const extract=args[0]==='extract-comparison';
   if(args.length!==(extract?4:2)||!savedJSONPath(args[1])||(extract&&(!['before','after'].includes(args[2])||typeof args[3]!=='string'||!args[3])))throw Error('FILE_CLI_ARGUMENTS');
   const checked=await reviewWalletBatchComparisonEvidence(await readSavedTextPath(args[1],WALLET_BATCH_COMPARISON_EVIDENCE_LIMIT));
   if(extract){if(!checked.matchesRecomputation){errors.write('FILE_BATCH_COMPARISON_UNVERIFIED\n');return 2;}output.write(extractWalletBatchComparisonEvidenceSource(checked,args[2],args[3]).text);return 0;}
   output.write(encodeWalletBatchComparisonEvidenceReview(checked));return checked.matchesRecomputation?0:2;
  }
  if(Array.isArray(args)&&args[0]==='verify-receipt'){
   if(args.length!==3||!savedJSONPath(args[1])||!savedJSONPath(args[2]))throw Error('FILE_CLI_ARGUMENTS');
   const expected=await reviewWalletSavedBatchEvidence(await readSavedTextPath(args[1],WALLET_SAVED_BATCH_EVIDENCE_LIMIT));
   const checked=await reviewWalletSavedBatchEvidenceReceipt(expected,await readSavedTextPath(args[2],256*1024));
   output.write(encodeWalletSavedBatchEvidenceReceiptCheck(checked));return checked.matchesRecomputation?0:2;
  }
  const extract=Array.isArray(args)&&args.length===3&&args[0]==='extract';
  if(!Array.isArray(args)||!(args.length===1||extract)||!savedJSONPath(args[extract?1:0])||(extract&&(typeof args[2]!=='string'||!args[2])))throw Error('FILE_CLI_ARGUMENTS');
  const review=await reviewWalletSavedBatchEvidence(await readSavedTextPath(args[extract?1:0],WALLET_SAVED_BATCH_EVIDENCE_LIMIT));
  if(extract){if(!review.matchesRecomputation){errors.write('FILE_BATCH_EVIDENCE_UNVERIFIED\n');return 2;}output.write(extractWalletSavedBatchEvidenceSource(review,args[2]).text);return 0;}
  output.write(encodeWalletSavedBatchEvidenceReview(review));return review.matchesRecomputation?0:2;
 }catch(error){errors.write(savedCLIError(error)+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runWalletBatchEvidence(process.argv.slice(2));
