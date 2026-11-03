import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,realpath,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,dirname,basename } from 'node:path';
import { runPublicUsdc } from '../scripts/public-usdc.js';
import { usdcFixture } from './helpers/usdc-fixture.js';
import { preparePublicUsdcFile } from '../src/public-usdc-model.js';
async function run(args,options={}){let output='',errors='';const code=await runPublicUsdc(args,{write:s=>{output+=s;}},{write:s=>{errors+=s;}},options);return{code,output,errors};}
test('USDC command binds requested public account and height and propagates cancellation',async()=>{
 let observed;const o=usdcFixture(),r=await run(['read',o.account,'42'],{read:async input=>{observed=input;return o;}});
 assert.equal(r.code,0);assert.equal(observed.account,o.account);assert.equal(observed.blockNumber,'42');assert.equal(JSON.parse(r.output).observation.balanceBaseUnits,'10000000');
 for(const args of [[],['read'],['read',o.account,'42','extra'],['verify'],['verify','--help'],['unknown'],[null]])assert.equal((await run(args)).code,1);
 assert.match((await run(['--help'])).output,/No wallet connection/);
 const c=new AbortController();c.abort();const cancelled=await run(['read',o.account],{signal:c.signal,read:async input=>{assert.equal(input.signal.aborted,true);throw Error('private-marker');}});
 assert.equal(cancelled.code,1);assert.equal(cancelled.output,'');assert.doesNotMatch(cancelled.errors,/private-marker/);
});
test('USDC command verifies saved bytes without modifying them and rejects tampering, encoding and size',async()=>{
 const root=await realpath(tmpdir()),dir=await mkdtemp(join(root,'threecore-usdc-cli-'));
 try{
  const path=join(dir,'usdc.json'),saved=await preparePublicUsdcFile(usdcFixture());await writeFile(path,saved.text);
  const valid=await run(['verify',path]);assert.equal(valid.code,0);assert.equal(JSON.parse(valid.output).checksumVerified,true);assert.equal(await readFile(path,'utf8'),saved.text);
  const tampered=JSON.parse(saved.text);tampered.observation.balanceBaseUnits='1';
  for(const content of [JSON.stringify(tampered),Buffer.from([255]),'{"private-marker":"never-echo"}',' '.repeat(16385)]){
   await writeFile(path,content);const invalid=await run(['verify',path]);assert.equal(invalid.code,1);assert.equal(invalid.output,'');assert.doesNotMatch(invalid.errors,/never-echo/);
  }
 }finally{assert.equal(dirname(resolve(dir)),root);assert(basename(dir).startsWith('threecore-usdc-cli-'));assert.equal(await realpath(dir),resolve(dir));await rm(dir,{recursive:true});}
});
