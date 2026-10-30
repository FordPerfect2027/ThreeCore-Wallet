import test from 'node:test';
import assert from 'node:assert/strict';
import { mountTransferPanel } from '../examples/transfer-panel.js';
import { Element } from './helpers/panel-dom.js';
import { context, snapshot, deferred, tick } from './helpers/transfer-fixtures.js';
class TestElement extends Element {
  handlers=new Map();
  addEventListener(type,fn){this.handlers.set(type,fn);}
  removeEventListener(type,fn){if(this.handlers.get(type)===fn)this.handlers.delete(type);}
  run(type='click'){return this.handlers.get(type)?.(new Event(type));}
}
function fixture(options={}) {
  const parent=new TestElement('div');
  const panel=mountTransferPanel({document:{createElement:tag=>new TestElement(tag)},parent,getContext:context,
    read:async()=>snapshot(),download(){},...options});
  const q=name=>parent.find('transfer-'+name);
  return {parent,panel,q,run:name=>q(name).run()};
}
async function until(check){const limit=Date.now()+3000;while(!check()){assert.ok(Date.now()<limit,'condition did not settle');await tick();}}
async function ready(f){await f.run('read');f.run('archive-add');}
const endingActions = {
  'archive cancel': f=>f.run('archive-cancel'),
  'archive clear': f=>f.run('archive-clear'),
  'parent cancel': f=>f.run('cancel'),
  'parent invalidate': f=>f.panel.invalidate(),
  'dispose': f=>f.panel.dispose(),
};
for(const stoppedDigest of [1,2]) for(const [ending,finish] of Object.entries(endingActions)) {
  test(`selected archive digest ${stoppedDigest} settles promptly on ${ending}`,async()=>{
    const hold=deferred();let calls=0,entered=false,done=false,task;
    const f=fixture({subtle:{digest(...args){calls++;if(calls===stoppedDigest){entered=true;return hold.promise;}return crypto.subtle.digest(...args);}}});
    try{
      await ready(f);task=f.run('archive-select');task.finally(()=>{done=true;});await until(()=>entered);
      if(ending==='archive cancel')assert.equal(f.q('archive-cancel').disabled,false,'selection must expose cancellation');
      finish(f);await new Promise(resolve=>setTimeout(resolve,30));
      assert.equal(done,true,'cancelled selection still waits for provider hashing');
      if(ending!=='dispose'){
        assert.equal(f.q('apply').disabled,true);assert.equal(f.q('panel').getAttribute('aria-busy'),'false');
        assert.equal(f.q('archive-panel').getAttribute('aria-busy'),'false');
        assert.doesNotMatch(f.q('archive-status').textContent,/準備しています|できませんでした/);
      }
    }finally{hold.resolve(new ArrayBuffer(32));await task;f.panel.dispose();}
  });
}
test('archive cancellation prevents a later encoded record from being staged',async()=>{
  const hold=deferred();let calls=0;const f=fixture({subtle:{digest(...args){return ++calls===1?hold.promise:crypto.subtle.digest(...args);}}});let task;
  try{await ready(f);task=f.run('archive-select');await until(()=>calls===1);f.run('archive-cancel');
    hold.resolve(new ArrayBuffer(32));await task;assert.equal(calls,1);assert.equal(f.q('apply').disabled,true);
  }finally{hold.resolve(new ArrayBuffer(32));await task;f.panel.dispose();}
});
test('retired selection cleanup leaves the replacement independently cancellable',async()=>{
  const first=deferred(),second=deferred();let calls=0,a,b,done=false;
  const f=fixture({subtle:{digest(){calls++;return calls===1?first.promise:second.promise;}}});
  try{await ready(f);a=f.run('archive-select');await until(()=>calls===1);
    b=f.run('archive-select');b.finally(()=>{done=true;});await until(()=>calls===2);await a;
    assert.equal(done,false);assert.equal(f.q('archive-cancel').disabled,false);
    f.run('archive-cancel');await new Promise(resolve=>setTimeout(resolve,30));assert.equal(done,true);
  }finally{first.resolve(new ArrayBuffer(32));second.resolve(new ArrayBuffer(32));await Promise.all([a,b]);f.panel.dispose();}
});
test('parent action supersedes selection even when a file chooser returns no file',async()=>{
  const hold=deferred();let entered=false,done=false,task;
  const f=fixture({subtle:{digest(){entered=true;return hold.promise;}}});
  try{await ready(f);task=f.run('archive-select');task.finally(()=>{done=true;});await until(()=>entered);
    f.q('file').files=[];f.q('file').run('change');await new Promise(resolve=>setTimeout(resolve,30));assert.equal(done,true);
  }finally{hold.resolve(new ArrayBuffer(32));await task;f.panel.dispose();}
});
test('replacement action cannot continue after cancellation observer disposes the parent',async()=>{
  const hold=deferred();let calls=0,armed=false,f,task;
  f=fixture({subtle:{digest(...args){return ++calls===2?hold.promise:crypto.subtle.digest(...args);}},
    onStateChange(state){if(armed&&state.phase==='ready'){armed=false;f.panel.dispose();}}});
  try{await ready(f);task=f.run('archive-select');await until(()=>calls===2);armed=true;const saved=f.q('save-json');
    await saved.run();await task;assert.equal(calls,2);
  }finally{hold.resolve(new ArrayBuffer(32));await task;f.panel.dispose();}
});
test('ordinary archive selection still previews and requires explicit apply',async()=>{
  const f=fixture();try{await ready(f);await f.run('archive-select');assert.equal(f.q('apply').disabled,false);
    assert.doesNotMatch(f.q('archive-status').textContent,/準備しています/);
    assert.match(f.q('status').textContent,/確認してから/);f.run('apply');assert.match(f.q('status').textContent,/保存ファイル/);
  }finally{f.panel.dispose();}
});
