import test from 'node:test';
import assert from 'node:assert/strict';
import { Element } from './helpers/panel-dom.js';
import { quoteFixture } from './helpers/aerodrome-quote-fixture.js';
import { inspectAerodromeQuoteFile } from '../src/aerodrome-quote-model.js';
import { mountAerodromeQuotePage } from '../examples/aerodrome-quote-page.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));async function until(fn){const end=Date.now()+3000;while(!fn()){if(Date.now()>end)throw Error('WAIT_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,1));}}
function setup(options={}){const elements=new Map(),downloads=[],view=new EventTarget(),requests=[];
 const document={defaultView:view,createElement:tag=>new Element(tag),getElementById(id){if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}},get=name=>document.getElementById('market-'+name);
 for(const [key,value]of [['agent','DAT'],['direction','sell'],['amount','50'],['slippage','0.50'],['block','42']])get(key).value=value;
 const panel=mountAerodromeQuotePage(document,{...options,read:async(data,settings)=>{requests.push(data);if(options.read)return options.read(data,settings);return {...quoteFixture({agent:data.agent,direction:data.direction,inputBaseUnits:data.inputBaseUnits}),slippageBps:data.slippageBps};},download:request=>{if(options.download)return options.download(request,get);downloads.push(request.prepared);}});
 return {get,panel,downloads,view,requests};
}
test('UI decimal input is exact, buyer unit changes, and saved file reproduces validated amounts',async()=>{
 const ui=setup();ui.get('read').click();await until(()=>!ui.get('save').disabled);assert.equal(ui.requests[0].inputBaseUnits,'50000000000000000000');assert.match(ui.get('output').textContent,/0\.002492 USDC/);ui.get('save').click();assert.equal((await inspectAerodromeQuoteFile(ui.downloads[0].text)).quote.agent,'DAT');
 ui.get('direction').value='buy';ui.get('direction').dispatchEvent(new Event('input'));assert.match(ui.get('unit').textContent,/USDC.*6/);assert.equal(ui.get('result').hidden,true);
 ui.get('amount').value='1.000001';ui.get('read').click();await until(()=>!ui.get('save').disabled);assert.equal(ui.requests[1].inputBaseUnits,'1000001');ui.panel.dispose();
});
test('invalid, overprecise, exponential, zero and oversized values never dispatch',async()=>{
 const ui=setup();for(const value of ['','0','1e18','-1','0.0000000000000000001','9'.repeat(79)]){ui.get('amount').value=value;ui.get('read').click();await tick();assert.equal(ui.requests.length,0);assert.equal(ui.get('save').disabled,true);}
 ui.get('amount').value='1';for(const value of ['100','0.001','1e2','']){ui.get('slippage').value=value;ui.get('read').click();await tick();assert.equal(ui.requests.length,0);}ui.panel.dispose();
});
for(const action of ['cancel','input','pagehide','dispose'])test(action+' cancels outstanding requests and discards their eventual result',async()=>{
 let finish,signal;const ui=setup({read:(data,settings)=>{signal=settings.signal;return new Promise(resolve=>{finish=resolve;});}});ui.get('read').click();await until(()=>!!finish);
 if(action==='cancel')ui.get('cancel').click();if(action==='input')ui.get('amount').dispatchEvent(new Event('input'));if(action==='pagehide')ui.view.dispatchEvent(new Event('pagehide'));if(action==='dispose')ui.panel.dispose();assert.equal(signal.aborted,true);finish(quoteFixture());await tick();assert.equal(ui.get('save').disabled,true);assert.equal(ui.get('result').hidden,true);ui.panel.dispose();
});
test('changed source context, RPC failure and arithmetic mismatch never expose a usable result',async()=>{
 for(const read of [async()=>({...quoteFixture(),agent:'EMA'}),async()=>{throw Error('upstream');},async()=>({...quoteFixture(),routerOutputBaseUnits:'1'})]){const ui=setup({read});ui.get('read').click();await until(()=>!ui.get('read').disabled);assert.equal(ui.get('result').hidden,true);assert.equal(ui.get('save').disabled,true);assert.match(ui.get('status').textContent,/取得できません/);ui.panel.dispose();}
});
test('failed download preserves output while reentrant cancellation never reports success',async()=>{
 for(const cancel of [false,true]){const ui=setup({download(request,get){if(cancel)get('amount').dispatchEvent(new Event('input'));else throw Error('disk');}});ui.get('read').click();await until(()=>!ui.get('save').disabled);ui.get('save').click();assert.equal(ui.get('result').hidden,cancel);if(cancel)assert.equal(ui.get('save-status').textContent,'');else assert.match(ui.get('save-status').textContent,/保持/);ui.panel.dispose();}
});
