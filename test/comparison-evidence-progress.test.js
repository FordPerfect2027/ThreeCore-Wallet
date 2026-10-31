import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as wallet from '../src/file-read-status.js';
import * as rehearsal from '../src/operation-rehearsal-report-review.js';
import {mountSavedBatchComparisonPanel} from '../examples/file-read-panel.js';
import {mountRehearsalBatchComparisonPanel} from '../examples/operation-rehearsal-review-panel.js';
import {Element} from './helpers/panel-dom.js';
import {until} from './helpers/workspace-fixtures.js';

for (const kind of ['wallet','rehearsal']) {
  const w=kind==='wallet',core=w?wallet:rehearsal;
  const inspect=core[w?'inspectWalletSavedTextBatch':'reviewRehearsalReportBatch'];
  const prepare=core[w?'prepareWalletBatchComparisonEvidence':'prepareRehearsalBatchComparisonEvidence'];
  const review=core[w?'reviewWalletBatchComparisonEvidence':'reviewRehearsalBatchComparisonEvidence'];
  const encode=core[w?'encodeWalletBatchComparisonEvidenceReview':'encodeRehearsalBatchComparisonEvidenceReview'];
  const text=readFileSync(new URL('../docs/evidence/2026-11-01-portable-batch-pairs/'+kind+'-pair.json',import.meta.url),'utf8');
  const doc=JSON.parse(text),before=await inspect(doc.before.files),after=await inspect(doc.after.files);
  const runs=[options=>prepare(before,after,options),options=>review(text,options)];

  test(kind+' comparison reports ordered private-data-free stages without changing evidence or legacy progress',async()=>{
    for (const [index,run] of runs.entries()) {
      const stages=[],legacy=[],plain=await run({onProgress:p=>legacy.push(p)}),observed=[];
      const result=await run({onProgress:p=>observed.push(p),onStage:p=>{assert(Object.isFrozen(p));stages.push(p);}});
      assert.deepEqual(observed,legacy);
      assert.equal(index===0?result.text:encode(result),index===0?plain.text:encode(plain));
      assert.deepEqual([...new Set(stages.filter(p=>p.phase==='sources').map(p=>p.side))],['before','after']);
      for (const side of ['before','after']) {
        const group=stages.filter(p=>p.side===side);assert.equal(group[0].checked,0);assert.equal(group.at(-1).checked,2);
        assert(group.every((p,i)=>p.selected===2&&(!i||p.checked>=group[i-1].checked)));
        assert(group.every(p=>Object.keys(p).sort().join(',')==='checked,phase,selected,side'));
      }
      assert.deepEqual(stages.filter(p=>p.phase!=='sources').map(p=>p.phase),index===0?['serializing','complete']:['parsing','comparing','hashing','complete']);
      assert(!JSON.stringify(stages).includes('same.json'));
    }
  });

  test(kind+' comparison cancellation from a progress callback stops the next group and completion',async()=>{
    for (const run of runs) {const controller=new AbortController(),stages=[];
      await assert.rejects(()=>run({signal:controller.signal,onStage:p=>{stages.push(p);if(p.side==='before'&&p.checked===1)controller.abort();}}));
      assert(!stages.some(p=>p.side==='after'||p.phase==='complete'));
    }
  });

  test(kind+' comparison deadlines include stage observers',async t=>{
    let now=0;t.mock.method(Date,'now',()=>now);
    for(const run of runs){now=0;const stages=[];await assert.rejects(()=>run({timeoutMs:100,onStage:p=>{stages.push(p);now=101;}}));assert(!stages.some(p=>p.phase==='complete'));}
  });

  test(kind+' invalid observer descriptors are never invoked and observer failures cannot alter verdicts',async()=>{
    let reads=0;const getter=Object.defineProperty({},'onStage',{get(){reads++;return ()=>{};}});
    for(const run of runs){for(const options of [getter,{onStage:1}])await assert.rejects(()=>run(options));
      for(const callback of [()=>{throw Error('observer');},()=>Promise.reject(Error('observer'))]){
        const result=await run({onStage:callback});assert(w?(result.containsOriginalEvidence||result.matchesRecomputation):(result.containsOriginalEvidence||result.matchesRecomputation));
      }
    }
    assert.equal(reads,0);
  });

  test(kind+' UI announces both groups and suppresses progress after cancellation or replacement',async()=>{
    const document={createElement:tag=>new Element(tag)},parent=new Element('div'),downloads=[];
    const panel=w?mountSavedBatchComparisonPanel({document,parent,download:p=>downloads.push(p)}):mountRehearsalBatchComparisonPanel(document,{parent,download:({prepared})=>downloads.push(prepared)});
    const q=n=>parent.find((w?'saved-batch-comparison-':'rehearsal-batch-comparison-')+n);
    const e=n=>parent.find((w?'wallet-comparison-evidence-':'rehearsal-batch-comparison-evidence-')+n);
    const history=[],status=e('status');let value=status.textContent,interrupt=()=>{};
    Object.defineProperty(status,'textContent',{get:()=>value,set:v=>{value=v;history.push(v);interrupt(v);}});
    try {
      panel.updateCurrent(before);q('hold').click();panel.updateCurrent(after);
      assert.equal(await panel.inspectEvidenceFile(new File([text],'pair.json')),true);
      assert(history.some(v=>v.includes('比較元: 2／2'))&&history.some(v=>v.includes('比較先: 2／2')));
      history.length=0;e('ack').checked=true;e('ack').dispatchEvent(new Event('change'));e('save').click();await until(()=>downloads.length===1);
      assert(history.some(v=>v.includes('比較先: 2／2')));assert.equal(downloads[0].text,(await prepare(before,after)).text);
      for (const mode of ['stop','replace']) {history.length=0;let fired=false;interrupt=v=>{if(!fired&&v.startsWith('比較元:')){fired=true;if(mode==='stop')e('stop').click();else panel.updateCurrent(null);}};
        assert.notEqual(await panel.inspectEvidenceFile(new File([text],'pair.json')),true);interrupt=()=>{};
        assert(fired);assert(!history.some(v=>v.startsWith('比較先:')||v.includes('計算が終わりました')));
        assert.equal(parent.find('reviewed-batch-comparison-rows').children.length,0);
        assert(mode==='stop'?status.textContent.includes('中止'):status.textContent==='');panel.updateCurrent(after);
      }
    } finally {interrupt=()=>{};panel.dispose();}
  });
}
