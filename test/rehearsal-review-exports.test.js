import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {Element} from './helpers/panel-dom.js';
import {mountRehearsalReviewPanel} from '../examples/operation-rehearsal-review-panel.js';
import {rehearsalExampleV2} from '../src/operation-rehearsal-examples.js';
import {reportRehearsalOverview} from '../src/operation-rehearsal-overview.js';
import {REHEARSAL_WORKSPACE_SCHEMA} from '../src/operation-rehearsal-workspace.js';
import {encodeRehearsalComparison} from '../src/operation-rehearsal-comparison.js';
import {encodeRehearsalScenario} from '../src/operation-rehearsal-scenario.js';
import {encodeRehearsalScenarioSetReport,REHEARSAL_SCENARIO_SET_SCHEMA} from '../src/operation-rehearsal-scenario-set.js';
import {captureRehearsalCheckSuite,encodeRehearsalCheckReport} from '../src/operation-rehearsal-check-suite.js';
import {encodeRehearsalRecordReport,REHEARSAL_RECORD_QUERY} from '../src/operation-rehearsal-records.js';
import {encodeRehearsalReasonRecordReport} from '../src/operation-rehearsal-records.js';
const source=' \r\n'+JSON.stringify(reportRehearsalOverview({schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:'DAT',ledgers:[rehearsalExampleV2()]}),null,2).replaceAll('\n','\r\n')+'\r\n';
const hash=text=>createHash('sha256').update(text).digest('hex');
class Node extends Element{set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text;}}
function setup(options={}){const elements=new Map(),downloads=[];let action=()=>{};const document={activeElement:null,getElementById(id){if(!elements.has(id)){const n=new Node('div');n.focus=()=>{document.activeElement=n;};elements.set(id,n);}return elements.get(id);},createElement:tag=>new Node(tag)};
 const q=id=>document.getElementById('report-review-'+id);const panel=mountRehearsalReviewPanel(document,{applyRecordQuery:options.applyRecordQuery,getWorkspace:options.getWorkspace,renderWorkspaceComparison:options.renderWorkspaceComparison,subtle:options.subtle??{digest:async(_algorithm,bytes)=>Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer},download:({prepared})=>{const result=action();downloads.push(prepared);return result;}});
 const edit=(id,value)=>{q(id).value=value;q(id).dispatchEvent(new Event('input'));};
 return{q,panel,edit,downloads,document,downloadAction:fn=>{action=fn;},paste:text=>{edit('text',text);q('paste').click();}};
}
async function finished(f){const end=Date.now()+5000;while(f.q('status').getAttribute('aria-busy')==='true'&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(f.q('status').getAttribute('aria-busy'),'false');}

test('batch source handoff uses exact owned text, clears stale checksum and focuses the review heading',async()=>{
 const f=setup();try{f.edit('expected','0'.repeat(64));const text=source;assert.equal(f.panel.inspectSource({name:'元資料.json',text,expectedSha256:null}),true);await finished(f);
  assert.equal(f.q('expected').value,'');assert.equal(f.document.activeElement,f.q('title'));assert.match(f.q('source').textContent,/元資料.json/);f.q('source-save').click();assert.equal(f.downloads.at(-1).text,text);
  assert.equal(f.panel.inspectSource({name:'元資料.json',text,expectedSha256:'0'.repeat(64)}),true);await finished(f);assert.match(f.q('summary').textContent,/照合値: 不一致/);assert.equal(f.q('workspace-save').disabled,true);assert.equal(f.q('input-save').disabled,true);
 }finally{f.panel.dispose();}
});
test('invalid handoff arguments leave the previous independent review intact without invoking accessors',async()=>{
 const f=setup();try{f.paste(source);await finished(f);const previous=f.q('summary').textContent;let calls=0;
  const invalid=[null,{}, {name:'../a.json',text:source,expectedSha256:null},{name:'a.json',text:source,expectedSha256:'bad'}, {name:'a.json',get text(){calls++;return source;},expectedSha256:null}];
  for(const row of invalid){assert.equal(f.panel.inspectSource(row),false);assert.equal(f.q('summary').textContent,previous);assert.equal(f.q('save').disabled,false);}assert.equal(calls,0);
  f.panel.dispose();assert.equal(f.panel.inspectSource({name:'a.json',text:source,expectedSha256:null}),false);
 }finally{f.panel.dispose();}
});
test('batch handoff replaces an older pending individual read without allowing a late result',async()=>{
 let release,calls=0;const f=setup({subtle:{digest:async(_,bytes)=>++calls===1?new Promise(r=>{release=r;}):Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer}});
 try{f.paste(source);while(!release)await new Promise(r=>setTimeout(r,0));assert(f.panel.inspectSource({name:'new.json',text:source+'\n',expectedSha256:null}));await finished(f);const current=f.q('digest').textContent;release(new Uint8Array(32).buffer);await new Promise(r=>setTimeout(r,10));assert.equal(f.q('digest').textContent,current);f.q('source-save').click();assert.equal(f.downloads.at(-1).text,source+'\n');}
 finally{release?.(new Uint8Array(32).buffer);f.panel.dispose();}
});

test('V3 query review describes stored, recorded and combined search scopes separately',async()=>{
 for(const[searchScope,label]of[['stored','保存元の情報'],['recorded','記録に書かれた情報'],['both','保存元と記録の両方']]){
  const f=setup();try{f.paste(encodeRehearsalReasonRecordReport(JSON.parse(source).inputs,{...REHEARSAL_RECORD_QUERY,searchScope,reason:'all'}));await finished(f);assert.match(f.q('outcome').textContent,new RegExp('検索場所: '+label));}finally{f.panel.dispose();}
 }
});

const reusableQuery={...REHEARSAL_RECORD_QUERY,kind:'settle'},reusableSource=encodeRehearsalRecordReport(JSON.parse(source).inputs,reusableQuery);
test('query handoff passes only verified normalized criteria and rejects checksum mismatches',async()=>{
 const calls=[],f=setup({applyRecordQuery:query=>{calls.push(query);return true;}});try{f.paste(reusableSource);await finished(f);assert.equal(f.q('query-apply').disabled,false);f.q('query-apply').click();
  assert.deepEqual(calls,[{...reusableQuery,searchScope:'stored',reason:'all'}]);assert.match(f.q('query-status').textContent,/現在の履歴から再計算/);assert.equal(f.q('source-save').disabled,false);
  f.edit('expected','0'.repeat(64));assert.equal(f.q('query-apply').disabled,true);f.q('run').click();await finished(f);assert.equal(f.q('query-apply').hidden,true);f.q('query-apply').dispatchEvent(new Event('click'));assert.equal(calls.length,1);
 }finally{f.panel.dispose();}
});
for(const change of ['clear','dispose','false','reject','throw'])test('query handoff '+change+' cannot claim stale success',async()=>{
 const f=setup({applyRecordQuery:()=>{if(change==='clear')f.q('clear').click();if(change==='dispose')f.panel.dispose();if(change==='false')return false;if(change==='reject')return Promise.reject(Error('private marker'));if(change==='throw')throw Error('private marker');return true;}});
 try{f.paste(reusableSource);await finished(f);f.q('query-apply').click();await new Promise(resolve=>setTimeout(resolve,0));
  if(['clear','dispose'].includes(change)){assert.equal(f.q('query-status').textContent,'');assert.equal(f.q('query-apply').disabled,true);}
  else{assert.match(f.q('query-status').textContent,/確認できません/);assert.ok(!f.q('query-status').textContent.includes('private marker'));assert.equal(f.q('query-apply').disabled,false);}
 }finally{f.panel.dispose();}
});
test('query reuse is unavailable without a consumer or with an overview source',async()=>{
 for(const options of [{},{applyRecordQuery:()=>true}]){const f=setup(options);try{f.paste(options.applyRecordQuery?source:reusableSource);await finished(f);assert.equal(f.q('query-apply').disabled,true);assert.equal(f.q('query-apply').hidden,true);}finally{f.panel.dispose();}}
});

const partInput=rehearsalExampleV2(),partAfter={...partInput,policy:{...partInput.policy,paused:true}};
const partSet={schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:'paused',label:'停止条件',before:partInput,after:partAfter}]};
const failedSuite=structuredClone(captureRehearsalCheckSuite(partSet));failedSuite.expectationOrigin='manually-specified';failedSuite.expected[0].before.metrics.cash='999';
const partSamples=[
 [encodeRehearsalComparison(JSON.parse(source).inputs,{...JSON.parse(source).inputs,ledgers:[]}),['workspace-before','workspace-after'],'3トークンの履歴の復旧欄'],
 [encodeRehearsalScenario(partInput,partAfter),['scenario-before','scenario-after'],'記録を保存・再確認'],
 [encodeRehearsalScenarioSetReport(partSet),['scenario-set'],'比較ケースを名前付きで残す'],
 [encodeRehearsalCheckReport(failedSuite),['check-suite'],'保存した期待結果との比較']
];
function selectPart(f,value){f.q('input-part').value=value;f.q('input-part').dispatchEvent(new Event('change'));}
for(const [text,parts,destination]of partSamples)test('report input choice '+parts[0]+' is explicit and explains its destination',async()=>{
 const f=setup();try{f.paste(text);await finished(f);assert.equal(f.q('input-recovery').hidden,false);assert.equal(f.q('input-part').value,'');assert.equal(f.q('input-save').disabled,true);
  assert.deepEqual(f.q('input-part').children.map(n=>n.value),['',...parts]);f.q('input-save').dispatchEvent(new Event('click'));assert.equal(f.downloads.length,0);
  for(const part of parts){selectPart(f,part);assert.match(f.q('input-note').textContent,new RegExp(destination));f.q('input-save').click();assert.equal(f.downloads.at(-1).filename,'ThreeCore-recovered-'+part+'.json');}
  if(parts[0]==='check-suite'){assert.deepEqual(JSON.parse(f.downloads[0].text),failedSuite);assert.match(f.q('status').textContent,/期待結果との差/);assert.match(f.q('input-note').textContent,/期待値を変更せず/);}
  selectPart(f,'forged');assert.equal(f.q('input-save').disabled,true);assert.equal(f.q('input-note').textContent,'');
 }finally{f.panel.dispose();}
});
for(const change of ['clear','edit','checksum','dispose','selection'])test('recovered input save retires on '+change+' during delivery',async()=>{
 const f=setup();try{f.paste(partSamples[0][0]);await finished(f);selectPart(f,'workspace-before');
  f.downloadAction(()=>{if(change==='clear')f.q('clear').click();if(change==='edit')f.edit('text','{}');if(change==='checksum')f.edit('expected','0'.repeat(64));if(change==='dispose')f.panel.dispose();if(change==='selection')selectPart(f,'workspace-after');});
  f.q('input-save').click();assert.equal(f.q('export-status').textContent,'');if(change!=='selection'){assert.equal(f.q('input-save').disabled,true);assert.equal(f.q('input-recovery').hidden,true);}
 }finally{f.panel.dispose();}
});
for(const failure of [()=>false,()=>{throw Error('private marker');},()=>Promise.reject(Error('private marker'))])test('recovered input save failure retains verified inputs and permits retry',async()=>{
 const f=setup();try{f.paste(partSamples[1][0]);await finished(f);selectPart(f,'scenario-after');f.downloadAction(failure);f.q('input-save').click();await new Promise(resolve=>setTimeout(resolve,0));
  assert.match(f.q('export-status').textContent,/保存できません/);assert.ok(!f.q('export-status').textContent.includes('private marker'));assert.equal(f.q('input-save').disabled,false);
  f.downloadAction(()=>{});f.q('input-save').click();assert.match(f.q('export-status').textContent,/保存し始め/);
 }finally{f.panel.dispose();}
});
test('wrong expected checksum and altered report cannot show any part recovery choices',async()=>{
 const f=setup();try{f.edit('expected','0'.repeat(64));f.paste(partSamples[2][0]);await finished(f);assert.equal(f.q('input-recovery').hidden,true);
  f.edit('expected','');const altered=JSON.parse(partSamples[2][0]);altered.rows[0].label='changed';f.paste(JSON.stringify(altered));await finished(f);assert.equal(f.q('input-recovery').hidden,true);assert.equal(f.q('input-save').disabled,true);
 }finally{f.panel.dispose();}
});

test('agent export offers present zero-record inputs and keeps the chosen input separate from workspace restoration',async()=>{
 const f=setup();try{const workspace={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:'DAT',ledgers:[rehearsalExampleV2(),{...rehearsalExampleV2('EMA'),events:[]}]};
  f.paste(JSON.stringify(reportRehearsalOverview(workspace)));await finished(f);
  assert.deepEqual(f.q('agent-select').children.map(n=>n.value),['DAT','EMA']);assert.match(f.q('agent-select').children[1].textContent,/0件/);
  f.q('agent-select').value='EMA';f.q('agent-save').click();const file=f.downloads.pop();assert.equal(file.filename,'ThreeCore-EMA-recovered-rehearsal.json');assert.deepEqual(JSON.parse(file.text),workspace.ledgers[1]);
  assert.equal(f.q('workspace-compare').disabled,true);f.downloadAction(()=>false);f.q('agent-save').click();assert.match(f.q('export-status').textContent,/保存できません/);
  f.downloadAction(()=>f.q('clear').click());f.q('agent-save').click();assert.equal(f.q('export-status').textContent,'');assert.equal(f.q('agent-save').disabled,true);
 }finally{f.panel.dispose();}
});
for(const retirement of ['clear','edit','checksum','dispose'])test('reviewed agent action retires on '+retirement,async()=>{
 const f=setup();try{f.paste(source);await finished(f);if(retirement==='clear')f.q('clear').click();if(retirement==='edit')f.edit('text','{}');if(retirement==='checksum')f.edit('expected','0'.repeat(64));if(retirement==='dispose')f.panel.dispose();
  assert.equal(f.q('agent-save').disabled,true);assert.equal(f.q('agent-select').children.length,0);f.q('agent-save').dispatchEvent(new Event('click'));assert.equal(f.downloads.length,0);
 }finally{f.panel.dispose();}
});
test('comparison is independently reviewable and a live input change retires only that comparison',async()=>{
 let current={...JSON.parse(source).inputs,ledgers:[rehearsalExampleV2('DAT','loss')]};
 const f=setup({getWorkspace:()=>current,renderWorkspaceComparison:(report,root)=>{const p=f.document.createElement('p');p.textContent=report.rows[0].action;root.append(p);}});
 try{f.paste(source);await finished(f);f.q('workspace-compare').click();assert.equal(f.q('workspace-comparison').hidden,false);assert.equal(f.q('workspace-comparison-details').children[0].textContent,'replaced');
  f.q('workspace-comparison-save').click();const saved=f.downloads.pop();assert.equal(saved.filename,'ThreeCore-current-vs-reviewed-workspace.json');
  const data=JSON.parse(saved.text);assert.deepEqual(data.inputs.before,current);assert.deepEqual(data.inputs.after,JSON.parse(source).inputs);
  current=JSON.parse(source).inputs;f.q('workspace-comparison-save').click();assert.equal(f.downloads.length,0);assert.equal(f.q('workspace-comparison-save').disabled,true);assert.match(f.q('workspace-comparison-status').textContent,/変わりました/);
  assert.equal(f.q('agent-save').disabled,false);assert.equal(f.q('source-save').disabled,false);f.q('workspace-compare').click();assert.equal(f.q('workspace-comparison-save').disabled,false);
  f.panel.workspaceChanged();assert.equal(f.q('workspace-comparison').hidden,true);assert.equal(f.q('workspace-compare').disabled,false);
 }finally{f.panel.dispose();}
});
for(const boundary of ['get','render','download'])for(const behavior of ['clear','dispose','reject','throw'])test('workspace comparison handles '+boundary+' '+behavior+' without stale publication',async()=>{
 let armed=false;const action=()=>{if(!armed)return;if(behavior==='clear')f.q('clear').click();if(behavior==='dispose')f.panel.dispose();if(behavior==='reject')return Promise.reject(Error('synthetic private'));if(behavior==='throw')throw Error('synthetic private');};
 const f=setup({getWorkspace:()=>boundary==='get'&&armed?(action()??JSON.parse(source).inputs):JSON.parse(source).inputs,
  renderWorkspaceComparison:(_r,root)=>{const p=f.document.createElement('p');p.textContent='comparison';root.append(p);if(boundary==='render')return action();}});
 try{f.paste(source);await finished(f);if(boundary==='download'){f.q('workspace-compare').click();f.downloadAction(action);armed=true;f.q('workspace-comparison-save').click();}
  else{armed=true;f.q('workspace-compare').click();}await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(!f.q('workspace-comparison-status').textContent.includes('synthetic private'));assert.ok(!f.q('export-status').textContent.includes('synthetic private'));
  if(['clear','dispose'].includes(behavior)){assert.equal(f.q('workspace-comparison-details').children.length,0);assert.equal(f.q('workspace-comparison-save').disabled,true);assert.equal(f.q('export-status').textContent,'');}
  else if(boundary==='download'){assert.equal(f.q('workspace-comparison-save').disabled,false);assert.match(f.q('export-status').textContent,/保存できません/);}
  else{assert.equal(f.q('workspace-comparison-details').children.length,0);assert.equal(f.q('workspace-comparison-save').disabled,true);assert.match(f.q('workspace-comparison-status').textContent,/比較できません/);}
 }finally{f.panel.dispose();}
});

test('reviewed workspace export reconstructs full inputs while preserving original report export',async()=>{
 const f=setup();try{f.paste(source);await finished(f);assert.equal(f.q('workspace-save').disabled,false);assert.equal(f.q('workspace-save').hidden,false);
  f.q('workspace-save').click();assert.equal(f.downloads[0].filename,'ThreeCore-recovered-workspace.json');assert.deepEqual(JSON.parse(f.downloads[0].text),JSON.parse(source).inputs);
  assert.match(f.q('export-status').textContent,/現在の履歴には反映していません/);f.q('source-save').click();assert.equal(f.downloads[1].text,source);
  f.edit('expected','0'.repeat(64));assert.equal(f.q('workspace-save').disabled,true);f.q('run').click();await finished(f);
  assert.equal(f.q('workspace-save').disabled,true);assert.equal(f.q('workspace-save').hidden,true);f.q('workspace-save').dispatchEvent(new Event('click'));assert.equal(f.downloads.length,2);
 }finally{f.panel.dispose();}
});

test('workspace export handles a refused save and cannot overwrite a newly cleared view',async()=>{
 const f=setup();try{f.paste(source);await finished(f);f.downloadAction(()=>false);f.q('workspace-save').click();
  assert.match(f.q('export-status').textContent,/保存できません/);assert.equal(f.q('workspace-save').disabled,false);
  f.downloadAction(()=>f.q('clear').click());f.q('workspace-save').click();assert.equal(f.q('export-status').textContent,'');assert.equal(f.q('workspace-save').disabled,true);
 }finally{f.panel.dispose();}
});
test('source, checksum and receipt downloads describe exactly the reviewed text including whitespace',async()=>{const f=setup();try{f.paste(source);await finished(f);f.q('source-save').click();f.q('checksum-save').click();f.q('save').click();const [original,digest,receipt]=f.downloads;
 assert.equal(original.text,source);assert.equal(original.filename,'ThreeCore-reviewed-report.json');assert.equal(original.mimeType,'application/json');assert.equal(digest.text,hash(source)+'\n');assert.equal(digest.mimeType,'text/plain');const data=JSON.parse(receipt.text);assert.equal(data.sha256,hash(original.text));assert.equal(data.byteLength,Buffer.byteLength(original.text));assert.equal(data.matchesRecomputation,true);
 }finally{f.panel.dispose();}});
test('mismatching derived results remain exact exportable evidence without being called an agreement',async()=>{const f=setup();try{const data=JSON.parse(source);data.rows[0].recordCount=123;const text=JSON.stringify(data);f.paste(text);await finished(f);assert.match(f.q('status').textContent,/不一致/);f.q('source-save').click();f.q('checksum-save').click();f.q('save').click();assert.equal(f.downloads[0].text,text);assert.equal(f.downloads[1].text,hash(text)+'\n');assert.equal(JSON.parse(f.downloads[2].text).matchesRecomputation,false);}finally{f.panel.dispose();}});
for(const retirement of ['clear','edit','checksum','dispose'])test('new evidence exports retire on '+retirement,async()=>{const f=setup();try{f.paste(source);await finished(f);if(retirement==='clear')f.q('clear').click();if(retirement==='edit')f.edit('text','{}');if(retirement==='checksum')f.edit('expected','0'.repeat(64));if(retirement==='dispose')f.panel.dispose();for(const id of ['source-save','checksum-save']){assert.equal(f.q(id).disabled,true);f.q(id).dispatchEvent(new Event('click'));}assert.equal(f.downloads.length,0);}finally{f.panel.dispose();}});
for(const id of ['source-save','checksum-save'])test(id+' failure preserves reviewed evidence and permits retry',async()=>{const f=setup();try{f.paste(source);await finished(f);f.downloadAction(()=>{throw Error('synthetic download unavailable');});f.q(id).click();assert.match(f.q('export-status').textContent,/保存を開始できません/);assert.equal(f.q('save').disabled,false);f.downloadAction(()=>{});f.q(id).click();assert.equal(f.downloads.length,1);assert.match(f.q('export-status').textContent,/保存.*開始|保存し始め/);}finally{f.panel.dispose();}});
for(const id of ['source-save','checksum-save'])test(id+' cannot report success over a source cleared inside the download',async()=>{const f=setup();try{f.paste(source);await finished(f);f.downloadAction(()=>f.q('clear').click());f.q(id).click();assert.equal(f.q('export-status').textContent,'');assert.equal(f.q(id).disabled,true);}finally{f.panel.dispose();}});
test('invalid optional checksum focuses its own field and can be corrected without repasting',async()=>{const f=setup();try{f.q('expected').setAttribute('aria-describedby','hash-help');f.edit('expected','g'.repeat(64));f.paste(source);await finished(f);assert.equal(f.document.activeElement,f.q('expected'));assert.equal(f.q('expected').getAttribute('aria-invalid'),'true');assert.equal(f.q('expected').getAttribute('aria-describedby'),'hash-help report-review-status');assert.match(f.q('status').textContent,/0〜9とa〜f/);assert.equal(f.q('run').disabled,false);f.edit('expected',hash(source).toUpperCase());assert.equal(f.q('expected').getAttribute('aria-invalid'),undefined);assert.equal(f.q('expected').getAttribute('aria-describedby'),'hash-help');f.q('run').click();await finished(f);assert.match(f.q('summary').textContent,/照合値: 一致/);assert.equal(f.q('source-save').disabled,false);}finally{f.panel.dispose();}});
test('an absent optional checksum can be left blank after an error',async()=>{const f=setup();try{f.edit('expected','invalid');f.paste(source);await finished(f);f.edit('expected','');f.q('run').click();await finished(f);assert.match(f.q('summary').textContent,/照合値: 指定なし/);assert.equal(f.q('checksum-save').disabled,false);}finally{f.panel.dispose();}});

test('combined evidence export includes exact source, receipt and original expectation',async()=>{
  const f=setup();try{f.edit('expected','0'.repeat(64));f.paste(source);await finished(f);f.q('evidence-save').click();
    assert.equal(f.downloads.length,1);const file=f.downloads[0],data=JSON.parse(file.text);
    assert.equal(file.filename,'ThreeCore-review-evidence.json');assert.equal(data.sourceText,source);
    assert.equal(data.receipt.sha256,hash(source));assert.equal(data.receipt.expectedSha256,'0'.repeat(64));assert.equal(data.receipt.checksumMatches,false);
    assert.equal(data.sourceVerified,false);assert.equal(data.authorizesExecution,false);assert.match(f.q('export-status').textContent,/不一致.*含みます/);
  }finally{f.panel.dispose();}
});
for(const retirement of ['clear','edit','checksum','dispose'])test('combined evidence export retires on '+retirement,async()=>{
  const f=setup();try{f.paste(source);await finished(f);if(retirement==='clear')f.q('clear').click();if(retirement==='edit')f.edit('text','{}');if(retirement==='checksum')f.edit('expected','0'.repeat(64));if(retirement==='dispose')f.panel.dispose();
    assert.equal(f.q('evidence-save').disabled,true);f.q('evidence-save').dispatchEvent(new Event('click'));assert.equal(f.downloads.length,0);
  }finally{f.panel.dispose();}
});
test('combined evidence export failure permits retry without losing source or receipt',async()=>{
  const f=setup();try{f.paste(source);await finished(f);f.downloadAction(()=>{throw Error('synthetic unavailable');});f.q('evidence-save').click();
    assert.match(f.q('export-status').textContent,/保存を開始できません/);assert.equal(f.q('evidence-save').disabled,false);
    f.downloadAction(()=>{});f.q('evidence-save').click();assert.equal(f.downloads.length,1);assert.equal(JSON.parse(f.downloads[0].text).sourceText,source);
  }finally{f.panel.dispose();}
});
test('combined evidence export cannot overwrite a newer cleared view',async()=>{
  const f=setup();try{f.paste(source);await finished(f);f.downloadAction(()=>f.q('clear').click());f.q('evidence-save').click();
    assert.equal(f.q('export-status').textContent,'');assert.equal(f.q('evidence-save').disabled,true);
  }finally{f.panel.dispose();}
});

test('ordinary review exposes every difference page without changing exported evidence',async()=>{
  const f=setup();try{const data=JSON.parse(source);for(let i=0;i<103;i++)data['extra'+String(i).padStart(3,'0')]=i;
    f.paste(JSON.stringify(data));await finished(f);f.q('save').click();const before=f.downloads.pop().text;
    const paths=[];for(let page=0;page<3;page++){paths.push(...f.q('differences').children.map(row=>row.children[0].textContent));if(page<2)f.q('next').click();}
    assert.equal(paths.length,103);assert.equal(new Set(paths).size,103);assert.equal(f.q('next').disabled,true);assert.equal(f.q('previous').disabled,false);
    assert.match(f.q('difference-status').textContent,/81〜103/);f.q('save').click();assert.equal(f.downloads.pop().text,before);
    f.q('previous').click();assert.match(f.q('difference-status').textContent,/41〜80/);f.q('previous').click();assert.equal(f.q('previous').disabled,true);
  }finally{f.panel.dispose();}
});
test('source or expected-hash editing retires report pagination',async()=>{
  const f=setup();try{const data=JSON.parse(source);for(let i=0;i<50;i++)data['extra'+i]=i;f.paste(JSON.stringify(data));await finished(f);assert.equal(f.q('next').disabled,false);
    f.edit('expected','0'.repeat(64));assert.equal(f.q('next').disabled,true);f.q('next').dispatchEvent(new Event('click'));assert.equal(f.q('differences').children.length,0);assert.equal(f.q('difference-status').textContent,'');
    f.q('run').click();await finished(f);assert.equal(f.q('previous').disabled,true);assert.equal(f.q('differences').children.length,40);
    f.q('clear').click();f.q('previous').dispatchEvent(new Event('click'));assert.equal(f.q('difference-status').textContent,'');
  }finally{f.panel.dispose();}
});
