import test from 'node:test';import assert from 'node:assert/strict';
import {mountTokenPlanPanel} from '../examples/token-plan-panel.js';
import {mountPortfolioPanel} from '../examples/portfolio-panel.js';
import {createTokenPlan,encodeTokenPlan} from '../src/token-plan.js';
import {encodePortfolioReport} from '../src/portfolio-report.js';
import {Element} from './helpers/panel-dom.js';import {until} from './helpers/workspace-fixtures.js';
const A='0x'+'11'.repeat(20),B='0x'+'22'.repeat(20),identity={agent:'DAT',chainId:84532};
const snapshot={...identity,account:A,siteOrigin:'http://localhost:4231',connectionEpoch:1,blockNumber:'42',blockHash:'0x'+'ab'.repeat(32),nativeBalanceBaseUnits:((1n<<256n)-1n).toString(),holdings:[{address:B,hasCode:false,balanceBaseUnits:null,notice:'TOKEN_CODE_MISSING'}],readOnly:true,securityAudit:false};
const planText=encodeTokenPlan(createTokenPlan(identity,B)),reportText=encodePortfolioReport(snapshot);
const choose=(node,file)=>{node.files=file?[file]:[];node.dispatchEvent(new Event('change'));};
const tick=()=>new Promise(r=>setTimeout(r,0));
function fixture(kind,download){const document={createElement:tag=>new Element(tag)},parent=new Element('div'),saved=[],applied=[];let reads=0,context={...identity};
 const panel=kind==='plan'?mountTokenPlanPanel({document,parent,getContext:()=>context,readLines:()=>B,applyLines:v=>applied.push(v),download:download??(({prepared})=>saved.push(prepared))}):mountPortfolioPanel({document,card:parent,getContext:()=>context,read:async()=>{reads++;return snapshot;},download:download??(({prepared})=>saved.push(prepared))});
 const q=name=>parent.find((kind==='plan'?'token-plan-':'portfolio-')+name);
 return{panel,parent,q,saved,applied,setContext:v=>context=v,get reads(){return reads;},async ready(){q('read').click();await until(()=>!q('export').disabled);}};
}
test('token lists save as exact configuration and file loading still requires explicit preview and apply',async()=>{
 const f=fixture('plan');try{f.q('download').click();assert.equal(f.saved[0].text,planText);assert.equal(f.saved[0].filename,'ThreeCore-DAT-token-plan-84532.json');const source=planText+'\r\n';choose(f.q('file'),new File([source],'list.json'));await until(()=>!f.q('file').disabled);assert.equal(f.q('json').value,source);assert(f.q('apply').disabled);assert.equal(f.applied.length,0);f.q('preview').click();f.q('apply').click();assert.deepEqual(f.applied,[B]);assert(f.q('apply').disabled);assert.equal(f.q('file').value,'');}finally{f.panel.dispose();}
});
test('portfolio files preserve exact large balances and unknown contracts, stage historical text without adding history',async()=>{
 const f=fixture('portfolio');try{await f.ready();const history=f.panel.exportHistory(),details=f.q('details').textContent;f.q('download').click();assert.equal(f.saved[0].text,reportText);assert.equal(f.saved[0].filename,'ThreeCore-DAT-portfolio-42.json');choose(f.q('file'),new File([reportText+'\n'],'record.json'));await until(()=>!f.q('file').disabled);assert.equal(f.q('json').value,reportText+'\n');assert.equal(f.q('details').textContent,details);assert.equal(f.panel.exportHistory(),history);assert.equal(f.reads,1);f.q('import').click();assert.match(f.q('details').textContent,/過去の保存記録/);assert.match(f.q('details').textContent,/契約コードなし/);assert(f.q('details').textContent.includes(snapshot.nativeBalanceBaseUnits));assert(f.q('download').disabled);assert.equal(f.panel.exportHistory(),history);assert.equal(f.reads,1);}finally{f.panel.dispose();}
});
for(const kind of ['plan','portfolio']) {
 const text=kind==='plan'?planText:reportText,limit=kind==='plan'?8192:65536;
 test(kind+' invalid files cannot replace prior text or existing results',async()=>{
  const f=fixture(kind);try{if(kind==='portfolio')await f.ready();f.q('json').value=text;const details=f.q('details').textContent;let attempts=0;
   for(const file of [new File(['{'],'broken.json'),new File([new Uint8Array([255])],'encoding.json'),{name:'large.json',size:limit+1,arrayBuffer(){attempts++;throw Error();}}]){choose(f.q('file'),file);await until(()=>!f.q('file').disabled);assert.equal(f.q('json').value,text);assert.match(f.q('status').textContent,/読み込めません/);if(kind==='portfolio')assert.equal(f.q('details').textContent,details);}
   assert.equal(attempts,0);assert.equal(f.applied.length,0);
  }finally{f.panel.dispose();}
 });
 test(kind+' cancelled file selection preserves current text and any reviewed token candidate',async()=>{
  const f=fixture(kind);try{f.q('json').value=text;if(kind==='plan')f.q('preview').click();const status=f.q('status').textContent;choose(f.q('file'),null);assert.equal(f.q('json').value,text);assert.equal(f.q('status').textContent,status);if(kind==='plan')assert(!f.q('apply').disabled);}finally{f.panel.dispose();}
 });
 test(kind+' stop, edits, invalidation and disposal discard delayed files without stale status',async()=>{
  for(const mode of ['stop','edit','invalidate','dispose']){const f=fixture(kind);let release;const status=f.q('status'),input=f.q('json');try{input.value='original';choose(f.q('file'),{name:'slow.json',size:text.length,arrayBuffer:()=>new Promise(r=>{release=r;})});await until(()=>Boolean(release));if(mode==='stop')f.q(kind==='plan'?'stop':'file-stop').click();else if(mode==='edit'){input.value='edited';input.dispatchEvent(new Event('input'));}else f.panel[mode]();const expected=input.value,message=status.textContent;release(new TextEncoder().encode(text).buffer);await tick();await tick();assert.equal(input.value,expected);assert.equal(status.textContent,message);assert.equal(f.applied.length,0);}finally{release?.(new TextEncoder().encode(text).buffer);f.panel.dispose();}}
 });
 test(kind+' unconfirmed downloads and reentrant clearing cannot report a successful save',async()=>{
  for(const result of [false,()=>Promise.reject(Error('download')),'clear']){let f;f=fixture(kind,()=>{if(result==='clear'){f.q('clear').click();return true;}return typeof result==='function'?result():result;});try{if(kind==='portfolio')await f.ready();f.q('download').click();await tick();assert(!f.q('status').textContent.includes('保存を開始しました'));if(result!=='clear'&&kind==='portfolio')assert(!f.q('download').disabled);}finally{f.panel.dispose();}}
 });
}
test('token list file completion rechecks the selected agent and chain',async()=>{
 const f=fixture('plan');let release;try{f.q('json').value='original';choose(f.q('file'),{name:'list.json',size:planText.length,arrayBuffer:()=>new Promise(r=>{release=r;})});await until(()=>Boolean(release));f.setContext({agent:'EMA',chainId:84532});release(new TextEncoder().encode(planText).buffer);await until(()=>!f.q('file').disabled);assert.equal(f.q('json').value,'original');assert.match(f.q('status').textContent,/同じエージェント/);assert(f.q('apply').disabled);}finally{release?.(new TextEncoder().encode(planText).buffer);f.panel.dispose();}
});
