import test from 'node:test';
import assert from 'node:assert/strict';
const base=new URL('../',import.meta.url);
const {Element}=await import(new URL('test/helpers/panel-dom.js',base));
const {mountRehearsalRecordsPanel}=await import(new URL('examples/operation-rehearsal-records-panel.js',base));
const {mountRehearsalScenarioPanel}=await import(new URL('examples/operation-rehearsal-scenario-panel.js',base));
const {rehearsalExampleV2}=await import(new URL('src/operation-rehearsal-examples.js',base));
const {REHEARSAL_WORKSPACE_SCHEMA}=await import(new URL('src/operation-rehearsal-workspace.js',base));
const tick=()=>new Promise(setImmediate);
const workspace=agent=>({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:agent,ledgers:[rehearsalExampleV2(agent)]});
class Node extends Element{
 handlers=new Map();
 set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}
 addEventListener(event,fn){super.addEventListener(event,fn);this.handlers.set(event,fn);}
}
function setup(kind,onChange=()=>{}){
 const nodes=new Map(),document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);},createElement:tag=>new Node(tag)};
 const prefix=kind==='records'?'record-browser-':'whatif-',q=id=>document.getElementById(prefix+id);
 const options={download(){},reasons:{},kinds:{open:'投入',settle:'決済'},onChange};
 const panel=kind==='records'?mountRehearsalRecordsPanel(document,options):mountRehearsalScenarioPanel(document,options);
 const snapshot=()=>JSON.stringify([...nodes].map(([id,n])=>[id,n.textContent,n.value,n.disabled,n.hidden,n.children.map(c=>c.textContent)]));
 return{panel,q,snapshot,source:agent=>kind==='records'?workspace(agent):rehearsalExampleV2(agent),fire:(id,event='click')=>q(id).handlers.get(event)?.()};
}
for(const kind of ['records','scenario'])for(const action of ['dispose','clear','replace'])for(const malformed of [false,true]){
 test(kind+': source capture cannot outlive '+action+(malformed?' even when capture throws':''),()=>{
  const f=setup(kind);f.panel.refresh(f.source('DAT'));let once=false,after;
  const incoming=new Proxy(f.source('EMA'),{ownKeys(target){
   if(!once){once=true;if(action==='dispose')f.panel.dispose();else f.panel.refresh(action==='clear'?null:f.source('CAWELON'));after=f.snapshot();}
   if(malformed)throw Error('private stale capture failure');return Reflect.ownKeys(target);
  }});
  try{assert.doesNotThrow(()=>f.panel.refresh(incoming));assert.equal(once,true);assert.equal(f.snapshot(),after);}
  finally{f.panel.dispose();}
 });
}
for(const phase of ['refresh','compare-start','compare-result'])for(const action of ['dispose','clear','replace']){
 test('comparison '+phase+' observer cannot overwrite '+action,()=>{
  let f,armed=false,once=false,after;
  f=setup('scenario',()=>{
   if(!armed||once||(phase==='compare-result'&&!f.panel.comparison()))return;
   once=true;if(action==='dispose')f.panel.dispose();else f.panel.refresh(action==='clear'?null:f.source('CAWELON'));after=f.snapshot();
  });
  try{
   f.panel.refresh(f.source('DAT'));armed=true;
   if(phase==='refresh')f.panel.refresh(f.source('EMA'));else assert.doesNotThrow(()=>f.fire('compare'));
   assert.equal(once,true);assert.equal(f.snapshot(),after);
  }finally{armed=false;f.panel.dispose();}
 });
}
for(const [name,result]of [
 ['throw',()=>{throw Error('private notification');}],
 ['native',()=>Promise.reject(Error('private async notification'))],
 ['malformed',()=>({async then(){throw Error('private malformed notification');}})],
])test('comparison observers do not discard valid work or leak failures: '+name,async()=>{
 let armed=false,calls=0;const f=setup('scenario',()=>{if(armed){calls++;return result();}});
 try{armed=true;assert.doesNotThrow(()=>f.panel.refresh(f.source('DAT')));assert.doesNotThrow(()=>f.fire('compare'));await tick();
  assert.ok(f.panel.comparison());assert.equal(f.q('save').disabled,false);assert.match(f.q('status').textContent,/比較が完了/);assert.ok(calls>=3);
 }finally{armed=false;f.panel.dispose();}
});
test('comparison disposal marks the panel closed before notifying its owner',()=>{
 let armed=false,f,calls=0;f=setup('scenario',()=>{if(armed){calls++;f.panel.dispose();}});
 f.panel.refresh(f.source('DAT'));armed=true;
 assert.doesNotThrow(()=>f.panel.dispose());assert.equal(calls,1);assert.equal(f.panel.comparison(),null);assert.equal(f.q('compare').disabled,true);
});
test('invalid replacement still reports its own failure without erasing a healthy source',()=>{
 for(const kind of ['records','scenario']){
  const f=setup(kind);try{f.panel.refresh(f.source('DAT'));const before=f.snapshot();assert.throws(()=>f.panel.refresh({}));assert.equal(f.snapshot(),before);}finally{f.panel.dispose();}
 }
});
