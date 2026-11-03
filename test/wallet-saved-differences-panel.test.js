import test from 'node:test';import assert from 'node:assert/strict';
import {Element} from './helpers/panel-dom.js';
import {savedWorkspaceGuideFixtures,gate,until} from './helpers/workspace-fixtures.js';
import {inspectWalletSavedText,compareWalletSavedTextInspections} from '../src/file-read-status.js';
import {mountSavedFileDifferencePanel,mountSavedFileInspectionPanel} from '../examples/file-read-panel.js';
const original=(await savedWorkspaceGuideFixtures())[3].text,changed=JSON.parse(original);changed.entries[0].account='0x'+'a'.repeat(40);const after=JSON.stringify(changed),comparison=compareWalletSavedTextInspections(await inspectWalletSavedText(original),await inspectWalletSavedText(after));
function fixture(options={}){let pair={comparison,beforeFile:new File([original],'before.json'),afterFile:new File([after],'after.json')};const parent=new Element('div'),document={createElement:tag=>new Element(tag)},downloads=[],panel=mountSavedFileDifferencePanel({parent,document,getPair:()=>pair,download:value=>downloads.push(value),...options});return {panel,downloads,q:name=>parent.find('saved-differences-'+name),setPair(value){pair=value;panel.updatePair();}};}
test('explicit field inspection re-reads both captured files and exports only after acknowledgement',async()=>{
 const reads=[],f=fixture({readText(file,options){reads.push([file.name,options.maxBytes]);return file.text();}});try{assert.equal(reads.length,0);assert(f.q('save').disabled);assert(await f.panel.inspectPair());assert.deepEqual(reads,[['before.json',2097152],['after.json',2097152]]);assert.match(f.q('output').textContent,/entries\/0\/account/);assert.doesNotMatch(f.q('output').textContent,/0x[a-f0-9]{40}/);f.q('save').click();assert.equal(f.downloads.length,0);f.q('ack').checked=true;f.q('ack').dispatchEvent(new Event('change'));f.q('save').click();assert.equal(f.downloads.length,1);assert.equal(JSON.parse(f.downloads[0].text).differenceCount,1);assert(f.q('save').disabled);f.setPair(null);assert.equal(f.panel.getState().result,null);assert.equal(f.q('output').textContent,'');}finally{f.panel.dispose();}
});
test('a changed source on re-read cannot replace the previously selected comparison',async()=>{
 const f=fixture({readText:()=>Promise.resolve(original)});try{assert.equal(await f.panel.inspectPair(),false);assert.equal(f.panel.getState().result,null);assert.match(f.q('status').textContent,/内容が変わっています/);assert(f.q('save').disabled);}finally{f.panel.dispose();}
});
for(const action of ['stop','pair','dispose'])test('pending inspection cannot publish after '+action,async()=>{
 const blocked=gate();let reads=0;const f=fixture({readText(){reads++;return blocked.promise;}}),work=f.panel.inspectPair();await until(()=>reads===1);const button=f.q('start');if(action==='stop')f.q('stop').click();else if(action==='pair')f.setPair(null);else f.panel.dispose();blocked.resolve(original);assert.equal(await work,false);assert.equal(f.panel.getState().result,null);assert.equal(reads,1);f.panel.dispose();button.click();assert.equal(reads,1);
});
test('the parent saved-file guide wires the exact pair and clears differences on replacement',async()=>{
 const parent=new Element('div'),document={createElement:tag=>new Element(tag)},panel=mountSavedFileInspectionPanel({document,parent}),q=name=>parent.find('saved-differences-'+name);try{await panel.inspectFile(new File([original],'before.json'));assert(q('start').disabled);await panel.compareFile(new File([after],'after.json'));q('start').click();await until(()=>q('output').textContent.includes('/entries/0/account'));await panel.inspectFile(new File([original],'new.json'));assert.equal(q('output').textContent,'');assert(q('start').disabled);}finally{panel.dispose();}
});
