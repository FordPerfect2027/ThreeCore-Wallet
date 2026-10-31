#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {readBoundedRehearsalText} from './read-bounded-rehearsal-file.js';
import {reviewRehearsalReport,exportReviewedRehearsalPart,REHEARSAL_REPORT_REVIEW_LIMIT} from '../src/operation-rehearsal-report-review.js';
const parts=['workspace-before','workspace-after','scenario-before','scenario-after','scenario-set','check-suite'];
export async function recoverRehearsalReportInputs(args,output=process.stdout,errors=process.stderr){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){
   output.write('Usage: node scripts/recover-rehearsal-report-inputs.js report.json --part '+parts.join('|')+' [--sha256 HEX]\nRecomputes the report before extracting explicitly selected canonical inputs. Comparison sides are never selected automatically.\nPreserves original expected outcomes, including failures; does not recapture or certify them. No live import, network, execution or input writes.\nExit 0: emitted; 2: verification mismatch or part unavailable for this report; 1: invalid input.\n');return 0;
  }
  if(!Array.isArray(args)||![3,5].includes(args.length)||args.some(v=>typeof v!=='string'||!v)||args[0].startsWith('-'))throw Error('CLI_ARGUMENTS');
  let part=null,expectedSha256=null;const seen=new Set();
  for(let i=1;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!['--part','--sha256'].includes(flag)||seen.has(flag))throw Error('CLI_ARGUMENTS');seen.add(flag);
   if(flag==='--part'){if(!parts.includes(value))throw Error('CLI_ARGUMENTS');part=value;}
   else{if(!/^[a-f0-9]{64}$/i.test(value))throw Error('CLI_ARGUMENTS');expectedSha256=value;}
  }
  if(part===null)throw Error('CLI_ARGUMENTS');
  const receipt=await reviewRehearsalReport(await readBoundedRehearsalText(args[0],REHEARSAL_REPORT_REVIEW_LIMIT),{expectedSha256});
  if(!receipt.matchesRecomputation||receipt.checksumMatches===false){errors.write('REVIEW_MISMATCH\n');return 2;}
  output.write(exportReviewedRehearsalPart(receipt,part).text);return 0;
 }catch(error){const code=error?.code??error?.message;errors.write((typeof code==='string'&&/^[A-Z_]+$/.test(code)?code:'REVIEW_INPUT_RECOVERY_FAILED')+'\n');return code==='REVIEW_PART_UNAVAILABLE'?2:1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await recoverRehearsalReportInputs(process.argv.slice(2));
