#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {readBoundedLocalBytes} from './read-bounded-local-file.js';
import {reviewRehearsalBatchEvidence,encodeRehearsalBatchEvidenceReview,extractRehearsalBatchEvidenceSource,REHEARSAL_BATCH_EVIDENCE_LIMIT} from '../src/operation-rehearsal-report-review.js';
import {RehearsalError} from '../src/operation-rehearsal.js';
import {reviewRehearsalBatchEvidenceReceipt,encodeRehearsalBatchEvidenceReceiptCheck} from '../src/operation-rehearsal-report-review.js';
import {reviewRehearsalBatchComparisonEvidence,encodeRehearsalBatchComparisonEvidenceReview,REHEARSAL_BATCH_COMPARISON_EVIDENCE_LIMIT} from '../src/operation-rehearsal-report-review.js';
import {extractRehearsalBatchComparisonEvidenceSource} from '../src/operation-rehearsal-report-review.js';
import {queryRehearsalBatchComparisonDifferences,encodeRehearsalBatchComparisonDifferences} from '../src/operation-rehearsal-report-review.js';
async function readText(path,limit){
 const bytes=await readBoundedLocalBytes(resolve(path),limit,{fail:code=>{throw new RehearsalError(code);},sizeCode:'FILE_SIZE_LIMIT',changedCode:'FILE_CHANGED'});
 try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new RehearsalError('INVALID_UTF8');}
}
export async function runRehearsalBatchEvidence(args,output=process.stdout,errors=process.stderr){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){output.write('Usage: node scripts/verify-rehearsal-batch-evidence.js evidence.json\n       node scripts/verify-rehearsal-batch-evidence.js extract evidence.json exact-name.json\n       node scripts/verify-rehearsal-batch-evidence.js verify-receipt evidence.json receipt.json\n       node scripts/verify-rehearsal-batch-evidence.js comparison comparison-evidence.json\n       node scripts/verify-rehearsal-batch-evidence.js extract-comparison comparison-evidence.json before|after exact-name.json\n       node scripts/verify-rehearsal-batch-evidence.js differences comparison-evidence.json same-name.json [--path text] [--offset 0|40|80|...]\nLocation pages compare embedded JSON values by position (2 MiB each), emit paths and hashes only, and do not validate the originals. A zero filtered count is not global equality.\nExact-role extraction requires a faithful comparison review and emits only the original bytes to stdout; current selections and files are unchanged.\nComparison mode recomputes both embedded source batches and their comparison; 32 MiB maximum, no imports.\nRecomputes the embedded sources and compares the complete saved batch receipt. Read-only, offline, at most 16 MiB. Does not import records or authenticate origin.\nExtract emits only the exact named source to stdout after a faithful review; names are case-sensitive and no destination paths are accepted. Faithful negative source results remain negative.\nReceipt mode compares every field and the bundle hash; a faithful negative receipt can pass without making its source evidence valid.\nExit 0 means faithful saved evidence, including faithfully recorded negative source results; inspect allSourceReportsMatch and expectedSummary separately. Exit 2 means altered claims (no extracted bytes); exit 1 means invalid/incomplete input or missing source name.\n');return 0;}
  if(Array.isArray(args)&&args[0]==='differences'){
   if(args.length<3||args.length>7||args.length%2!==1||typeof args[1]!=='string'||!args[1]||args[1].startsWith('-')||typeof args[2]!=='string'||!args[2])throw new RehearsalError('CLI_ARGUMENTS');
   const options={},seen=new Set();for(let i=3;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!['--offset','--path'].includes(flag)||seen.has(flag)||typeof value!=='string')throw new RehearsalError('CLI_ARGUMENTS');seen.add(flag);if(flag==='--offset'){if(!/^(0|[1-9][0-9]{0,6})$/.test(value))throw new RehearsalError('CLI_ARGUMENTS');options.offset=Number(value);}else options.pathIncludes=value;}
   const checked=await reviewRehearsalBatchComparisonEvidence(await readText(args[1],REHEARSAL_BATCH_COMPARISON_EVIDENCE_LIMIT));if(!checked.matchesRecomputation){errors.write('REVIEW_BATCH_COMPARISON_UNVERIFIED\n');return 2;}
   output.write(encodeRehearsalBatchComparisonDifferences(queryRehearsalBatchComparisonDifferences(checked,args[2],options)));return 0;
  }
  if(Array.isArray(args)&&args[0]==='extract-comparison'){
   if(args.length!==4||typeof args[1]!=='string'||!args[1]||args[1].startsWith('-')||!['before','after'].includes(args[2])||typeof args[3]!=='string'||!args[3])throw new RehearsalError('CLI_ARGUMENTS');
   const checked=await reviewRehearsalBatchComparisonEvidence(await readText(args[1],REHEARSAL_BATCH_COMPARISON_EVIDENCE_LIMIT));
   if(!checked.matchesRecomputation){errors.write('REVIEW_BATCH_COMPARISON_UNVERIFIED\n');return 2;}
   output.write(extractRehearsalBatchComparisonEvidenceSource(checked,args[2],args[3]).text);return 0;
  }
  if(Array.isArray(args)&&args[0]==='comparison'){
   if(args.length!==2||typeof args[1]!=='string'||!args[1]||args[1].startsWith('-'))throw new RehearsalError('CLI_ARGUMENTS');
   const result=await reviewRehearsalBatchComparisonEvidence(await readText(args[1],REHEARSAL_BATCH_COMPARISON_EVIDENCE_LIMIT));
   output.write(encodeRehearsalBatchComparisonEvidenceReview(result));return result.matchesRecomputation?0:2;
  }
  if(Array.isArray(args)&&args[0]==='verify-receipt'){
   if(args.length!==3||args.slice(1).some(path=>typeof path!=='string'||!path||path.startsWith('-')))throw new RehearsalError('CLI_ARGUMENTS');
   const expected=await reviewRehearsalBatchEvidence(await readText(args[1],REHEARSAL_BATCH_EVIDENCE_LIMIT));
   const checked=await reviewRehearsalBatchEvidenceReceipt(expected,await readText(args[2],256*1024));
   output.write(encodeRehearsalBatchEvidenceReceiptCheck(checked));return checked.matchesRecomputation?0:2;
  }
  const extract=Array.isArray(args)&&args.length===3&&args[0]==='extract',path=Array.isArray(args)?args[extract?1:0]:undefined;
  if(!Array.isArray(args)||!(args.length===1||extract)||typeof path!=='string'||!path||path.startsWith('-')||(extract&&(typeof args[2]!=='string'||!args[2])))throw new RehearsalError('CLI_ARGUMENTS');
  const text=await readText(path,REHEARSAL_BATCH_EVIDENCE_LIMIT);
  const review=await reviewRehearsalBatchEvidence(text);
  if(extract){if(!review.matchesRecomputation){errors.write('REVIEW_BATCH_EVIDENCE_UNVERIFIED\n');return 2;}output.write(extractRehearsalBatchEvidenceSource(review,args[2]).text);return 0;}
  output.write(encodeRehearsalBatchEvidenceReview(review));return review.matchesRecomputation?0:2;
 }catch(error){errors.write('Rehearsal batch evidence failed: '+(error instanceof RehearsalError?error.code:'FILE_READ_FAILED')+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runRehearsalBatchEvidence(process.argv.slice(2));
