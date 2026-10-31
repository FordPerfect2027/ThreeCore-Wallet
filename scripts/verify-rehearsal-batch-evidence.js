#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {readBoundedLocalBytes} from './read-bounded-local-file.js';
import {reviewRehearsalBatchEvidence,encodeRehearsalBatchEvidenceReview,extractRehearsalBatchEvidenceSource,REHEARSAL_BATCH_EVIDENCE_LIMIT} from '../src/operation-rehearsal-report-review.js';
import {RehearsalError} from '../src/operation-rehearsal.js';
export async function runRehearsalBatchEvidence(args,output=process.stdout,errors=process.stderr){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){output.write('Usage: node scripts/verify-rehearsal-batch-evidence.js evidence.json\n       node scripts/verify-rehearsal-batch-evidence.js extract evidence.json exact-name.json\nRecomputes the embedded sources and compares the complete saved batch receipt. Read-only, offline, at most 16 MiB. Does not import records or authenticate origin.\nExtract emits only the exact named source to stdout after a faithful review; names are case-sensitive and no destination paths are accepted. Faithful negative source results remain negative.\nExit 0 means faithful saved evidence, including faithfully recorded negative source results; inspect allSourceReportsMatch and expectedSummary separately. Exit 2 means altered claims (no extracted bytes); exit 1 means invalid/incomplete input or missing source name.\n');return 0;}
  const extract=Array.isArray(args)&&args.length===3&&args[0]==='extract',path=Array.isArray(args)?args[extract?1:0]:undefined;
  if(!Array.isArray(args)||!(args.length===1||extract)||typeof path!=='string'||!path||path.startsWith('-')||(extract&&(typeof args[2]!=='string'||!args[2])))throw new RehearsalError('CLI_ARGUMENTS');
  const bytes=await readBoundedLocalBytes(resolve(path),REHEARSAL_BATCH_EVIDENCE_LIMIT,{fail:code=>{throw new RehearsalError(code);},sizeCode:'FILE_SIZE_LIMIT',changedCode:'FILE_CHANGED'});
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new RehearsalError('INVALID_UTF8');}
  const review=await reviewRehearsalBatchEvidence(text);
  if(extract){if(!review.matchesRecomputation){errors.write('REVIEW_BATCH_EVIDENCE_UNVERIFIED\n');return 2;}output.write(extractRehearsalBatchEvidenceSource(review,args[2]).text);return 0;}
  output.write(encodeRehearsalBatchEvidenceReview(review));return review.matchesRecomputation?0:2;
 }catch(error){errors.write('Rehearsal batch evidence failed: '+(error instanceof RehearsalError?error.code:'FILE_READ_FAILED')+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runRehearsalBatchEvidence(process.argv.slice(2));
