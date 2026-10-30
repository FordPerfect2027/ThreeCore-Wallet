import test from 'node:test';
import assert from 'node:assert/strict';
import { mountHistoryRecovery } from '../examples/history-recovery-panel.js';
import { createPortfolioHistory } from '../src/portfolio-history.js';
import { createHistoryRecovery } from '../src/history-recovery.js';
import { Element } from './helpers/panel-dom.js';
import { observation } from './helpers/history-fixtures.js';
class TestElement extends Element {
  handlers=new Map();addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(){return this.handlers.get('click')?.(new Event('click'));}
}
function fixture(options={},adapt=value=>value){
  const parent=new TestElement('div'),downloads=[],copies=[],history=createPortfolioHistory();
  history.merge([observation('1'),observation('2')]);const recovery=createHistoryRecovery(history);
  const panel=mountHistoryRecovery({document:{createElement:tag=>new TestElement(tag)},parent,agent:'DAT',recovery:adapt(recovery),
    onRestore(){},onCopyArchive:text=>{copies.push(text);},download:({prepared})=>{downloads.push(prepared);},...options});
  const q=name=>parent.find('history-recovery-'+name);return {parent,panel,q,history,recovery,downloads,copies,run:name=>q(name).run(),
    remove(){recovery.remove(0,history.state().revision);panel.refresh();}};
}
for(const [button,callback]of [['save','download'],['copy','onCopyArchive']])for(const receipt of ['false','resolved','rejected'])test(`recovery ${callback} ${receipt} receipt is refused`,async()=>{
  const f=fixture({[callback]:()=>receipt==='false'?false:receipt==='resolved'?Promise.resolve(true):Promise.reject(Error('synthetic refusal'))});
  try{f.remove();f.run(button);await new Promise(resolve=>setTimeout(resolve,0));assert.doesNotMatch(f.q('status').textContent,/ダウンロードを開始|入力欄へ出しました/);assert.equal(f.history.state().size,1);}
  finally{f.panel.dispose();}
});
for(const receipt of ['throw','rejected'])test(`recovery successful apply survives ${receipt} observer failure`,async()=>{
  const f=fixture({onRestore(){if(receipt==='throw')throw Error('synthetic observer');return Promise.reject(Error('synthetic observer'));}});
  try{f.remove();f.run('preview');f.run('apply');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.history.state().size,2);
    assert.match(f.q('status').textContent,/履歴へ戻しました/);assert.doesNotMatch(f.q('status').textContent,/上書きしていません/);}
  finally{f.panel.dispose();}
});
for(const [button,callback]of [['save','download'],['copy','onCopyArchive'],['apply','onRestore']])for(const ending of ['invalidate','dispose'])test(`recovery ${callback} ${ending} cannot overwrite the newer display`,()=>{
  let f,node,before;f=fixture({[callback](){node=f.q('status');f.panel[ending]();before=node.textContent;}});
  try{f.remove();if(button==='apply')f.run('preview');f.run(button);assert.equal(node.textContent,before);}finally{f.panel.dispose();}
});
for(const [button,method]of [['preview','preview'],['report','report'],['save','exportText'],['copy','state']])for(const ending of ['invalidate','dispose'])test(`recovery ${method} ${ending} prevents late UI or handoff`,()=>{
  let f,armed=false,node,before;
  f=fixture({},base=>({...base,[method](...args){const value=base[method](...args);if(armed){armed=false;node=f.q('status');f.panel[ending]();before=node.textContent;}return value;}}));
  const apply=f.q('apply'),details=f.q('details');
  try{f.remove();armed=true;f.run(button);assert.equal(node.textContent,before);assert.equal(apply.disabled,true);assert.equal(details.textContent,'');assert.equal(f.downloads.length,0);assert.equal(f.copies.length,0);}
  finally{f.panel.dispose();}
});
test('recovery refresh bounds reentrant cleanup callbacks',()=>{
  let f,armed=false,calls=0;
  f=fixture({},base=>({...base,cancelPreview(){base.cancelPreview();if(armed){calls++;if(calls>20)throw Error('unbounded refresh');f.panel.refresh();}}}));
  try{armed=true;assert.doesNotThrow(()=>f.panel.refresh());assert.equal(calls,1);}finally{armed=false;f.panel.dispose();}
});
test('recovery disposal survives cleanup failure and detaches the panel',()=>{
  let armed=false;const f=fixture({},base=>({...base,cancelPreview(){if(armed)throw Error('synthetic cleanup');base.cancelPreview();}}));
  armed=true;assert.doesNotThrow(()=>f.panel.dispose());assert.equal(f.parent.children.length,0);
});
test('recovery normal copy, save, preview and explicit apply remain available',()=>{
  const f=fixture();try{f.remove();f.run('copy');f.run('save');f.run('preview');assert.equal(f.history.state().size,1);
    f.run('apply');assert.equal(f.history.state().size,2);assert.equal(f.downloads.length,1);assert.equal(f.copies.length,1);
  }finally{f.panel.dispose();}
});
for(const operation of ['apply','discard'])test(`recovery ${operation} remains accurately reported after a follow-up display failure`,()=>{
  let armed=false;const f=fixture({},base=>({...base,[operation](...args){const result=base[operation](...args);armed=true;return result;},state(){if(armed)throw Error('synthetic display failure');return base.state();}}));
  try{f.remove();if(operation==='apply')f.run('preview');else f.q('discard-confirm').checked=true;f.run(operation);
    assert.equal(f.recovery.state().hasBackup,false);assert.equal(f.history.state().size,operation==='apply'?2:1);
    assert.match(f.q('status').textContent,operation==='apply'?/復元は完了/:/控えは破棄/);assert.equal(f.q('apply').disabled,true);
  }finally{f.panel.dispose();}
});
test('recovery consumes asynchronous cleanup failures without delaying disposal',async()=>{
  let calls=0;const f=fixture({},base=>({...base,cancelPreview(){base.cancelPreview();return {then(resolve,reject){calls++;reject(Error('synthetic cleanup'));}};}}));
  f.panel.dispose();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(f.parent.children.length,0);assert.equal(calls,2);
});
test('recovery failed refresh leaves all backup actions disabled',()=>{
  let armed=false;const f=fixture({},base=>({...base,state(){if(armed)throw Error('synthetic state failure');return base.state();}}));
  try{f.remove();armed=true;assert.equal(f.panel.refresh(),false);for(const name of ['preview','apply','save','copy','report','discard'])assert.equal(f.q(name).disabled,true);}
  finally{f.panel.dispose();}
});
