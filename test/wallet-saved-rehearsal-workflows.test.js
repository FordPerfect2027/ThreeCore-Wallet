import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {savedRehearsalGuideFixtures} from './helpers/workspace-fixtures.js';import {inspectWalletSavedText,inspectWalletSavedTextBatch} from '../src/file-read-status.js';
test('actual local inspect and batch CLI retain practice-only scope and exact source hashes',async()=>{
 const fixtures=savedRehearsalGuideFixtures(),folder=mkdtempSync(join(tmpdir(),'threecore-rehearsal-guides-')),hash=value=>createHash('sha256').update(value).digest('hex');
 const run=(script,args)=>{const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(result.error,undefined);assert.equal(result.status,2,result.stderr);assert.equal(result.stderr,'');return result.stdout;};
 try{
  for(const fixture of fixtures){writeFileSync(join(folder,fixture.name),fixture.text);assert.equal(run('scripts/inspect-wallet-saved-file.js',[join(folder,fixture.name),'--json']),JSON.stringify(await inspectWalletSavedText(fixture.text),null,2)+'\n');}
  writeFileSync(join(folder,'SHA256SUMS.txt'),fixtures.map(row=>hash(row.text)+'  '+row.name).join('\n')+'\n');
  const result=JSON.parse(run('scripts/inspect-wallet-saved-batch.js',[join(folder,'SHA256SUMS.txt')])),shared=await inspectWalletSavedTextBatch(fixtures.map(({name,text})=>({name,text})));
  assert.equal(result.summary.simulationFiles,5);assert.equal(result.summary.structureValidated,5);assert.equal(result.allChecksumsMatch,true);assert.equal(result.allOriginalsValidated,false);assert.deepEqual(result.files.map(row=>row.inspection),shared.files.map(row=>row.inspection));
  const csv=run('scripts/inspect-wallet-saved-batch.js',[join(folder,'SHA256SUMS.txt'),'--format','csv']);assert.match(csv,/"simulationOnly"/);assert.match(csv,/"rehearsalRejectedRecordReferences"/);assert.doesNotMatch(csv,/"null"/);
  for(const fixture of fixtures)assert.equal(readFileSync(join(folder,fixture.name),'utf8'),fixture.text);
 }finally{assert(resolve(folder).startsWith(resolve(tmpdir())+sep));rmSync(folder,{recursive:true,force:true});}
});
