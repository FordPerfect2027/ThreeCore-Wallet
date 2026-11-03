import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inspectProposalSimulationPlanFile} from '../../../src/proposal-simulation-plan.js';
const here=new URL('./',import.meta.url),root=new URL('../../../',here),hash=b=>createHash('sha256').update(b).digest('hex');
for(const name of (await readdir(here)).filter(n=>n.endsWith('-plan.json')))await inspectProposalSimulationPlanFile(await readFile(new URL(name,here),'utf8'));
const files=['src/proposal-simulation-plan.js','scripts/proposal-simulation-plan.js','test/proposal-simulation-plan.test.js','test/helpers/proposal-allowance-fixture.js'],sources=[];
for(const path of files){const bytes=await readFile(new URL(path,root));sources.push({path,bytes:bytes.length,sha256:hash(bytes)});}
await writeFile(new URL('source-inventory.json',here),JSON.stringify({baseCommit:'48d447d',sources},null,2)+'\n');
const lines=[];for(const name of (await readdir(here)).filter(n=>n!=='SHA256SUMS.txt').sort())lines.push(hash(await readFile(new URL(name,here)))+'  '+name);
await writeFile(new URL('SHA256SUMS.txt',here),lines.join('\n')+'\n');console.log(JSON.stringify({savedPlansReplayed:5,sources:sources.length,evidenceFiles:lines.length}));
