import test from 'node:test';import assert from 'node:assert/strict';
import {mountComparisonPanel} from '../examples/comparison-panel.js';
import {encodePortfolioReport} from '../src/portfolio-report.js';
import {Element} from './helpers/panel-dom.js';import {until} from './helpers/workspace-fixtures.js';
const snapshot={agent:'DAT',chainId:84532,account:'0x'+'11'.repeat(20),siteOrigin:'http://localhost:4231',connectionEpoch:1,blockNumber:'42',blockHash:'0x'+'ab'.repeat(32),nativeBalanceBaseUnits:'12',holdings:[{address:'0x'+'22'.repeat(20),hasCode:true,balanceBaseUnits:'33',notice:null}],readOnly:true,securityAudit:false};
const later={...snapshot,blockNumber:'43',blockHash:'0x'+'cd'.repeat(32),nativeBalanceBaseUnits:'16'};
const text=encodePortfolioReport(snapshot),tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(){const parent=new Element('div'),panel=mountComparisonPanel({document:{createElement:tag=>new Element(tag)},parent}),q=n=>parent.find('comparison-'+n);return{panel,q,choose(file){q('file').files=file?[file]:[];q('file').dispatchEvent(new Event('change'));}};}
test('a saved baseline file stages exact source text and compares only on request',async()=>{
 const f=fixture();try{f.panel.setTarget(later);f.choose(new File([text+'\n'],'baseline.json'));await until(()=>!f.q('file').disabled);assert.equal(f.q('baseline').value,text+'\n');assert.equal(f.q('details').textContent,'');assert.equal(f.q('file').value,'');f.q('run').click();assert.match(f.q('details').textContent,/wei）: \+4/);assert.match(f.q('details').textContent,/42 → 43/);assert.match(f.q('status').textContent,/外部通信は行っていません/);}finally{f.panel.dispose();}
});
test('a baseline loaded first cannot compare until a target is displayed',async()=>{
 const f=fixture();try{f.choose(new File([text],'baseline.json'));await until(()=>!f.q('file').disabled);assert(f.q('run').disabled);f.panel.setTarget(later);assert.equal(f.q('baseline').value,text);f.q('run').click();assert.match(f.q('details').textContent,/42 → 43/);}finally{f.panel.dispose();}
});
test('wrong-identity or newer baseline files cannot silently bypass comparison rules',async()=>{
 const f=fixture();try{f.panel.setTarget(later);for(const [source,expected]of [[{...snapshot,agent:'EMA'},/同じエージェント/],[{...snapshot,blockNumber:'44'},/古いブロック/]]){f.choose(new File([encodePortfolioReport(source)],'other.json'));await until(()=>!f.q('file').disabled);f.q('run').click();assert.equal(f.q('details').textContent,'');assert.match(f.q('status').textContent,expected);}}finally{f.panel.dispose();}
});
test('invalid bytes, malformed and over-limit files preserve prior baseline text',async()=>{
 const f=fixture();let reads=0;try{f.panel.setTarget(later);f.q('baseline').value=text;for(const source of [new File(['{'],'invalid.json'),new File([new Uint8Array([255])],'encoding.json'),{name:'large.json',size:65537,arrayBuffer(){reads++;}}]){f.choose(source);await until(()=>!f.q('file').disabled);assert.equal(f.q('baseline').value,text);assert.match(f.q('status').textContent,/読み込めません/);}assert.equal(reads,0);f.q('run').click();assert.match(f.q('details').textContent,/wei）: \+4/);}finally{f.panel.dispose();}
});
test('cancelling a file selection preserves a completed comparison',()=>{const f=fixture();try{f.panel.setTarget(later);f.q('baseline').value=text;f.q('run').click();const details=f.q('details').textContent,status=f.q('status').textContent;f.choose(null);assert.equal(f.q('details').textContent,details);assert.equal(f.q('status').textContent,status);}finally{f.panel.dispose();}});
test('stop, edit, clear, new target and disposal suppress a delayed baseline',async()=>{
 for(const mode of ['stop','edit','clear','target','clearTarget','dispose']){const f=fixture();let release;const baseline=f.q('baseline'),status=f.q('status');try{f.panel.setTarget(later);baseline.value='original';f.choose({name:'slow.json',size:text.length,arrayBuffer:()=>new Promise(r=>{release=r;})});await until(()=>Boolean(release));assert(f.q('run').disabled);if(mode==='stop')f.q('file-stop').click();else if(mode==='edit'){baseline.value='edited';baseline.dispatchEvent(new Event('input'));}else if(mode==='clear')f.q('clear').click();else if(mode==='target')f.panel.setTarget({...later,blockNumber:'45'});else f.panel[mode]();const expected=baseline.value,message=status.textContent;release(new TextEncoder().encode(text).buffer);await tick();await tick();assert.equal(baseline.value,expected);assert.equal(status.textContent,message);}finally{release?.(new TextEncoder().encode(text).buffer);f.panel.dispose();}}
});
