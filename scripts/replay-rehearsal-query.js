#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';import {readBoundedRehearsalText} from './read-bounded-rehearsal-file.js';
import {decodeRehearsalWorkspace,REHEARSAL_WORKSPACE_LIMIT} from '../src/operation-rehearsal-workspace.js';
import {reviewRehearsalReport,extractReviewedRehearsalQuery,REHEARSAL_REPORT_REVIEW_LIMIT} from '../src/operation-rehearsal-report-review.js';
import {encodeRehearsalReasonRecordReport,rehearsalReasonRecordCsv,encodeRehearsalRecordSummary,rehearsalRecordSummaryCsv} from '../src/operation-rehearsal-records.js';
export async function replayRehearsalQuery(args,output=process.stdout,errors=process.stderr){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){output.write('Usage: node scripts/replay-rehearsal-query.js verified-query-report.json current-workspace.json [--sha256 HEX] [--format json|csv] [--view records|summary]\nRecomputes the saved query/summary report, then reuses ONLY its search criteria against the explicitly supplied current workspace. The report\'s older history is never restored.\nDefault output: V3 record report with current inputs. Summary groups matched contributions by stored agent; CSV is for viewing. No network or input writes.\nExit 0: emitted; 2: mismatch or unsupported query source; 1: invalid input.\n');return 0;}
  if(!Array.isArray(args)||![2,4,6,8].includes(args.length)||args.some(v=>typeof v!=='string'||!v)||args.slice(0,2).some(v=>v.startsWith('-')))throw Error('CLI_ARGUMENTS');
  let expectedSha256=null,format='json',view='records';const seen=new Set();
  for(let i=2;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!['--sha256','--format','--view'].includes(flag)||seen.has(flag))throw Error('CLI_ARGUMENTS');seen.add(flag);
   if(flag==='--sha256'){if(!/^[a-f0-9]{64}$/i.test(value))throw Error('CLI_ARGUMENTS');expectedSha256=value;}
   else if(flag==='--format'){if(!['json','csv'].includes(value))throw Error('CLI_ARGUMENTS');format=value;}
   else{if(!['records','summary'].includes(value))throw Error('CLI_ARGUMENTS');view=value;}
  }
  const receipt=await reviewRehearsalReport(await readBoundedRehearsalText(args[0],REHEARSAL_REPORT_REVIEW_LIMIT),{expectedSha256});
  if(!receipt.matchesRecomputation||receipt.checksumMatches===false){errors.write('REVIEW_MISMATCH\n');return 2;}
  const query=extractReviewedRehearsalQuery(receipt),input=decodeRehearsalWorkspace(await readBoundedRehearsalText(args[1],REHEARSAL_WORKSPACE_LIMIT));
  const encode=view==='summary'?(format==='csv'?rehearsalRecordSummaryCsv:encodeRehearsalRecordSummary):(format==='csv'?rehearsalReasonRecordCsv:encodeRehearsalReasonRecordReport);
  output.write(encode(input,query));return 0;
 }catch(error){const code=error?.code??error?.message;errors.write((typeof code==='string'&&/^[A-Z_]+$/.test(code)?code:'QUERY_REPLAY_FAILED')+'\n');return code==='REVIEW_QUERY_UNAVAILABLE'?2:1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await replayRehearsalQuery(process.argv.slice(2));
