import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {reviewRehearsalReportBatch} from '../scripts/rehearsal-report-batch.js';
import {inspectWalletSavedBatch} from '../scripts/wallet-saved-batch.js';
import {encodeRehearsalOverview} from '../src/operation-rehearsal-overview.js';
import {rehearsalExampleV2} from '../src/operation-rehearsal-examples.js';
import {REHEARSAL_WORKSPACE_SCHEMA} from '../src/operation-rehearsal-workspace.js';
import {savedRehearsalGuideFixtures} from './helpers/workspace-fixtures.js';

const large=2n**60n,hash=text=>createHash('sha256').update(text).digest('hex');
for(const [name,review,source,accepted] of [
 ['rehearsal',reviewRehearsalReportBatch,()=>encodeRehearsalOverview({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:'DAT',ledgers:[rehearsalExampleV2()]}),'matched'],
 ['wallet',inspectWalletSavedBatch,()=>savedRehearsalGuideFixtures()[0].text,'validated-structure'],
]) for(const fault of ['distinct','replacement','timestamp']) test(name+' batch retains exact large file identities: '+fault,async t=>{
 const parent=await fs.realpath(tmpdir()),dir=await fs.mkdtemp(join(parent,'threecore-exact-file-id-')),text=source(),manifest=join(dir,'SHA256SUMS.txt');
 const originalStat=fs.lstat.bind(fs),originalOpen=fs.open.bind(fs),paths=['a.json','b.json','alias.json'].map(file=>join(dir,file));let closed=0,readCount=0;
 try{
  await fs.writeFile(paths[0],text);await fs.writeFile(paths[1],text);await fs.link(paths[0],paths[2]);await fs.writeFile(manifest,paths.map(path=>hash(text)+'  '+path.slice(dir.length+1)).join('\n')+'\n');
  assert.equal(Number(large+1n),Number(large+2n));
  const adjusted=(stat,path,options,opened=false)=>{
   const index=paths.indexOf(resolve(path));if(index<0)return stat;
   const id=large+(index===1?2n:1n)+(opened&&fault==='replacement'?1n:0n),changed=opened&&fault==='timestamp';
   return {...stat,isFile:()=>stat.isFile(),ino:options?.bigint?id:Number(id),...(changed&&options?.bigint?{mtimeNs:stat.mtimeNs+1n}:{})};
  };
  const mockStat=t.mock.method(fs,'lstat',async(path,options)=>adjusted(await originalStat(path,options),path,options));
  const mockOpen=t.mock.method(fs,'open',async(path,...args)=>{const handle=await originalOpen(path,...args);if(!paths.includes(resolve(path)))return handle;return{
   stat:async options=>adjusted(await handle.stat(options),path,options,true),
   read:async(...args)=>{readCount++;return handle.read(...args);},
   close:async()=>{closed++;await handle.close();},
  };});syncBuiltinESMExports();
  try{const result=await review(manifest);assert.equal(result.files[2].code,'FILE_ALIAS_DUPLICATE');
   if(fault==='distinct'){assert.deepEqual(result.files.slice(0,2).map(row=>row.status),[accepted,accepted]);assert.equal(result.summary.readBytes,2*Buffer.byteLength(text));assert.equal(closed,2);}
   else{assert.deepEqual(result.files.slice(0,2).map(row=>row.code),['FILE_CHANGED','FILE_CHANGED']);assert.equal(readCount,0);assert.equal(closed,2);}
   assert.equal(await fs.readFile(paths[0],'utf8'),text);
  }finally{mockOpen.mock.restore();mockStat.mock.restore();syncBuiltinESMExports();}
 }finally{assert.equal(dirname(resolve(dir)),parent);assert.equal(await fs.realpath(dir),resolve(dir));await fs.rm(dir,{recursive:true,force:true});}
});
