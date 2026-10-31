import test from 'node:test';import assert from 'node:assert/strict';import {resolve} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
const repo=fileURLToPath(new URL('../',import.meta.url));const load=path=>import(pathToFileURL(resolve(repo,path)));
const {Element}=await load('test/helpers/panel-dom.js');
const {walletFileReadService}=await load('src/file-read-service.js');
const {mountRehearsalCheckPanel}=await load('examples/operation-rehearsal-check-panel.js');
const {mountRehearsalScenarioSetPanel}=await load('examples/operation-rehearsal-scenario-set-panel.js');
const {mountRehearsalSessionPanel}=await load('examples/operation-rehearsal-session-panel.js');
const {mountRehearsalReviewPanel}=await load('examples/operation-rehearsal-review-panel.js');
const {mountOperationRehearsal}=await load('examples/operation-rehearsal-page.js');
const {createRehearsalSession,encodeRehearsalSession}=await load('src/operation-rehearsal-session.js');
const {rehearsalExampleV2}=await load('src/operation-rehearsal-examples.js');
const {encodeRehearsalWorkspace,REHEARSAL_WORKSPACE_SCHEMA}=await load('src/operation-rehearsal-workspace.js');
const {encodeRehearsalOverview}=await load('src/operation-rehearsal-overview.js');
const {encodeRehearsalScenarioSet,REHEARSAL_SCENARIO_SET_SCHEMA}=await load('src/operation-rehearsal-scenario-set.js');
const {captureRehearsalCheckSuite,encodeRehearsalCheckSuite}=await load('src/operation-rehearsal-check-suite.js');
const tick=()=>new Promise(setImmediate),bytes=text=>new TextEncoder().encode(text).buffer;
class Node extends Element{set textContent(v){this.text=v;this.children=[];}get textContent(){return this.text;}}
const input=rehearsalExampleV2('EMA'),workspace={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:'EMA',ledgers:[input]},cases={schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:'newer',label:'Newer preview',before:input,after:input}]};
const sourceSession=createRehearsalSession('EMA');sourceSession.workspace.reset(input);
const sources={check:encodeRehearsalCheckSuite(captureRehearsalCheckSuite(cases)),cases:encodeRehearsalScenarioSet(cases),session:encodeRehearsalSession(sourceSession.snapshot()),report:encodeRehearsalOverview(workspace),workspace:encodeRehearsalWorkspace(workspace)};sourceSession.dispose();
function setup(kind){const nodes=new Map(),downloads=[];const document={getElementById(id){if(!nodes.has(id))nodes.set(id,new Node('div'));return nodes.get(id);},createElement:tag=>new Node(tag)};
  const prefix={check:'check-suite-',cases:'scenario-set-',session:'session-',report:'report-review-',workspace:'workspace-'}[kind],q=name=>document.getElementById(prefix+name);
  const download=({prepared})=>downloads.push(prepared);let panel,session;
  if(kind==='check')panel=mountRehearsalCheckPanel(document,{download});
  if(kind==='cases')panel=mountRehearsalScenarioSetPanel(document,{download,getComparison:()=>null});
  if(kind==='session'){session=createRehearsalSession();session.workspace.reset(rehearsalExampleV2());panel=mountRehearsalSessionPanel(document,{session,download,onRestored(){},renderWorkspaceComparison(){}});}
  if(kind==='report')panel=mountRehearsalReviewPanel(document,{download});
  if(kind==='workspace'){document.getElementById('agent').value='DAT';document.getElementById('scenario').value='profit';panel=mountOperationRehearsal(document,download);document.getElementById('example').click();}
  const paste=value=>{q('text').value=value;q('text').dispatchEvent(new Event('input'));q(kind==='workspace'?'text-review':'paste').click();};
  const file=value=>{q('file').files=[value];q('file').dispatchEvent(new Event('change'));};
  const clear=()=>q(['cases','session','workspace'].includes(kind)?'cancel':'clear').click();
  const ready=()=>['check','report'].includes(kind)?!q('save').disabled:!q('apply').disabled;
  return{panel,q,paste,file,clear,ready,downloads,field:id=>document.getElementById(id),snapshot:()=>JSON.stringify([...nodes].map(([id,n])=>[id,n.textContent,n.value,n.disabled,n.hidden])),dispose(){panel.dispose();session?.dispose();}};
}
for(const kind of ['check','cases','session','report','workspace'])for(const action of ['clear','paste','file','dispose'])test(kind+' cancellation must preserve a newer operation over older '+action,async()=>{
  const f=setup(kind);let release,armed=false,entered=false,reads=0;
  const gate=new Promise(resolve=>release=resolve),baseline=walletFileReadService.state().cancelled;
  const unsubscribe=walletFileReadService.subscribe(state=>{if(armed&&!entered&&state.cancelled>baseline){entered=true;
    if(action==='dispose')f.file({name:'after-close.json',size:bytes(sources[kind]).byteLength,arrayBuffer:async()=>{reads++;return bytes(sources[kind]);}});
    else f.paste(sources[kind]);}});
  try{
    f.file({name:'older.json',size:2,arrayBuffer:()=>gate});await tick();armed=true;
    if(action==='clear')f.clear();if(action==='paste'){f.q('text').value='{}';f.q(kind==='workspace'?'text-review':'paste').click();}
    if(action==='file')f.file({name:'replacement.json',size:2,arrayBuffer:async()=>{reads++;return bytes('{}');}});
    if(action==='dispose')f.panel.dispose();assert.equal(entered,true);
    if(action==='dispose')await tick();else for(let i=0;i<100&&!f.ready();i++)await new Promise(resolve=>setTimeout(resolve,1));
    if(action==='dispose'){assert.equal(f.ready(),false);assert.equal(reads,0);}else{assert.equal(f.ready(),true);assert.equal(reads,0);assert.match(f.q('status').textContent,kind==='report'?/再計算と一致/:kind==='check'?/期待結果と一致/:kind==='workspace'?/確認した3トークン/:/確認/);}
  }finally{armed=false;unsubscribe();release(bytes('{}'));f.dispose();await tick();}
});

for(const action of ['undo','form-restore','example','calculate','agent','append-preview'])test('workspace review survives main-page '+action+' during cancellation',async()=>{
  const f=setup('workspace');let release,armed=false,entered=false,afterNew;
  const edit=(id,value,event='input')=>{f.field(id).value=value;f.field(id).dispatchEvent(new Event(event));};
  edit('append-kind','deposit','change');edit('append-amount','1');f.field('append-preview').click();f.field('append-confirm').click();
  if(action==='form-restore')edit('principal','unfinished');
  const gate=new Promise(resolve=>release=resolve),baseline=walletFileReadService.state().cancelled;
  const unsubscribe=walletFileReadService.subscribe(state=>{if(armed&&!entered&&state.cancelled>baseline){entered=true;f.paste(sources.workspace);afterNew=f.snapshot();}});
  try{f.file({name:'older.json',size:2,arrayBuffer:()=>gate});await tick();armed=true;
    if(action==='agent')edit('agent','EMA','change');else f.field(action).click();
    assert.equal(entered,true);assert.equal(f.ready(),true);assert.equal(f.snapshot(),afterNew);
  }finally{armed=false;unsubscribe();release(bytes('{}'));f.dispose();await tick();}
});

for(const action of ['clear','paste','file','run'])test('report source survives cancelling its pending checksum file during '+action,async()=>{
  const f=setup('report');let release,armed=false,entered=false,olderReads=0;const gate=new Promise(resolve=>release=resolve);
  const original=encodeRehearsalOverview({...workspace,activeAgent:'DAT',ledgers:[rehearsalExampleV2()]});
  f.paste(original);for(let i=0;i<100&&!f.ready();i++)await new Promise(resolve=>setTimeout(resolve,1));assert.equal(f.ready(),true);
  const baseline=walletFileReadService.state().cancelled,unsubscribe=walletFileReadService.subscribe(state=>{if(armed&&!entered&&state.cancelled>baseline){entered=true;f.paste(sources.report);}});
  try{
    f.q('checksum-file').files=[{name:'checksum.txt',size:64,arrayBuffer:()=>gate}];f.q('checksum-file').dispatchEvent(new Event('change'));await tick();armed=true;
    if(action==='clear')f.clear();if(action==='paste'){f.q('text').value='{}';f.q('paste').click();}if(action==='run')f.q('run').click();
    if(action==='file')f.file({name:'old-replacement.json',size:2,arrayBuffer:async()=>{olderReads++;return bytes('{}');}});
    assert.equal(entered,true);for(let i=0;i<100&&!f.ready();i++)await new Promise(resolve=>setTimeout(resolve,1));
    assert.equal(f.ready(),true);assert.equal(olderReads,0);f.q('source-save').click();assert.equal(f.downloads.pop().text,sources.report);
  }finally{armed=false;unsubscribe();release(bytes('0'.repeat(64)));f.dispose();await tick();}
});

for(const action of ['cancel','example','calculate'])test('single-record read cancellation cannot erase a newer workspace preview during '+action,async()=>{
  const f=setup('workspace');let release,armed=false,entered=false,afterNew;const gate=new Promise(resolve=>release=resolve),baseline=walletFileReadService.state().cancelled;
  const unsubscribe=walletFileReadService.subscribe(state=>{if(armed&&!entered&&state.cancelled>baseline){entered=true;f.paste(sources.workspace);afterNew=f.snapshot();}});
  try{f.field('file').files=[{name:'single.json',size:2,arrayBuffer:()=>gate}];f.field('file').dispatchEvent(new Event('change'));await tick();armed=true;f.field(action).click();
    assert.equal(entered,true);assert.equal(f.ready(),true);assert.equal(f.snapshot(),afterNew);
  }finally{armed=false;unsubscribe();release(bytes('{}'));f.dispose();await tick();}
});
