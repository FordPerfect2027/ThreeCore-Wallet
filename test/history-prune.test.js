import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareHistoryPrune } from '../src/history-query.js';
import { mountHistoryPanel } from '../examples/history-panel.js';
import { mountHistoryFiles } from '../examples/history-files.js';
import { Element } from './helpers/panel-dom.js';
import { observation, archive, OTHER, TOKEN } from './helpers/history-fixtures.js';
const rows=[observation('30'),observation('10'),observation('20'),observation('10',{account:OTHER}),observation('10',{siteOrigin:'https://other.example'})],text=archive(rows),criteria={account:rows[0].account,siteOrigin:rows[0].siteOrigin,maximumBlock:'20',order:'newest'};
function fixture(){const parent=new Element('div'),saved=[],panel=mountHistoryPanel({document:{createElement:tag=>new Element(tag)},parent,agent:'DAT',getSnapshot:()=>null,getReport:()=>'',download:({prepared})=>saved.push(prepared)}),q=name=>parent.find('history-'+name);panel.replaceArchive(text);const search=()=>{q('filter-account').value=criteria.account;q('filter-origin').value=criteria.siteOrigin;q('filter-maximum').value='20';q('filter-order').value='newest';q('filter-run').click();};return{panel,q,saved,search};}
test('scoped pruning retains the exact complement in original order and cannot confuse sorted row numbers',()=>{
 const result=prepareHistoryPrune(text,criteria);assert.deepEqual(result.removedIndices,[2,1]);assert.equal(result.text,archive([rows[0],rows[3],rows[4]]));assert.equal(result.previousCount,5);assert.equal(result.removedCount,2);assert.equal(result.remainingCount,3);assert.equal(result.canAuthorizeTransaction,false);assert(Object.isFrozen(result)&&Object.isFrozen(result.query)&&Object.isFrozen(result.removedIndices));assert.equal(text,archive(rows));
});
test('unscoped, empty, full-history and malformed removal conditions are rejected without assuming display order is a scope',()=>{
 for(const query of[{}, {order:'newest'}, {maximumBlock:'30'}, {minimumBlock:'999'}, {tokenAddress:'bad'}, {siteOrigin:'https://other.example/path'}])assert.throws(()=>prepareHistoryPrune(text,query));let reads=0;assert.throws(()=>prepareHistoryPrune(text,Object.defineProperty({},'account',{get(){reads++;return criteria.account;}})));assert.equal(reads,0);
});
test('token absence and unknown balance pruning use explicit states, never coerce unknown values to zero',()=>{
 const records=archive([observation('1',{holdings:[{address:TOKEN,hasCode:false,balanceBaseUnits:null,notice:'TOKEN_CODE_MISSING'}]}),observation('2',{holdings:[{address:TOKEN,hasCode:true,balanceBaseUnits:'0',notice:null}]}),observation('3',{holdings:[{address:OTHER,hasCode:true,balanceBaseUnits:'5',notice:null}]})]);assert.deepEqual(prepareHistoryPrune(records,{tokenAddress:TOKEN,tokenStatus:'unknown'}).removedIndices,[0]);assert.deepEqual(prepareHistoryPrune(records,{tokenAddress:TOKEN,tokenStatus:'not-observed'}).removedIndices,[2]);
});
test('preview plus explicit confirmation removes only the reviewed scope and exact full recovery remains downloadable and restorable',()=>{
 const f=fixture();try{f.search();f.q('prune-preview').click();assert.equal(f.panel.exportArchive(),text);assert(f.q('prune-details').textContent.includes('元の位置2:'));assert(f.q('prune-details').textContent.includes(criteria.siteOrigin));assert(f.q('prune-apply').disabled);f.q('prune-confirm').checked=true;f.q('prune-confirm').dispatchEvent(new Event('change'));f.q('prune-apply').click();assert.equal(f.panel.exportArchive(),prepareHistoryPrune(text,criteria).text);assert(f.q('prune-apply').disabled);f.q('recovery-save').click();assert.equal(f.saved[0].text,text);f.q('recovery-preview').click();f.q('recovery-apply').click();assert.equal(f.panel.exportArchive(),text);}finally{f.panel.dispose();}
});
test('changed criteria, new history, cancelled confirmation, unrelated actions and lifecycle changes retire the removal proposal',()=>{
 for(const mutation of['silent-filter','filter-event','history','checkbox','reset','invalidate','dispose']){const f=fixture();try{f.search();f.q('prune-preview').click();f.q('prune-confirm').checked=true;f.q('prune-confirm').dispatchEvent(new Event('change'));const apply=f.q('prune-apply'),status=f.q('status');let expected=text;
 if(mutation==='silent-filter')f.q('filter-maximum').value='10';
 if(mutation==='filter-event')f.q('filter-maximum').dispatchEvent(new Event('input'));
 if(mutation==='history'){expected=archive([rows[0],rows[1]]);f.panel.replaceArchive(expected);}
 if(mutation==='checkbox')f.q('prune-confirm').checked=false;
 if(mutation==='reset')f.q('filter-reset').click();
 if(mutation==='invalidate'||mutation==='dispose')f.panel[mutation]();
 apply.click();if(mutation!=='dispose')assert.equal(f.panel.exportArchive(),expected,mutation);assert(!status.textContent.includes('2件を削除しました'),mutation);
 }finally{f.panel.dispose();}}
});
test('prune handoff is single-use and cannot claim success from rejected or asynchronous callbacks',()=>{
 for(const callback of[()=>false,()=>Promise.resolve(true),()=>{throw Error('no');}]){let calls=0;const parent=new Element('div'),panel=mountHistoryFiles({document:{createElement:tag=>new Element(tag)},parent,agent:'DAT',getArchive:()=>text,getRevision:()=>0,onImportText:()=>{},onPrune:()=>{calls++;return callback();}}),q=name=>parent.find('history-'+name);try{q('filter-maximum').value='20';q('filter-run').click();q('prune-preview').click();q('prune-confirm').checked=true;q('prune-confirm').dispatchEvent(new Event('change'));q('prune-apply').click();assert.equal(calls,1);assert(q('prune-apply').disabled);assert(!q('file-status').textContent.includes('削除を確認しました'));q('prune-apply').click();assert.equal(calls,1);}finally{panel.dispose();}}
});
