#!/usr/bin/env node
import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
import {readBoundedRehearsalText} from './read-bounded-rehearsal-file.js';
import {decodeRehearsalWorkspace,REHEARSAL_WORKSPACE_LIMIT} from '../src/operation-rehearsal-workspace.js';
import {encodeRehearsalRecordPrefix,extractRehearsalRecordPrefix} from '../src/operation-rehearsal-records.js';
export async function inspectRehearsalPrefix(args,output=process.stdout,errors=process.stderr){
 try{
  if(Array.isArray(args)&&args.length===1&&args[0]==='--help'){output.write('Usage: node scripts/inspect-rehearsal-prefix.js workspace.json AGENT:record-id [--format report|input]\nRetains every preceding record of the stored agent and the selected record, including rejections. Later records and other agents are excluded from the extracted input.\nDefault report includes the full original workspace for independent recomputation; input emits only the selected prefix. No live restoration or input writes.\n');return 0;}
  if(!Array.isArray(args)||![2,4].includes(args.length)||args.some(v=>typeof v!=='string'||!v)||args[0].startsWith('-')||!args[1].includes(':')||(args.length===4&&(args[2]!=='--format'||!['report','input'].includes(args[3]))))throw Error('CLI_ARGUMENTS');
  const input=decodeRehearsalWorkspace(await readBoundedRehearsalText(args[0],REHEARSAL_WORKSPACE_LIMIT));
  output.write((args[3]==='input'?extractRehearsalRecordPrefix:encodeRehearsalRecordPrefix)(input,args[1]));return 0;
 }catch(error){const code=error?.code??error?.message;errors.write((typeof code==='string'&&/^[A-Z_]+$/.test(code)?code:'PREFIX_INSPECTION_FAILED')+'\n');return 1;}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await inspectRehearsalPrefix(process.argv.slice(2));
