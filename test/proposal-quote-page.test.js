import test from 'node:test';
import assert from 'node:assert/strict';
import { Element } from './helpers/panel-dom.js';
import { proposalQuoteFixture } from './helpers/proposal-quote-fixture.js';
import { prepareProposalQuoteReview,inspectProposalQuoteReviewFile } from '../src/proposal-quote-file.js';
import { mountProposalQuotePage } from '../examples/proposal-quote-page.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){const end=Date.now()+3000;while(!fn()){if(Date.now()>end)throw Error('WAIT_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,1));}}
function setup(options={}){
 const elements=new Map(),downloads=[],view=new EventTarget(),document={defaultView:view,createElement:tag=>new Element(tag),getElementById(id){if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
 const get=name=>document.getElementById('quote-'+name);get('check').disabled=true;get('save').disabled=true;get('result').hidden=true;
 const panel=mountProposalQuotePage(document,{...options,download:request=>{if(options.download)return options.download(request,get);downloads.push(request.prepared);}});
 const choose=(texts,extras=[])=>{get('file').files=texts.map((text,i)=>{const bytes=new TextEncoder().encode(text);return {size:bytes.length,arrayBuffer:async()=>bytes.buffer,...extras[i]};});get('file').dispatchEvent(new Event('change'));};
 for(const [name,value]of [['max-age','60'],['block-age','60'],['shortfall','1.00'],['slippage','0.50']])get(name).value=value;
 return{get,choose,panel,downloads,view};
}
test('page previews units, compares, saves exact inputs and limits, then reopens without assuming current success',async()=>{
 const {files}=await proposalQuoteFixture({nowSeconds:Math.floor(Date.now()/1000)}),ui=setup();ui.choose(Object.values(files));await until(()=>!ui.get('check').disabled);
 assert.match(ui.get('amount').textContent,/50 DAT/);assert.match(ui.get('estimate').textContent,/0\.002492 USDC/);assert.equal(ui.get('result').hidden,true);
 ui.get('check').click();await until(()=>!ui.get('save').disabled);assert.match(ui.get('outcome').textContent,/一致しました/);ui.get('save').click();
 const saved=ui.downloads[0].text,checked=await inspectProposalQuoteReviewFile(saved);assert.deepEqual(checked.files,files);assert.equal(checked.limits.maxSlippageBps,50);
 ui.choose([saved]);await until(()=>!ui.get('check').disabled);assert.match(ui.get('recorded').textContent,/保存時/);assert.equal(ui.get('result').hidden,true);assert.equal(ui.get('save').disabled,true);
 assert.equal(ui.get('slippage').value,'0.50');ui.get('check').click();await until(()=>!ui.get('save').disabled);assert.equal(ui.get('reasons').children.length,0);ui.panel.dispose();
});
test('recorded success is re-evaluated as stale at current time; stricter slippage invalidates the visible result',async()=>{
 const {files,options}=await proposalQuoteFixture({nowSeconds:Math.floor(Date.now()/1000)-1000}),saved=await prepareProposalQuoteReview(files,options),ui=setup();
 ui.choose([saved.text]);await until(()=>!ui.get('check').disabled);ui.get('check').click();await until(()=>!ui.get('save').disabled);
 assert.match(ui.get('outcome').textContent,/期限/);assert(ui.get('reasons').children.some(x=>x.textContent.includes('見積もり取得')));
 ui.get('slippage').value='0.49';ui.get('slippage').dispatchEvent(new Event('input'));assert.equal(ui.get('result').hidden,true);assert.equal(ui.get('save').disabled,true);
 ui.get('check').click();await until(()=>!ui.get('save').disabled);assert(ui.get('reasons').children.some(x=>x.textContent.includes('許容変動')));ui.panel.dispose();
});
for(const action of ['cancel','new-file','limit-change','pagehide','dispose'])test(action+' aborts and discards a delayed comparison',async()=>{
 const {files,options}=await proposalQuoteFixture();let finish,signal;const checked=await prepareProposalQuoteReview(files,options);
 const ui=setup({prepare:async(files,settings)=>{signal=settings.signal;return new Promise(resolve=>{finish=resolve;});}});ui.choose(Object.values(files));await until(()=>!ui.get('check').disabled);ui.get('check').click();await until(()=>!!finish);
 if(action==='cancel')ui.get('cancel').click();if(action==='new-file'){ui.choose(Object.values(files));await until(()=>!ui.get('check').disabled);}if(action==='limit-change')ui.get('max-age').dispatchEvent(new Event('input'));if(action==='pagehide')ui.view.dispatchEvent(new Event('pagehide'));if(action==='dispose')ui.panel.dispose();
 assert.equal(signal.aborted,true);finish(checked);await tick();assert.equal(ui.get('result').hidden,true);assert.equal(ui.get('save').disabled,true);ui.panel.dispose();
});
test('invalid or duplicate files and forged saved verdict clear old results; cancelled file reads cannot restore them',async()=>{
 const {files,options}=await proposalQuoteFixture(),saved=await prepareProposalQuoteReview(files,options),data=JSON.parse(saved.text);data.result.checksSatisfied=false;const ui=setup();
 for(const input of [['{'],[files.quoteFile,files.quoteFile],[JSON.stringify(data)]]){ui.choose(input);await until(()=>ui.get('status').textContent.startsWith('読み込めません'));assert.equal(ui.get('save').disabled,true);assert.equal(ui.get('check').disabled,true);}
 let finish;ui.choose(Object.values(files),[{arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})}]);await until(()=>!!finish);ui.get('cancel').click();finish(new TextEncoder().encode(files.proposalReviewFile).buffer);await tick();assert.equal(ui.get('check').disabled,true);ui.panel.dispose();
});
test('blank, out-of-range, exponent and overprecise conditions never produce a saved result',async()=>{
 const {files}=await proposalQuoteFixture({nowSeconds:Math.floor(Date.now()/1000)}),ui=setup();ui.choose(Object.values(files));await until(()=>!ui.get('check').disabled);
 for(const value of ['', '1e2','1.001','100.00','-0.01']){ui.get('slippage').value=value;ui.get('check').click();await until(()=>!ui.get('check').disabled);assert.equal(ui.get('save').disabled,true);assert.equal(ui.get('result').hidden,true);}
 ui.panel.dispose();
});
test('failed or reentrant download keeps state consistent',async()=>{
 const {files}=await proposalQuoteFixture({nowSeconds:Math.floor(Date.now()/1000)});
 for(const cancel of [true,false]){const ui=setup({download(request,get){if(cancel)get('cancel').click();else throw Error('disk');}});ui.choose(Object.values(files));await until(()=>!ui.get('check').disabled);ui.get('check').click();await until(()=>!ui.get('save').disabled);ui.get('save').click();assert.equal(ui.get('result').hidden,cancel);if(cancel)assert.equal(ui.get('save-status').textContent,'');else assert.match(ui.get('save-status').textContent,/保持/);ui.panel.dispose();}
});
