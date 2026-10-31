#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {reviewRehearsalReportBatch,encodeRehearsalBatchReview,rehearsalBatchErrorCode,RehearsalBatchError} from './rehearsal-report-batch.js';
export async function runRehearsalBatchReview(args,output=process.stdout,errors=process.stderr){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){output.write('Usage: node scripts/verify-rehearsal-report-batch.js SHA256SUMS.txt [--format json|csv]\nChecks up to 50 explicitly listed JSON rehearsal reports beneath the real manifest directory. Per report: 2 MiB; total: 32 MiB. Paths and SHA-256 rows use the standard evidence-manifest syntax.\nChecks exact bytes and independently recomputes each report, retaining per-file failures. No network, writes, restoration or automatic repair. CSV is a viewing summary.\nAgreement does not authenticate origin or certify expected outcomes; faithful reports with failed expectations remain explicitly counted.\nExit 0: every checksum and recomputation agrees; 2: per-file failure; 1: invalid/changing manifest or arguments.\n');return 0;}
  if(!Array.isArray(args)||![1,3].includes(args.length)||args.some(v=>typeof v!=='string'||!v)||args[0].startsWith('-')||(args.length===3&&(args[1]!=='--format'||!['json','csv'].includes(args[2]))))throw new RehearsalBatchError('CLI_ARGUMENTS');
  const result=await reviewRehearsalReportBatch(args[0]);output.write(encodeRehearsalBatchReview(result,args[2]??'json'));return result.allChecksumsAndRecomputationsMatch?0:2;
 }catch(error){errors.write('Rehearsal batch review failed: '+rehearsalBatchErrorCode(error)+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runRehearsalBatchReview(process.argv.slice(2));
