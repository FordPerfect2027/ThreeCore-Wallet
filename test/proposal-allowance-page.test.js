import test from 'node:test';
import assert from 'node:assert/strict';
import { Element } from './helpers/panel-dom.js';
import { allowanceFixture } from './helpers/proposal-allowance-fixture.js';
import { prepareProposalAllowanceReview,inspectProposalAllowanceReviewFile } from '../src/proposal-allowance.js';
import { mountProposalAllowancePage } from '../examples/proposal-allowance-page.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){const end=Date.now()+3000;while(!fn()){if(Date.now()>end)throw Error('WAIT_TIMEOUT');await tick();}}
function setup(f,options={}) {
 const elements=new Map(),downloads=[],view=new EventTarget();let calls=0;
 const document={defaultView:view,createElement:tag=>new Element(tag),getElementById(id){if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
 const get=name=>document.getElementById('allow-'+name);get('age').value='60';get('result').hidden=true;
 const page=mountProposalAllowancePage(document,{...options,read:async(...args)=>{calls++;return options.read?options.read(...args):f.observation;},download:r=>{if(options.download)return options.download(r,get);downloads.push(r.prepared);}});
 const choose=(text,extra={})=>{const bytes=new TextEncoder().encode(text);get('file').files=[{size:bytes.length,arrayBuffer:async()=>bytes.buffer,...extra}];get('file').dispatchEvent(new Event('change'));};
 return {get,choose,page,downloads,view,calls:()=>calls};
}
test('screen reads explicitly, displays precise USDC, saves exact source and reopens before current recheck',async()=>{
 const f=await allowanceFixture({buy:true,agent:'EMA',nowSeconds:Math.floor(Date.now()/1000)}),ui=setup(f);ui.choose(f.files.quoteReviewFile);await until(()=>!ui.get('read').disabled);assert.equal(ui.calls(),0);
 ui.get('read').click();await until(()=>!ui.get('save').disabled);assert.match(ui.get('outcome').textContent,/一致/);assert.match(ui.get('amount').textContent,/必要額：1 USDC/);assert.match(ui.get('balance').textContent,/10 USDC/);ui.get('save').click();
 assert.deepEqual((await inspectProposalAllowanceReviewFile(ui.downloads[0].text)).files,f.files);
 ui.choose(ui.downloads[0].text);await until(()=>!ui.get('check').disabled);assert(ui.get('save').disabled);assert(ui.get('result').hidden);assert.match(ui.get('recorded').textContent,/保存時/);
 ui.get('check').click();await until(()=>!ui.get('save').disabled);assert.equal(ui.calls(),1);ui.get('age').value='59';ui.get('save').click();assert(ui.get('save').disabled);assert.equal(ui.downloads.length,1);ui.page.dispose();
});
test('insufficient and expired observations are displayed and saved honestly; invalid input cannot replace them',async()=>{
 const f=await allowanceFixture({nowSeconds:Math.floor(Date.now()/1000)-1000});f.observation.allowanceBaseUnits='0';const ui=setup(f);ui.choose(f.files.quoteReviewFile);await until(()=>!ui.get('read').disabled);ui.get('read').click();await until(()=>!ui.get('save').disabled);
 assert.match(ui.get('outcome').textContent,/不足/);assert(ui.get('reasons').children.some(li=>li.textContent.includes('既存の許可額が不足')));ui.get('save').click();assert.equal((await inspectProposalAllowanceReviewFile(ui.downloads[0].text)).recordedResult.checksSatisfied,false);
 for(const value of ['', '0','1e2','3601','1.1']){ui.get('age').value=value;ui.get('check').click();assert(ui.get('save').disabled);}
 ui.choose('{');await until(()=>ui.get('status').textContent.startsWith('読み込めません'));assert(ui.get('read').disabled);assert(ui.get('check').disabled);ui.page.dispose();
});
test('cancel, replacement, condition edits, leaving, disposal and file-read cancellation discard late work',async()=>{
 const f=await allowanceFixture({nowSeconds:Math.floor(Date.now()/1000)});
 for(const action of ['cancel','new-file','edit','pagehide','dispose','hash']) {
  let release,signal;const adapter=action==='hash'?{prepare:(_f,s)=>{signal=s.signal;return new Promise(r=>{release=r;});}}:{read:(_r,s)=>{signal=s.signal;return new Promise(r=>{release=r;});}};
  const ui=setup(f,adapter);ui.choose(f.files.quoteReviewFile);await until(()=>!ui.get('read').disabled);ui.get('read').click();await until(()=>!!release);
  if(action==='pagehide')ui.view.dispatchEvent(new Event('pagehide'));else if(action==='dispose')ui.page.dispose();else if(action==='new-file')ui.choose(f.files.quoteReviewFile);else if(action==='edit')ui.get('age').dispatchEvent(new Event('input'));else ui.get('cancel').click();
  assert.equal(signal.aborted,true);release(action==='hash'?await prepareProposalAllowanceReview(f.files,f.options):f.observation);await tick();assert(ui.get('save').disabled);assert(ui.get('result').hidden);ui.page.dispose();
 }
 const ui=setup(f);let release;ui.choose(f.files.quoteReviewFile,{arrayBuffer:()=>new Promise(r=>{release=r;})});await until(()=>!!release);ui.get('cancel').click();release(new TextEncoder().encode(f.files.quoteReviewFile).buffer);await tick();assert(ui.get('read').disabled);ui.page.dispose();
});
test('failed/wrong-context reads, download errors and reentrant cancellation preserve consistent controls',async()=>{
 const f=await allowanceFixture({nowSeconds:Math.floor(Date.now()/1000)});let mode='error';const ui=setup(f,{read:async()=>{if(mode==='error')throw Error();return mode==='wrong'?{...f.observation,account:'0x'+'22'.repeat(20)}:f.observation;},download(_r,get){if(mode==='cancel')get('cancel').click();else throw Error();}});
 ui.choose(f.files.quoteReviewFile);await until(()=>!ui.get('read').disabled);
 for(mode of ['error','wrong']){ui.get('read').click();await until(()=>!ui.get('read').disabled);assert(ui.get('save').disabled);}
 mode='ok';ui.get('read').click();await until(()=>!ui.get('save').disabled);ui.get('save').click();assert.match(ui.get('save-status').textContent,/保持/);assert.equal(ui.get('save').disabled,false);
 mode='cancel';ui.get('save').click();assert.equal(ui.get('save-status').textContent,'');assert(ui.get('save').disabled);ui.page.dispose();
});
