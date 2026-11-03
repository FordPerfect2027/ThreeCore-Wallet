#!/usr/bin/env node
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readBoundedLocalBytes} from './read-bounded-local-file.js';
import {withDiagnosticInterrupt} from './public-diagnostic-interrupt.js';
import {PROPOSAL_ALLOWANCE_FILE_LIMIT} from '../src/proposal-allowance.js';
import {SIMULATION_PLAN_FILE_LIMIT,SimulationPlanError,prepareProposalSimulationPlan,inspectProposalSimulationPlanFile} from '../src/proposal-simulation-plan.js';
const fail=code=>{throw new SimulationPlanError(code);};
const usage='Usage:\n  node scripts/proposal-simulation-plan.js prepare ALLOWANCE_REVIEW_FILE\n  node scripts/proposal-simulation-plan.js verify SIMULATION_PLAN_FILE\nOffline unsigned simulation inputs only. No wallet, signing or transaction dispatch.\n';
export async function runSimulationPlan(args,output=process.stdout,errors=process.stderr,{signal}={}){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){output.write(usage);return 0;}
  if(!Array.isArray(args)||args.length!==2||!['prepare','verify'].includes(args[0])||typeof args[1]!=='string'||!args[1]||args[1].startsWith('--'))fail('CLI_ARGUMENTS');
  const bytes=await readBoundedLocalBytes(resolve(args[1]),args[0]==='prepare'?PROPOSAL_ALLOWANCE_FILE_LIMIT:SIMULATION_PLAN_FILE_LIMIT,{fail,sizeCode:'FILE_TOO_LARGE',changedCode:'FILE_CHANGED'});
  let text;try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{fail('INVALID_UTF8');}
  if(args[0]==='prepare'){const result=await prepareProposalSimulationPlan(text,{signal});output.write(result.text);return result.plan.eligibleForSimulation?0:2;}
  const checked=await inspectProposalSimulationPlanFile(text,{signal});output.write(JSON.stringify(checked,null,2)+'\n');return 0;
 }catch(error){errors.write('Simulation plan failed: '+(error instanceof SimulationPlanError?error.code:'SOURCE_VALIDATION_FAILED')+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await withDiagnosticInterrupt(signal=>runSimulationPlan(process.argv.slice(2),process.stdout,process.stderr,{signal}));
