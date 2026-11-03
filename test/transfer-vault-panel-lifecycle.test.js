import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTransferVaultPanel } from '../examples/transfer-vault-panel.js';
import { Element } from './helpers/panel-dom.js';
import { bundleFor, memoryVault, id, TIME } from './helpers/vault-fixtures.js';
import { deferred, tick } from './helpers/transfer-fixtures.js';
class TestElement extends Element {
  handlers=new Map();
  addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
  setAttribute(name,value){super.setAttribute(name,value);this.onAttribute?.(name,value);}
}
function fixture(options={}) {
  const parent=new TestElement('div'),downloads=[],storage=memoryVault();let serial=0;
  const panel=mountTransferVaultPanel({document:{createElement:tag=>new TestElement(tag)},parent,storage,readCards:bundleFor,
    stageArchive:()=>true,now:()=>TIME,createId:()=>id(++serial),download:value=>{downloads.push(value);},...options});
  const q=name=>parent.find('transfer-vault-'+name);return {parent,panel,q,downloads,storage,run:name=>q(name).run()};
}
async function ready(f){await f.run('capture');await f.run('apply');await f.run('refresh');f.q('label').value='Synthetic history';await f.run('save');}
async function until(check){const limit=Date.now()+3000;while(!check()){assert.ok(Date.now()<limit,'condition did not settle');await tick();}}
const buttons=['export-json','export-csv','export-txt','filtered-export','stored-export','collection-export'];
for(const button of buttons)for(const receipt of ['false','resolved','rejected'])test(`vault ${button} ${receipt} receipt is refused`,async()=>{
  const f=fixture({download:()=>receipt==='false'?false:receipt==='resolved'?Promise.resolve(true):Promise.reject(Error('synthetic refusal'))});
  try{await ready(f);await f.run(button);assert.match(f.q('status').textContent,/保存できません|書き出せません/);}finally{f.panel.dispose();}
});
for(const button of ['export-json','collection-export'])test(`vault ${button} asynchronous receipt does not hold the handler open`,async()=>{
  const hold=deferred();let task,started=false,done=false;
  const f=fixture({download(){started=true;return hold.promise;}});
  try{await ready(f);task=f.run(button);task.finally(()=>{done=true;});await until(()=>started);
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(done,true);
  }finally{hold.resolve();await task;f.panel.dispose();}
});
for(const button of ['export-json','collection-export'])for(const ending of ['dispose','invalidateCards','cancel'])test(`vault ${button} ${ending} ignores late adapter failures`,async()=>{
  let f,node,before;f=fixture({download(){node=f.q('status');if(ending==='cancel')f.run('cancel');else f.panel[ending]();before=node.textContent;throw Error('synthetic refusal');}});
  try{await ready(f);await f.run(button);assert.equal(node.textContent,before);}finally{f.panel.dispose();}
});
for(const [field,value,event] of [['agent','EMA','change'],['direction','incoming','change'],['order','oldest','change'],['search','42','input']])test(`vault ${field} changes while preparing prevent delivery of an outdated filtered CSV`,async()=>{
  const f=fixture();let armed=false;
  try{await ready(f);f.q('panel').onAttribute=(name,busy)=>{if(armed&&name==='aria-busy'&&busy==='true'){armed=false;f.q(field).value=value;f.q(field).run(event);}};
    armed=true;await f.run('filtered-export');assert.equal(f.downloads.length,0);assert.match(f.q('status').textContent,/検索条件が変わった/);
  }finally{f.panel.dispose();}
});
test('vault unrelated paging does not revoke an unfiltered JSON export',async()=>{
  const f=fixture();let armed=false;
  try{await ready(f);f.q('panel').onAttribute=(name,value)=>{if(armed&&name==='aria-busy'&&value==='true'){armed=false;f.run('next');}};
    armed=true;await f.run('export-json');assert.equal(f.downloads.length,1);
  }finally{f.panel.dispose();}
});
test('vault retained file and filter handlers are inert after disposal',()=>{
  const f=fixture();const file=f.q('file'),search=f.q('search'),handler=file.handlers.get('change'),filter=search.handlers.get('input'),counter=f.q('counter');
  let reads=0;Object.defineProperty(file,'files',{get(){reads++;return [];}});f.panel.dispose();const before=counter.textContent;
  handler();filter();assert.equal(reads,0);assert.equal(counter.textContent,before);
});
test('vault ordinary accepted downloads cover every explicit export path',async()=>{
  const f=fixture();try{await ready(f);for(const name of buttons)await f.run(name);assert.equal(f.downloads.length,6);}finally{f.panel.dispose();}
});
