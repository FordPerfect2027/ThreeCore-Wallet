import test from 'node:test';
import assert from 'node:assert/strict';
const base=new URL('../',import.meta.url);
const module=async path=>import(new URL(path,base));
const {Element}=await module('test/helpers/panel-dom.js');
const {mountOperationRehearsal}=await module('examples/operation-rehearsal-page.js');
const {rehearsalExampleV2}=await module('src/operation-rehearsal-examples.js');
const {REHEARSAL_WORKSPACE_SCHEMA,encodeRehearsalWorkspace}=await module('src/operation-rehearsal-workspace.js');
const {reportRehearsalOverview}=await module('src/operation-rehearsal-overview.js');
const {REHEARSAL_SCENARIO_SET_SCHEMA,encodeRehearsalScenarioSet}=await module('src/operation-rehearsal-scenario-set.js');
const {captureRehearsalCheckSuite,encodeRehearsalCheckSuite}=await module('src/operation-rehearsal-check-suite.js');
const {createRehearsalSession,encodeRehearsalSession}=await module('src/operation-rehearsal-session.js');
const input=rehearsalExampleV2('EMA');
const workspace={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:'EMA',ledgers:[input]};
const cases={schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:'example',label:'Example',before:input,after:input}]};
const session=createRehearsalSession('EMA');session.workspace.reset(input);const sessionText=encodeRehearsalSession(session.snapshot());session.dispose();
const casesTable=[
 {prefix:'workspace-',text:encodeRehearsalWorkspace(workspace),cancel:'workspace-cancel',source:'workspace-source'},
 {prefix:'session-',text:sessionText,cancel:'session-cancel',source:'session-source'},
 {prefix:'scenario-set-',text:encodeRehearsalScenarioSet(cases),cancel:'scenario-set-cancel',source:'scenario-set-source'},
 {prefix:'check-suite-',text:encodeRehearsalCheckSuite(captureRehearsalCheckSuite(cases)),cancel:'check-suite-clear',source:'check-suite-source'},
 {prefix:'report-review-',text:JSON.stringify(reportRehearsalOverview(workspace)),cancel:'report-review-clear',source:'report-review-source'},
];
class Node extends Element{
 handlers=new Map();
 addEventListener(type,fn){super.addEventListener(type,fn);this.handlers.set(type,fn);}
 set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}
}
function fixture(){
 const nodes=new Map(),document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);},createElement:tag=>new Node(tag)};
 const q=id=>document.getElementById(id);q('agent').value='DAT';q('scenario').value='profit';
 const page=mountOperationRehearsal(document,()=>{});
 function snapshot(prefix){return JSON.stringify([...nodes].filter(([id])=>id.startsWith(prefix)).map(([id,n])=>[id,n.textContent,n.value,n.disabled,n.hidden,n.getAttribute('aria-busy')]));}
 return{q,page,snapshot};
}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
for(const row of casesTable){
 for(const action of ['cancel','dispose'])test(row.prefix+': filename capture cannot revive a selection after '+action,async()=>{
  const f=fixture(),bytes=new TextEncoder().encode(row.text);let before,called=false;
  const file={size:bytes.length,arrayBuffer:async()=>bytes.buffer,get name(){if(!called){called=true;if(action==='dispose')f.page.dispose();else f.q(row.cancel).dispatchEvent(new Event('click'));before=f.snapshot(row.prefix);}return 'old.json';}};
  try{const picker=f.q(row.prefix+'file');picker.files=[file];await picker.handlers.get('change')();await flush();assert.equal(called,true);assert.equal(f.snapshot(row.prefix),before);}
  finally{f.page.dispose();}
 });
 test(row.prefix+': optional filename is read once and its safe value is shown',async()=>{
  const f=fixture(),bytes=new TextEncoder().encode(row.text);let names=0;
  const file={size:bytes.length,arrayBuffer:async()=>bytes.buffer,get name(){if(++names>1)throw Error('read twice');return 'native\u202e.json';}};
  try{const picker=f.q(row.prefix+'file');picker.files=[file];await picker.handlers.get('change')();await flush();assert.equal(names,1);assert.match(f.q(row.source).textContent,/native\.json/);}
  finally{f.page.dispose();}
 });
 test(row.prefix+': unavailable optional filename does not reject valid content or expose details',async()=>{
  const f=fixture(),bytes=new TextEncoder().encode(row.text);let names=0,read=0;
  const file={size:bytes.length,arrayBuffer:async()=>{read++;return bytes.buffer;},get name(){names++;throw Error('secret metadata details');}};
  try{const picker=f.q(row.prefix+'file');picker.files=[file];await picker.handlers.get('change')();await flush();assert.equal(names,1);assert.equal(read,1);assert.ok(f.q(row.source).textContent.length>0);assert.doesNotMatch(f.snapshot(row.prefix),/secret metadata/);}
  finally{f.page.dispose();}
 });
 test(row.prefix+': rejected asynchronous filename uses a fallback without leaking its failure',async()=>{
  const f=fixture(),bytes=new TextEncoder().encode(row.text);let names=0;
  const file={size:bytes.length,arrayBuffer:async()=>bytes.buffer,get name(){names++;return Promise.reject(Error('async filename'));}};
  try{const picker=f.q(row.prefix+'file');picker.files=[file];await picker.handlers.get('change')();await flush();assert.equal(names,1);assert.ok(f.q(row.source).textContent.length>0);assert.doesNotMatch(f.q(row.source).textContent,/Promise|async filename/);}
  finally{f.page.dispose();}
 });
}
