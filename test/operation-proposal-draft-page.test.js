import test from 'node:test';
import assert from 'node:assert/strict';
import { Element } from './helpers/panel-dom.js';
import { proposalFixture } from './helpers/proposal-fixtures.js';
import { inspectProposalDraftSource,prepareManualOperationProposal } from '../src/operation-proposal-draft.js';
import { inspectOperationProposalReviewFile } from '../src/operation-proposal-file.js';
import { mountProposalDraftPage } from '../examples/operation-proposal-draft-page.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){const end=Date.now()+3000;while(!check()){if(Date.now()>end)throw Error('TIMEOUT');await tick();}}
function setup(f,options={}){
 const elements=new Map(),downloads=[],view=new EventTarget();const document={defaultView:view,createElement:tag=>new Element(tag),getElementById(id){if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
 const get=name=>document.getElementById('draft-'+name);
 for(const [name,value] of Object.entries({agent:f.proposal.agent,id:'manual-ui-test',label:'Manual UI',rationale:'Synthetic manual proposal',origin:f.proposal.dapp.origin,contract:f.proposal.dapp.contract,minutes:'60'}))get(name).value=value;
 const page=mountProposalDraftPage(document,{nowSeconds:()=>f.nowSeconds,...options,download:args=>{if(options.download)return options.download(args,get);downloads.push(args.prepared);}});
 const choose=(text=f.evidenceText,extra={})=>{const bytes=new TextEncoder().encode(text);get('file').files=[{size:bytes.length,arrayBuffer:async()=>bytes.buffer,...extra}];get('file').dispatchEvent(new Event('change'));};
 const edit=(name,value)=>{get(name).value=value;get(name).dispatchEvent(new Event('input'));};
 return{get,choose,edit,page,downloads,view};
}
test('source import does not overwrite limits; explicit fill and build yield a directly replayable manual review',async()=>{
 const f=await proposalFixture(),ui=setup(f);ui.get('max-spend').value='7';ui.choose();await until(()=>!ui.get('fill').disabled);assert.equal(ui.get('max-spend').value,'7');
 ui.get('fill').click();assert.equal(ui.get('max-spend').value,'50');ui.get('generate').click();await until(()=>!ui.get('save').disabled);assert.match(ui.get('outcome').textContent,/一致しました/);
 ui.get('save').click();const saved=await inspectOperationProposalReviewFile(ui.downloads[0].text);assert.equal(saved.files.budgetEvidenceFile,f.evidenceText);assert.equal(saved.recordedResult.proposal.source.kind,'manual');
 ui.get('max-spend').value='1';ui.get('save').click();assert.equal(ui.downloads.length,1);assert.equal(ui.get('result').hidden,true);ui.page.dispose();
});
test('editing a limit shows actual failure and never silently raises it; non-source agent disables creation',async()=>{
 const f=await proposalFixture(),ui=setup(f);ui.choose();await until(()=>!ui.get('fill').disabled);ui.get('fill').click();ui.edit('max-spend','1');ui.get('generate').click();await until(()=>!ui.get('save').disabled);
 assert(ui.get('reasons').children.some(row=>row.textContent.includes('トークン使用額が上限')));assert.equal(ui.get('max-spend').value,'1');
 ui.edit('agent','EMA');assert.equal(ui.get('generate').disabled,true);assert.equal(ui.get('source-preview').hidden,true);ui.page.dispose();
});
test('cancelled source reads and cancelled validation cannot repopulate input context',async()=>{
 const f=await proposalFixture();
 for(const stage of ['read','validate']){
  let release,signal;const options=stage==='validate'?{inspectSource:async(_text,o)=>{signal=o.signal;return new Promise(r=>{release=r;});}}:{};
  const ui=setup(f,options);ui.choose(f.evidenceText,stage==='read'?{arrayBuffer:()=>new Promise(r=>{release=r;})}:{});await until(()=>!!release);ui.get('cancel').click();if(signal)assert.equal(signal.aborted,true);
  release(stage==='read'?new TextEncoder().encode(f.evidenceText).buffer:await inspectProposalDraftSource(f.evidenceText));await tick();assert.equal(ui.get('generate').disabled,true);assert.equal(ui.get('source-preview').hidden,true);ui.page.dispose();
 }
});
test('edits, cancellation, new source, pagehide and disposal invalidate late draft results',async()=>{
 const f=await proposalFixture();
 for(const action of ['edit','cancel','new-source','pagehide','dispose']){
  let release,signal,captured;const ui=setup(f,{prepare:async(data,options)=>{captured=data;signal=options.signal;return new Promise(r=>{release=r;});}});ui.choose();await until(()=>!ui.get('fill').disabled);ui.get('fill').click();ui.get('generate').click();await until(()=>!!release);
  if(action==='edit')ui.edit('minutes','30');else if(action==='cancel')ui.get('cancel').click();else if(action==='new-source')ui.choose();else if(action==='pagehide')ui.view.dispatchEvent(new Event('pagehide'));else ui.page.dispose();
  assert.equal(signal.aborted,true);release(await prepareManualOperationProposal(captured,{nowSeconds:f.nowSeconds}));await tick();assert.equal(ui.get('save').disabled,true);assert.equal(ui.get('result').hidden,true);ui.page.dispose();
 }
});
test('invalid files and fields cannot leave a completed result; failed save preserves it',async()=>{
 const f=await proposalFixture(),ui=setup(f,{download(){throw Error();}});ui.choose();await until(()=>!ui.get('fill').disabled);ui.get('fill').click();ui.get('generate').click();await until(()=>!ui.get('save').disabled);
 ui.get('save').click();assert.match(ui.get('save-status').textContent,/保持/);assert.equal(ui.get('save').disabled,false);
 ui.edit('minutes','0');ui.get('generate').click();await until(()=>!ui.get('generate').disabled);assert.equal(ui.get('result').hidden,true);assert.equal(ui.get('save').disabled,true);
 ui.choose('{');assert.match(ui.get('status').textContent,/資料が変わりました/);await until(()=>ui.get('source-status').textContent.startsWith('原本を照合できません'));assert.equal(ui.get('generate').disabled,true);ui.page.dispose();
});
