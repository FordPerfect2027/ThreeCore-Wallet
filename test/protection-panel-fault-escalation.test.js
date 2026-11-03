import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecurityLock } from '../src/security-lock.js';
import { mountSecurityPanel } from '../examples/security-panel.js';
import { Element } from './helpers/panel-dom.js';
import { fakeClock } from './helpers/security-fixtures.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const fault of ['clock','timer'])test(`already-stopped access retains a later ${fault} fault and cannot resume`,()=>{
  const clock=fakeClock();let cleaned=0;const lock=createSecurityLock({...clock.options,onLock(){cleaned++;return true;}});
  try{lock.lock();const before=lock.state().version;lock.lock(fault);assert.equal(lock.state().fault,fault);assert.equal(lock.state().reason,fault);
    assert.ok(lock.state().version>before);assert.equal(lock.state().canResume,false);assert.equal(cleaned,1);
    lock.retryCleanup();assert.equal(lock.unlock(),false);assert.equal(lock.check(),false);
  }finally{lock.dispose();}
});
test('repeated ordinary stops do not invalidate successful cleanup or inflate lock version',()=>{
  const clock=fakeClock();let cleaned=0;const lock=createSecurityLock({...clock.options,onLock(){cleaned++;return true;}});
  try{lock.lock();const before=lock.state().version;lock.lock('hidden');assert.equal(lock.state().version,before);assert.equal(cleaned,1);assert.equal(lock.state().canResume,true);}finally{lock.dispose();}
});
function fixture(options={}){
  const document=Object.assign(new EventTarget(),{createElement:tag=>new Element(tag),visibilityState:'visible'});
  const parent=new Element('main'),clock=fakeClock();
  const panel=mountSecurityPanel({document,parent,eventTarget:new EventTarget(),lockOptions:clock.options,...options});
  return{panel,q:name=>parent.find('security-'+name)};
}
for(const fault of ['clock','timer'])test(`protection panel records a later ${fault} fault after a manual stop`,()=>{
  const f=fixture();try{f.panel.lock();f.panel.lock(fault);assert.equal(f.panel.state().fault,fault);assert.equal(f.q('resume').disabled,true);
    assert.equal(f.q('cleanup-warning').hidden,false);assert.match(f.q('cleanup-warning').textContent,/ページを開き直/);
    f.q('resume').dispatchEvent(new Event('click'));assert.equal(f.panel.check(),false);
  }finally{f.panel.dispose();}
});
for(const observer of ['onLock','canResume'])test(`protection ${observer} malformed async then failure is consumed without authorizing resume`,async()=>{
  const f=fixture({[observer]:()=>({async then(){throw Error('observer async then');}})});
  try{f.panel.lock();await tick();assert.equal(f.panel.check(),false);assert.equal(f.q('resume').disabled,true);}finally{f.panel.dispose();await tick();}
});
test('eligibility callback that escalates a clock fault cannot hide the current recovery message',()=>{
  let f,armed=false;f=fixture({canResume(){if(armed){armed=false;f.panel.lock('clock');}return true;}});
  try{armed=true;f.panel.lock();assert.equal(f.panel.state().fault,'clock');assert.equal(f.q('cleanup-warning').hidden,false);assert.match(f.q('cleanup-warning').textContent,/ページを開き直/);assert.equal(f.q('resume').disabled,true);}finally{f.panel.dispose();}
});
test('eligibility callback disposal prevents stale render from changing removed controls',()=>{
  let f,armed=false,retry,before;f=fixture({canResume(){if(armed){armed=false;retry=f.q('cleanup-retry');f.panel.dispose();before=retry.disabled;}return true;}});
  armed=true;f.panel.lock();assert.equal(retry.disabled,before);assert.equal(f.panel.state().disposed,true);
});
for(const fault of ['clock','timer'])test(`fault ${fault} raised inside cleanup is retained without recursive cleanup`,()=>{
  let f,calls=0;f=fixture({onLock(){calls++;f.panel.lock(fault);return true;}});
  try{f.panel.lock();assert.equal(calls,1);assert.equal(f.panel.state().fault,fault);assert.equal(f.q('resume').disabled,true);assert.equal(f.panel.check(),false);}finally{f.panel.dispose();}
});
