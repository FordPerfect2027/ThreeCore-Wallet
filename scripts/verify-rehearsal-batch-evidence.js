#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {readBoundedLocalBytes} from './read-bounded-local-file.js';
import {reviewRehearsalBatchEvidence,encodeRehearsalBatchEvidenceReview,REHEARSAL_BATCH_EVIDENCE_LIMIT} from '../src/operation-rehearsal-report-review.js';
import {RehearsalError} from '../src/operation-rehearsal.js';
export async function runRehearsalBatchEvidence(args,output=process.stdout,errors=process.stderr){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){output.write('Usage: node scripts/verify-rehearsal-batch-evidence.js evidence.json\nRecomputes the embedded sources and compares the complete saved batch receipt. Read-only, offline, at most 16 MiB. Does not import records or authenticate origin.\nExit 0 means faithful saved evidence, including faithfully recorded negative source results; inspect allSourceReportsMatch and expectedSummary separately. Exit 2 means altered claims; exit 1 means invalid/incomplete input.\n');return 0;}
  if(!Array.isArray(args)||args.length!==1||typeof args[0]!=='string'||!args[0]||args[0].startsWith('-'))throw new RehearsalError('CLI_ARGUMENTS');
  const bytes=await readBoundedLocalBytes(resolve(args[0]),REHEARSAL_BATCH_EVIDENCE_LIMIT,{fail:code=>{throw new RehearsalError(code);},sizeCode:'FILE_SIZE_LIMIT',changedCode:'FILE_CHANGED'});
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new RehearsalError('INVALID_UTF8');}
  const review=await reviewRehearsalBatchEvidence(text);output.write(encodeRehearsalBatchEvidenceReview(review));return review.matchesRecomputation?0:2;
 }catch(error){errors.write('Rehearsal batch evidence failed: '+(error instanceof RehearsalError?error.code:'FILE_READ_FAILED')+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runRehearsalBatchEvidence(process.argv.slice(2));
