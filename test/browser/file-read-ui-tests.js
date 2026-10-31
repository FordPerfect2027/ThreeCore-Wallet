import { mountCheckpointPanel } from "/examples/checkpoint-panel.js";
import { emptyCheckpointDocument } from "/src/checkpoint-model.js";
import { mountOperationRehearsal } from "/examples/operation-rehearsal-page.js";
import { captureRehearsalCheckSuite, encodeRehearsalCheckSuite } from "/src/operation-rehearsal-check-suite.js";
import { REHEARSAL_SCENARIO_SET_SCHEMA } from "/src/operation-rehearsal-scenario-set.js";
import { rehearsalExampleV2 } from "/src/operation-rehearsal-examples.js";
import { encodeRehearsal } from "/src/operation-rehearsal.js";
import { REHEARSAL_WORKSPACE_SCHEMA,encodeRehearsalWorkspace } from "/src/operation-rehearsal-workspace.js";
import { encodeRehearsalComparison } from "/src/operation-rehearsal-comparison.js";
import { encodeRehearsalScenario } from "/src/operation-rehearsal-scenario.js";
import { encodeRehearsalScenarioSet,encodeRehearsalScenarioSetReport } from "/src/operation-rehearsal-scenario-set.js";
import { encodeRehearsalCheckReport } from "/src/operation-rehearsal-check-suite.js";
import { createFileReadService,walletFileReadService } from "/src/file-read-service.js";
import { mountFileReadPanel, mountSavedFileInspectionPanel, mountSavedFileBatchPanel, mountSavedBatchComparisonPanel } from "/examples/file-read-panel.js";
import { inspectWalletSavedFileBatch, inspectWalletSavedTextBatch, compareWalletSavedTextBatches, encodeWalletSavedBatchComparison } from "/src/file-read-status.js";
import { prepareReportHistoryFile } from "/src/report-history-file.js";
import { sampleHistory } from "/test/helpers/report-history-fixtures.js";
import { createWalletSetupFileReader, prepareWalletSetupFile } from "/src/wallet-setup-file.js";
import { WALLET_SETUP_SCHEMA, WalletSetupError } from "/src/wallet-setup.js";
import { mountWalletSetupPanel } from "/examples/wallet-setup-panel.js";
import { mountWorkspacePanel } from "/examples/workspace-panel.js";
import { prepareWorkspaceFile, createWorkspaceFileReader } from "/src/workspace-file.js";
import { workspaceFromDraft, WorkspaceError } from "/src/workspace-format.js";
import { createPortfolioHistory } from "/src/portfolio-history.js";
import { createHistoryFileReader } from "/src/history-file-reader.js";
import { readSecurityFileBytes } from "/src/security-file.js";
import { mountRehearsalBatchReviewPanel } from "/examples/operation-rehearsal-review-panel.js";
import { savedObservationFixtures } from "/test/helpers/saved-observation-fixtures.js";
import { savedWorkspaceGuideFixtures, savedRehearsalGuideFixtures, savedDifferencePageFixtures } from "/test/helpers/workspace-fixtures.js";

const assert = (value, message = "File boundary UI assertion failed") => { if (!value) throw Error(message); };
const bytes = text => new TextEncoder().encode(text);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const outcome = promise => promise.then(value => ({ value }), error => ({ code: error.code }));

async function isolated(action, options = {}) {
  const service = createFileReadService(options);
  const host = document.createElement("div");
  document.body.append(host);
  const panel = mountFileReadPanel({ document, parent: host, service });
  const pending = [];
  function start(size = 1) {
    const gate = deferred();
    let calls = 0;
    const file = { name: "synthetic.json", size, arrayBuffer() { calls++; return gate.promise; } };
    const result = outcome(service.readText(file));
    const item = { gate, result, calls: () => calls };
    pending.push(item);
    return item;
  }
  try {
    await action({ service, host, panel, start,
      field: name => host.querySelector(".file-read-" + name),
      level: () => host.querySelector(".file-read-panel")?.getAttribute("data-level") });
  } finally {
    panel.dispose(); service.dispose();
    pending.forEach(item => item.gate.resolve(new ArrayBuffer(0)));
    await Promise.all(pending.map(item => item.result));
    host.remove();
    await tick();
  }
}

export function registerFileReadUITests(test) {
  test('plain source bundle: native selection preserves both practice files and refuses altered comparison extraction',async()=>{
    const host=document.createElement('div');document.body.append(host);const before=savedRehearsalGuideFixtures()[0].text,after=JSON.stringify(JSON.parse(before))+'\r\n',downloads=[],panel=mountSavedFileInspectionPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-bundle-'+name),wait=async predicate=>{const end=Date.now()+10000;while(!predicate()&&Date.now()<end)await tick();assert(predicate());},ack=name=>{q(name).checked=true;q(name).dispatchEvent(new Event('change'));},load=async text=>{const files=new DataTransfer();files.items.add(new File([text],'bundle.json'));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));await wait(()=>q('stop').disabled);};
    try{await panel.inspectFile(new File([before],'before.json'));await panel.compareFile(new File([after],'after.json'));assert(!q('export-ack').disabled&&q('export').disabled);ack('export-ack');q('export').click();await wait(()=>q('stop').disabled);const saved=downloads.at(-1).text;assert(JSON.parse(saved).schema==='threecore.saved-file-comparison-bundle.v2');await load(saved);assert(q('output').textContent.includes('内部チェックサムのない'));assert(q('review-save').disabled);ack('review-ack');q('review-save').click();const receipt=JSON.parse(downloads.at(-1).text);assert(receipt.sourceFilesAvailable===true&&receipt.containsOriginalEvidence===false&&!/0x[0-9a-f]{40}/.test(downloads.at(-1).text));ack('source-ack');q('before').click();assert(downloads.at(-1).text===before);assert(q('after').disabled);ack('source-ack');q('after').click();assert(downloads.at(-1).text===after&&downloads.at(-1).internalChecksumVerified===false);const altered=JSON.parse(saved),comparison=JSON.parse(altered.comparisonText);comparison.sourceTextComparison.sameText=true;altered.comparisonText=JSON.stringify(comparison);await load(JSON.stringify(altered));assert(q('before').disabled&&q('after').disabled&&q('output').textContent.includes('不一致'));ack('review-ack');q('review-save').click();assert(JSON.parse(downloads.at(-1).text).comparisonMatchesRecomputation===false);}
    finally{panel.dispose();host.remove();}
  });
  for(const mode of ['pages','filter'])test('saved difference locations: native '+mode+' and scoped export retain source hashes and counts',async()=>{
    const host=document.createElement('div');document.body.append(host);const pair=savedDifferencePageFixtures(),downloads=[],panel=mountSavedFileInspectionPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-differences-'+name),wait=async predicate=>{const end=Date.now()+10000;while(!predicate()&&Date.now()<end)await tick();assert(predicate());},save=name=>{q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q(name).click();};
    try{await panel.inspectFile(new File([pair.before],'before.json'));await panel.compareFile(new File([pair.after],'after.json'));q('start').click();await wait(()=>!q('ack').disabled);if(mode==='pages'){q('next').click();assert(q('output').textContent.includes('41〜80'));save('page-save');const saved=JSON.parse(downloads.at(-1).text);assert(saved.offset===40&&saved.shownDifferences===40&&saved.totalDifferences===86);q('next').click();assert(q('next').disabled&&q('output').textContent.includes('81〜86'));q('previous').click();assert(q('output').textContent.includes('41〜80'));}else{q('path').value='/policy';q('path').dispatchEvent(new Event('input'));assert(q('ack').disabled);q('apply').click();assert(q('output').textContent.includes('絞り込み該当 1件'));save('csv');assert(downloads.at(-1).text.includes('"/policy/paused"'));q('path').value='/missing';q('path').dispatchEvent(new Event('input'));q('apply').click();save('page-save');const saved=JSON.parse(downloads.at(-1).text);assert(saved.totalDifferences===86&&saved.matchedDifferences===0&&saved.shownDifferences===0);assert(q('output').textContent.includes('全体の一致を意味しません'));q('clear-query').click();assert(q('output').textContent.includes('1〜40'));}}
    finally{panel.dispose();host.remove();}
  });
  test('rehearsal file batch: native undecodable file preserves other reviews and exports unknown byte scope',async()=>{
    const response=await fetch('/rehearsal/'),parsed=new DOMParser().parseFromString(await response.text(),'text/html'),host=document.importNode(parsed.querySelector('main'),true);document.body.append(host);const view={getElementById:id=>host.querySelector('#'+CSS.escape(id)),createElement:tag=>document.createElement(tag)},downloads=[],panel=mountRehearsalBatchReviewPanel(view,{download:({prepared})=>downloads.push(prepared)}),q=id=>view.getElementById('report-batch-'+id);
    try{const input=rehearsalExampleV2(),text=encodeRehearsalScenario(input,input),files=new DataTransfer();files.items.add(new File([text],'first.json'));files.items.add(new File([Uint8Array.of(255)],'unreadable.json'));files.items.add(new File([text],'last.json'));q('files').files=files.files;q('files').dispatchEvent(new Event('change'));q('run').click();const end=Date.now()+10000;while(q('status').getAttribute('aria-busy')==='true'&&Date.now()<end)await tick();assert(!q('save').disabled);q('save').click();const saved=JSON.parse(downloads.at(-1).text);assert(saved.schema==='threecore.operation-rehearsal-batch-review.v3'&&saved.summary.matching===2&&saved.summary.sourceUnavailable===1);assert(saved.files[1].byteLength===null&&saved.files[1].reportedByteLength===1);assert(q('manifest').disabled&&q('rows').children[1].querySelector('button').disabled);q('csv').click();assert(downloads.at(-1).text.includes('"sourceUnavailable"'));}
    finally{panel.dispose();host.remove();}
  });
  test('rehearsal file continuation: native Stop and Continue retains the first review and links the saved receipt',async()=>{
    const response=await fetch('/rehearsal/'),parsed=new DOMParser().parseFromString(await response.text(),'text/html'),host=document.importNode(parsed.querySelector('main'),true);document.body.append(host);const view={getElementById:id=>host.querySelector('#'+CSS.escape(id)),createElement:tag=>document.createElement(tag)},downloads=[],reads=[];let release,calls=0;
    const panel=mountRehearsalBatchReviewPanel(view,{subtle:{digest(...args){if(++calls===2)return new Promise(resolve=>{release=resolve;});return crypto.subtle.digest(...args);}},download:({prepared})=>downloads.push(prepared)}),q=id=>view.getElementById('report-batch-'+id),wait=async predicate=>{const end=Date.now()+10000;while(!predicate()&&Date.now()<end)await tick();assert(predicate());};
    try{const input=rehearsalExampleV2(),text=encodeRehearsalScenario(input,input),files=new DataTransfer();for(const name of ['first.json','second.json','third.json']){const file=new File([text],name);file.stream=()=>{reads.push(name);return File.prototype.stream.call(file);};files.items.add(file);}q('files').files=files.files;q('files').dispatchEvent(new Event('change'));q('run').click();await wait(()=>Boolean(release));q('cancel').click();await wait(()=>q('status').getAttribute('aria-busy')==='false');q('save').click();const previous=downloads.at(-1).text;assert(!q('resume').disabled);q('resume').click();await wait(()=>q('status').getAttribute('aria-busy')==='false');q('save').click();const resumed=JSON.parse(downloads.at(-1).text);assert(resumed.complete&&resumed.continuation.retainedReviews===1);assert(reads.join(',')==='first.json,second.json,second.json,third.json');const digest=await crypto.subtle.digest('SHA-256',bytes(previous)),hex=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');assert(resumed.continuation.previousBatchSha256===hex);assert(q('summary').textContent.includes('保持 1件'));release(new ArrayBuffer(32));await tick();assert(q('resume').disabled);}
    finally{release?.(new ArrayBuffer(32));panel.dispose();host.remove();}
  });
  test('saved difference review: native UI verifies saved locations and rejects a changed conclusion',async()=>{
    const host=document.createElement('div');document.body.append(host);const before=savedRehearsalGuideFixtures()[0].text,after=JSON.parse(before);after.policy.maxPerOperation='1';const downloads=[],panel=mountSavedFileInspectionPanel({document,parent:host,download:value=>downloads.push(value)}),q=(prefix,name)=>host.querySelector('.'+prefix+'-'+name),wait=async predicate=>{const end=Date.now()+10000;while(!predicate()&&Date.now()<end)await tick();assert(predicate());},choose=(prefix,name,text)=>{const files=new DataTransfer();files.items.add(new File([text],'selected.json'));const input=q(prefix,name);input.files=files.files;input.dispatchEvent(new Event('change'));},save=prefix=>{q(prefix,'ack').checked=true;q(prefix,'ack').dispatchEvent(new Event('change'));q(prefix,'save').click();};
    try{choose('saved-file-guide','file',before);await wait(()=>!panel.getState().busy);choose('saved-file-guide','compare-file',JSON.stringify(after));await wait(()=>!panel.getState().busy);q('saved-differences','start').click();await wait(()=>!q('saved-difference-review','file').disabled);save('saved-differences');const saved=downloads.at(-1).text;choose('saved-difference-review','file',saved);await wait(()=>!q('saved-difference-review','ack').disabled);assert(q('saved-difference-review','output').textContent.includes('一致しています'));save('saved-difference-review');assert(JSON.parse(downloads.at(-1).text).matchesRecomputation===true);const bad=JSON.parse(saved);bad.parsedJSONValuesMatch=true;choose('saved-difference-review','file',JSON.stringify(bad));await wait(()=>!q('saved-difference-review','ack').disabled);assert(q('saved-difference-review','output').textContent.includes('不一致: JSONの値の一致判定'));}
    finally{panel.dispose();host.remove();}
  });
  test('saved-file differences: native selection re-reads a plain pair and saves locations without values',async()=>{
    const host=document.createElement('div');document.body.append(host);const text=savedRehearsalGuideFixtures()[0].text,changed=JSON.parse(text);changed.policy.maxPerOperation='1';const downloads=[],panel=mountSavedFileInspectionPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-file-guide-'+name),d=name=>host.querySelector('.saved-differences-'+name),wait=async predicate=>{const end=Date.now()+10000;while(!predicate()&&Date.now()<end)await tick();assert(predicate());},choose=async(field,text,name)=>{const files=new DataTransfer();files.items.add(new File([text],name));q(field).files=files.files;q(field).dispatchEvent(new Event('change'));await wait(()=>!panel.getState().busy);};
    try{await choose('file',text,'before.json');await choose('compare-file',JSON.stringify(changed),'after.json');assert(!d('start').disabled&&d('save').disabled);d('start').click();await wait(()=>!d('ack').disabled);assert(d('output').textContent.includes('/policy/maxPerOperation'));assert(!/0x[0-9a-f]{40}/.test(d('output').textContent));d('ack').checked=true;d('ack').dispatchEvent(new Event('change'));d('save').click();const saved=JSON.parse(downloads.at(-1).text);assert(saved.differenceCount===1&&saved.valuesIncluded===false&&saved.restorable===false);await choose('file',text,'replacement.json');assert(d('output').textContent===''&&d('start').disabled);}
    finally{panel.dispose();host.remove();}
  });
  test('saved-file destination: native wallet navigation locates report and workspace sections without wallet requests',async use=>{
    const f=use(),q=name=>document.querySelector('.saved-file-guide-'+name),choose=async(text,name)=>{const files=new DataTransfer();files.items.add(new File([text],name));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));const end=Date.now()+10000;while(q('destination').disabled&&Date.now()<end)await tick();assert(!q('destination').disabled);},target=label=>{const link=[...document.querySelectorAll('.wallet-navigation a')].find(link=>link.textContent===label);return document.getElementById(link.getAttribute('href').slice(1));};
    await choose((await prepareReportHistoryFile(sampleHistory())).text,'history.json');assert(f.calls.length===0);q('destination').click();assert(document.activeElement===target('保存したレポート'));assert(q('destination-status').textContent.includes('まだ読み込んでいません'));
    await choose((await savedWorkspaceGuideFixtures())[0].text,'workspace.json');q('destination').click();assert(document.activeElement===target('3ウォレットの保存・復元'));assert(document.activeElement.classList.contains('workspace-panel'));assert(f.calls.length===0,'Navigation must not request wallet access or state');
  });
  test('plain saved-file comparison: native UI compares exact text and rechecks a saved V2 conclusion',async()=>{
    const host=document.createElement('div');document.body.append(host);const text=savedRehearsalGuideFixtures()[0].text,downloads=[],panel=mountSavedFileInspectionPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-file-guide-'+name),choose=(field,text,name)=>{const files=new DataTransfer();files.items.add(new File([text],name));q(field).files=files.files;q(field).dispatchEvent(new Event('change'));},wait=async()=>{const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();assert(!panel.getState().busy);};
    try{choose('file',text,'before.json');await wait();choose('compare-file',text,'after.json');await wait();assert(panel.getState().comparison?.sourceTextComparison.sameText===true);assert(panel.getState().comparison.sameOriginal===null);assert(q('comparison-output').textContent.includes('SHA-256が一致'));q('comparison-ack').checked=true;q('comparison-ack').dispatchEvent(new Event('change'));q('comparison-save').click();const saved=downloads.at(-1).text;assert(JSON.parse(saved).schema==='threecore.saved-file-comparison.v2');choose('review-file',saved,'comparison.json');await wait();assert(panel.getState().comparisonReview?.matchesRecomputation===true);assert(panel.getState().comparisonReview.originalPairValidated===false);assert(q('review-output').textContent.includes('元JSONの文字列との結び付け'));const altered=JSON.parse(saved);altered.sourceTextComparison.sameText=false;choose('review-file',JSON.stringify(altered),'changed.json');await wait();assert(panel.getState().comparisonReview?.matchesRecomputation===false);}
    finally{panel.dispose();host.remove();}
  });
  test('wallet file continuation: native Stop then Continue retains the checked prefix and saves its receipt link',async()=>{
    const host=document.createElement('div');document.body.append(host);const original=(await prepareReportHistoryFile(sampleHistory())).text,downloads=[],reads=[];let release;
    const panel=mountSavedFileBatchPanel({document,parent:host,download:value=>downloads.push(value),readText(file){reads.push(file.name);return reads.length===2?new Promise(resolve=>{release=resolve;}):file.text();}}),q=name=>host.querySelector('.saved-file-batch-'+name),wait=async predicate=>{const end=Date.now()+10000;while(!predicate()&&Date.now()<end)await tick();assert(predicate());},save=name=>{q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q(name).click();};
    try{const files=new DataTransfer();for(const name of ['first.json','second.json','third.json'])files.items.add(new File([original],name));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));q('start').click();await wait(()=>Boolean(release));q('stop').click();await wait(()=>!panel.getState().busy);const previous=panel.getState().result;save('save');assert(!q('resume').disabled);q('resume').click();await wait(()=>!panel.getState().busy);const result=panel.getState().result;assert(result.complete&&result.files[0]===previous.files[0]&&result.continuation.retainedChecks===1);assert(reads.join(',')==='first.json,second.json,second.json,third.json');assert(q('summary').textContent.includes('前回の結果を保持 1件'));save('save');save('csv');const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(downloads[0].text)),hex=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');assert(JSON.parse(downloads[1].text).continuation.previousBatchSha256===hex);assert(downloads[2].text.includes('"retainedChecks"'));release(original);await tick();assert(panel.getState().result===result);}
    finally{release?.(original);panel.dispose();host.remove();}
  });
  test('rehearsal saved-file guide: native selection distinguishes simulated sources and recalculates rejected records',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],panel=mountSavedFileInspectionPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-file-guide-'+name);
    try{for(const fixture of savedRehearsalGuideFixtures()){const files=new DataTransfer();files.items.add(new File([fixture.text],fixture.name));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();const result=panel.getState().result;assert(result?.validation==='validated-structure'&&result.target===fixture.target&&result.simulationOnly===true);assert(result.scope.rehearsalRejectedRecordReferences===fixture.counts[2]);assert(q('output').textContent.includes('実際の入出金の証拠ではありません'));q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q('save').click();assert(JSON.parse(downloads.at(-1).text).simulationOnly===true);}}
    finally{panel.dispose();host.remove();}
  });
  test('rehearsal saved-file batch: native exports retain simulation labels and hash-bound guidance navigation',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],guide=mountSavedFileInspectionPanel({document,parent:host}),opened=[],panel=mountSavedFileBatchPanel({document,parent:host,download:value=>downloads.push(value),inspectOriginal:async(file,digest)=>{const value=await guide.inspectFile(file,digest);opened.push(value);return value;}}),q=name=>host.querySelector('.saved-file-batch-'+name);
    try{const fixtures=savedRehearsalGuideFixtures(),files=new DataTransfer();for(const fixture of fixtures)files.items.add(new File([fixture.text],fixture.name));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));q('start').click();let end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();const result=panel.getState().result;assert(result?.summary.simulationFiles===5&&result.summary.structureValidated===5&&!result.allOriginalsValidated);assert(q('summary').textContent.includes('練習用 5件'));q('rows').children[4].querySelector('.saved-file-batch-open').click();end=Date.now()+10000;while(!opened.length&&Date.now()<end)await tick();assert(opened[0]===true&&guide.getState().result.scope.rehearsalRejectedRecordReferences===3);for(const name of ['save','csv']){q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q(name).click();}assert(JSON.parse(downloads[0].text).summary.simulationFiles===5);assert(downloads[1].text.includes('"simulationOnly"')&&downloads[1].text.includes('"rehearsalRejectedRecordReferences"'));}
    finally{panel.dispose();guide.dispose();host.remove();}
  });
  test('wallet backup guide: native files keep checksummed workspace and plain history validation distinct',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],panel=mountSavedFileInspectionPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-file-guide-'+name);
    try{for(const fixture of await savedWorkspaceGuideFixtures()){const files=new DataTransfer();files.items.add(new File([fixture.text],fixture.name));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();const result=panel.getState().result;assert(result?.validation===fixture.validation&&result.target===fixture.target);assert(!q('output').textContent.includes('null件'));if(fixture.validation==='validated-structure')assert(q('output').textContent.includes('内部チェックサムはなく'));q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q('save').click();assert(JSON.parse(downloads.at(-1).text).checksumVerified===(fixture.validation==='validated-original'));}}
    finally{panel.dispose();host.remove();}
  });
  test('wallet backup batch: native exports retain structure-only rows without claiming all originals validated',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],panel=mountSavedFileBatchPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-file-batch-'+name);
    try{const fixtures=await savedWorkspaceGuideFixtures(),files=new DataTransfer();for(const fixture of fixtures)files.items.add(new File([fixture.text],fixture.name));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));q('start').click();const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();const result=panel.getState().result;assert(result?.summary.validatedOriginals===1&&result.summary.structureValidated===3&&!result.allOriginalsValidated);assert(q('summary').textContent.includes('内部チェックサムなし 3件'));for(const name of ['save','csv']){q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q(name).click();}assert(JSON.parse(downloads[0].text).files[1].inspection.sourceDigest===null);assert(downloads[1].text.includes('"validated-structure"')&&!downloads[1].text.includes('"null"'));}
    finally{panel.dispose();host.remove();}
  });
  test('wallet observation originals: native file guide handles transfer, balance, allowance and reconciliation sources',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],panel=mountSavedFileInspectionPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-file-guide-'+name);
    try{for(const fixture of await savedObservationFixtures()){const files=new DataTransfer();files.items.add(new File([fixture.text],fixture.name));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();const result=panel.getState().result;assert(result?.validation==='validated-original'&&result.target===fixture.target);assert(!q('output').textContent.includes('null件')&&!q('output').textContent.includes('undefined')&&!q('output').textContent.includes('0x111111'));q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q('save').click();assert(JSON.parse(downloads.at(-1).text).sourceDigest===JSON.parse(fixture.text).digest);}}
    finally{panel.dispose();host.remove();}
  });
  test('wallet observation batch: native selected originals retain per-type scope in saved JSON and CSV',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],panel=mountSavedFileBatchPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-file-batch-'+name);
    try{const fixtures=await savedObservationFixtures(),files=new DataTransfer();for(const fixture of fixtures)files.items.add(new File([fixture.text],fixture.name));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));q('start').click();const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();const result=panel.getState().result;assert(result?.allOriginalsValidated&&result.summary.validatedOriginals===7);assert(result.files.find(row=>row.name==='reconciliation.json').inspection.scope.eventReferences===6);assert(!q('rows').textContent.includes('null件'));for(const name of ['save','csv']){q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q(name).click();}assert(JSON.parse(downloads[0].text).files[4].inspection.scope.allowanceObservationReferences===null);assert(downloads[1].text.includes('"identityObservationReferences"')&&!downloads[1].text.includes('"null"'));}
    finally{panel.dispose();host.remove();}
  });
  test('wallet streaming batch: native undecodable File does not discard other checked originals',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],panel=mountSavedFileBatchPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-file-batch-'+name);
    try{const original=(await prepareReportHistoryFile(sampleHistory())).text,files=new DataTransfer();files.items.add(new File([original],'first.json'));files.items.add(new File([Uint8Array.of(255)],'bad.json'));files.items.add(new File([original],'last.json'));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));q('start').click();const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();assert(!panel.getState().busy);const result=panel.getState().result;assert(result.schema==='threecore.wallet-saved-browser-batch.v3'&&result.summary.validatedOriginals===2&&result.summary.sourceUnavailable===1);assert(result.files[1].code==='FILE_ENCODING'&&result.files[1].byteLength===null&&result.files[1].reportedByteLength===1);q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));assert(q('manifest').disabled);q('save').click();assert(JSON.parse(downloads.pop().text).files[2].status==='validated-original');q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q('csv').click();assert(downloads.pop().text.includes('"bad.json","","source-unavailable"'));}
    finally{panel.dispose();host.remove();}
  });
  test('wallet streaming batch: native stop retains a checked prefix before a stalled reader settles',async()=>{
    const host=document.createElement('div');document.body.append(host);let release,reads=0;const original=(await prepareReportHistoryFile(sampleHistory())).text,panel=mountSavedFileBatchPanel({document,parent:host,readText(file,options){if(++reads===2){Object.defineProperty(options.signal,"aborted",{value:false});return new Promise(r=>{release=r;});}return Promise.resolve(original);}}),q=name=>host.querySelector('.saved-file-batch-'+name);
    try{const files=new DataTransfer();files.items.add(new File([original],'first.json'));files.items.add(new File([original],'stalled.json'));files.items.add(new File([original],'pending.json'));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));q('start').click();let end=Date.now()+10000;while(!release&&Date.now()<end)await tick();assert(Boolean(release));q('stop').click();end=Date.now()+1000;while(panel.getState().busy&&Date.now()<end)await tick();assert(!panel.getState().busy);const result=panel.getState().result;assert(result.phase==='cancelled'&&result.summary.checked===1&&result.summary.pending===2);assert(result.files[1].byteLength===null&&result.files[1].sha256===null&&reads===2);release(original);await tick();assert(panel.getState().result===result);}
    finally{release?.(original);panel.dispose();host.remove();}
  });
  test('wallet batch navigation: native row actions open and compare hash-bound originals without selecting files again',async()=>{
    const host=document.createElement('div');document.body.append(host);const panel=mountFileReadPanel({document,parent:host}),q=name=>host.querySelector('.saved-file-batch-'+name),g=name=>host.querySelector('.saved-file-guide-'+name),waitFor=async condition=>{const end=Date.now()+10000;while(!condition()&&Date.now()<end)await tick();assert(condition());};
    try{const original=(await prepareReportHistoryFile(sampleHistory())).text,formatted=JSON.stringify(JSON.parse(original),null,2),files=new DataTransfer();files.items.add(new File([original],'history.json'));files.items.add(new File([formatted],'formatted.json'));files.items.add(new File(['{"schema":"threecore.saved-file-inspection.v1"}'],'auxiliary.json'));host.querySelector('.saved-file-batch').open=true;q('file').files=files.files;q('file').dispatchEvent(new Event('change'));q('start').click();await waitFor(()=>!q('start').disabled);const rows=q('rows').children,summary=q('summary').textContent;assert(rows[2].querySelector('.saved-file-batch-open').disabled);rows[0].querySelector('.saved-file-batch-open').click();await waitFor(()=>q('export-status').textContent.includes('詳細確認を上の案内欄に開きました'));assert(host.querySelector('.saved-file-guide').open);assert(document.activeElement===g('heading'));rows[1].querySelector('.saved-file-batch-compare').click();await waitFor(()=>g('comparison-output').textContent.includes('書式に違い'));assert(host.querySelector('.saved-file-guide-comparison').open);assert(q('summary').textContent===summary);assert(g('comparison-save').disabled);q('clear').click();assert(g('comparison-output').textContent.includes('書式に違い'));}
    finally{panel.dispose();host.remove();}
  });
  test('wallet batch comparison: native sequential selections preserve baseline and distinguish formatting from omission',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],panel=mountSavedFileBatchPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-file-batch-'+name),c=name=>host.querySelector('.saved-batch-comparison-'+name),choose=values=>{const files=new DataTransfer();for(const[name,text]of values)files.items.add(new File([text],name));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));},run=async()=>{q('start').click();const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();assert(!panel.getState().busy);};
    try{const original=(await prepareReportHistoryFile(sampleHistory())).text;choose([['history.json',original],['omitted.json',original]]);await run();c('hold').click();choose([['history.json',JSON.stringify(JSON.parse(original),null,2)],['added.json',original]]);assert(c('json').disabled&&c('baseline').textContent.includes('比較元を保持'));await run();assert(c('rows').children.length===3);assert(c('summary').textContent.includes('書式だけの違い 1件'));assert(c('summary').textContent.includes('比較元だけ 1件'));c('ack').checked=true;c('ack').dispatchEvent(new Event('change'));c('json').click();const saved=JSON.parse(downloads.pop().text);assert(saved.summary.onlyBefore===1&&saved.summary.onlyAfter===1&&saved.summary.formatOnly===1);assert(saved.reportsFilesystemDeletions===false);q('clear').click();assert(c('baseline').textContent.includes('比較元を保持'));c('clear').click();assert(c('baseline').textContent.includes('まだ保持していません'));}
    finally{panel.dispose();host.remove();}
  });
  test('wallet batch comparison review: native file detects altered conclusions and saves a separately acknowledged review',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],panel=mountSavedBatchComparisonPanel({document,parent:host,download:value=>downloads.push(value)}),q=name=>host.querySelector('.saved-batch-comparison-'+name),idle=async()=>{const end=Date.now()+10000;while(panel.getState().reviewing&&Date.now()<end)await tick();assert(!panel.getState().reviewing);},choose=text=>{const files=new DataTransfer();files.items.add(new File([text],'comparison.json'));q('review-file').files=files.files;q('review-file').dispatchEvent(new Event('change'));};
    try{const original=(await prepareReportHistoryFile(sampleHistory())).text,before=await inspectWalletSavedTextBatch([{name:'history.json',text:original}]),after=await inspectWalletSavedTextBatch([{name:'history.json',text:JSON.stringify(JSON.parse(original),null,2)}]),comparison=encodeWalletSavedBatchComparison(compareWalletSavedTextBatches(before,after));panel.updateCurrent(before);q('hold').click();panel.updateCurrent(after);choose(comparison);await idle();assert(panel.getState().reviewed.matchesRecomputation&&!panel.getState().reviewed.allSelectedOriginalsIdentical);assert(q('review-status').textContent.includes('全件一致したという意味ではありません'));const changed=JSON.parse(comparison);changed.allSelectedOriginalsIdentical=true;choose(JSON.stringify(changed));await idle();assert(!panel.getState().reviewed.matchesRecomputation);q('review-ack').checked=true;q('review-ack').dispatchEvent(new Event('change'));q('review-save').click();const saved=JSON.parse(downloads.pop().text);assert(saved.matchesRecomputation===false&&saved.differences.includes('allSelectedOriginalsIdentical'));assert(!q('review-ack').checked);q('clear').click();assert(q('review-save').disabled&&panel.getState().reviewed===null);}
    finally{panel.dispose();host.remove();}
  });
  test('wallet saved reference: native list upload binds every source and retains mismatches on export',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],panel=mountSavedFileBatchPanel({document,parent:host,download:prepared=>downloads.push(prepared)}),q=name=>host.querySelector('.saved-file-batch-'+name),idle=async()=>{const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();assert(!panel.getState().busy);};
    try{const original=await prepareReportHistoryFile(sampleHistory()),sources=new DataTransfer();sources.items.add(new File([original.text],'history.json'));q('file').files=sources.files;q('file').dispatchEvent(new Event('change'));const reference='0'.repeat(64)+'  history.json\n',list=new DataTransfer();list.items.add(new File([reference],'SHA256SUMS.txt'));q('reference-file').files=list.files;q('reference-file').dispatchEvent(new Event('change'));await idle();assert(panel.getState().result===null&&q('reference-text').value===reference);q('start').click();await idle();assert(panel.getState().result.files[0].status==='checksum-mismatch');assert(q('rows').textContent.includes('以前の照合値と不一致'));q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q('save').click();const receipt=JSON.parse(downloads.pop().text);assert(receipt.reference.text===reference&&receipt.allExternalChecksumsMatch===false);q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q('manifest').click();const current=downloads.pop();assert(current.filename==='ThreeCore-selected-content-SHA256SUMS.txt');assert(current.text!==reference&&q('reference-text').value===reference);q('reference-text').value='';q('reference-text').dispatchEvent(new Event('input'));assert(q('start').disabled&&panel.getState().result===null);q('reference-clear').click();assert(!q('start').disabled);q('start').click();await idle();assert(panel.getState().result.schema==='threecore.wallet-saved-browser-batch.v1'&&panel.getState().result.allOriginalsValidated);}
    finally{panel.dispose();host.remove();}
  });
  test('wallet saved CSV: native cancelled batch export includes every pending and checked row',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],q=name=>host.querySelector('.saved-file-batch-'+name);let panel;panel=mountSavedFileBatchPanel({document,parent:host,download:prepared=>downloads.push(prepared),inspectFiles:(rows,readSource,options)=>inspectWalletSavedFileBatch(rows,readSource,{...options,onProgress:p=>{options.onProgress(p);if(p.checked===1)q('stop').click();}})});
    try{const original=await prepareReportHistoryFile(sampleHistory()),files=new DataTransfer();files.items.add(new File([original.text],'=first.json'));files.items.add(new File([original.text],'pending.json'));q('file').files=files.files;q('file').dispatchEvent(new Event('change'));q('start').click();const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();assert(!panel.getState().busy);assert(q('csv').disabled);q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q('csv').click();const saved=downloads.pop();assert(saved.filename==='ThreeCore-wallet-saved-batch.csv'&&saved.text.startsWith('\uFEFF'));assert(saved.text.includes('"\'=first.json"')&&saved.text.includes('"pending.json"'));assert(saved.text.includes('"cancelled"')&&saved.text.includes('"pending"'));assert(saved.text.trimEnd().split('\r\n').length===3);assert(!q('ack').checked&&q('csv').disabled&&q('manifest').disabled);}
    finally{panel.dispose();host.remove();}
  });
  test('wallet saved batch: native multiple originals keep auxiliary declarations separate and export compatible hashes',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[],panel=mountSavedFileBatchPanel({document,parent:host,download:prepared=>downloads.push(prepared)}),q=name=>host.querySelector('.saved-file-batch-'+name),key='threecore-saved-batch-'+crypto.randomUUID();localStorage.setItem(key,'unchanged');
    try{const original=await prepareReportHistoryFile(sampleHistory()),inputs=[['history.json',original.text],['auxiliary.json','{"schema":"threecore.saved-file-inspection.v1","checksumVerified":true}'],['broken.json','{']],files=new DataTransfer();for(const[name,text]of inputs)files.items.add(new File([text],name));host.querySelector('details').open=true;q('file').files=files.files;q('file').dispatchEvent(new Event('change'));assert(panel.getState().result===null,'explicit start');q('start').click();const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();assert(!panel.getState().busy,'batch finished');const result=panel.getState().result;assert(result.summary.validatedOriginals===1&&result.summary.declaredOnly===1&&result.summary.invalid===1);assert(q('rows').children.length===3&&q('rows').textContent.includes('補助資料'));
      q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q('save').click();assert(JSON.parse(downloads.pop().text).externalChecksumsCompared===false);assert(!q('ack').checked);q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));q('manifest').click();const manifest=downloads.pop();assert(manifest.filename==='SHA256SUMS.txt');for(const[name,text]of inputs){const digest=await crypto.subtle.digest('SHA-256',bytes(text)),hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');assert(manifest.text.includes(hex+'  '+name+'\n'));}assert(localStorage.getItem(key)==='unchanged');q('clear').click();assert(q('save').disabled&&q('rows').children.length===0);
    }finally{panel.dispose();host.remove();localStorage.removeItem(key);}
  });
  test('wallet saved batch: native stop keeps a partial JSON receipt and refuses an incomplete checksum list',async()=>{
    const host=document.createElement('div');document.body.append(host);const downloads=[];let panel;const q=name=>host.querySelector('.saved-file-batch-'+name);
    panel=mountSavedFileBatchPanel({document,parent:host,download:prepared=>downloads.push(prepared),inspectFiles:(rows,readSource,options)=>inspectWalletSavedFileBatch(rows,readSource,{...options,onProgress:p=>{options.onProgress(p);if(p.checked===1)q('stop').click();}})});
    try{const original=await prepareReportHistoryFile(sampleHistory()),files=new DataTransfer();files.items.add(new File([original.text],'first.json'));files.items.add(new File([original.text],'second.json'));host.querySelector('details').open=true;q('file').files=files.files;q('file').dispatchEvent(new Event('change'));q('start').click();const end=Date.now()+10000;while(panel.getState().busy&&Date.now()<end)await tick();assert(!panel.getState().busy);const result=panel.getState().result;assert(result.phase==='cancelled'&&result.summary.checked===1&&result.summary.pending===1);q('ack').checked=true;q('ack').dispatchEvent(new Event('change'));assert(!q('save').disabled&&q('manifest').disabled);q('save').click();assert(JSON.parse(downloads.pop().text).files[1].status==='pending');}
    finally{panel.dispose();host.remove();}
  });
  test('rehearsal batch detail: native selection hands exact source and earlier checksum to independent review',async()=>{
    const response=await fetch('/rehearsal/'),parsed=new DOMParser().parseFromString(await response.text(),'text/html'),host=document.importNode(parsed.querySelector('main'),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector('#'+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const idle=async id=>{const end=Date.now()+10000;while(q(id).getAttribute('aria-busy')==='true'&&Date.now()<end)await tick();assert(q(id).getAttribute('aria-busy')==='false');};
    try{
      q('example').click();q('session-save').click();const original=downloads.pop().text;q('record-browser-save').click();const good=downloads.pop().text,changed=JSON.parse(good);changed.matchedRecords=999;const text=JSON.stringify(changed,null,2).replaceAll('\n','\r\n')+'\r\n';
      const files=new DataTransfer();files.items.add(new File([text],'detail.json'));q('report-batch-files').closest('details').open=true;q('report-batch-files').files=files.files;q('report-batch-files').dispatchEvent(new Event('change'));
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(good))),b=>b.toString(16).padStart(2,'0')).join('');q('report-batch-reference-text').value=hash+'  detail.json\n';q('report-batch-reference-text').dispatchEvent(new Event('input'));q('report-batch-run').click();await idle('report-batch-status');const summary=q('report-batch-summary').textContent;
      q('report-batch-rows').querySelector('button').click();await idle('report-review-status');assert(document.activeElement===q('report-review-title'));assert(q('report-review-summary').textContent.includes('照合値: 不一致'));assert(!q('report-review-differences').textContent.includes('undefined'));assert(q('report-review-differences').textContent.includes('/matchedRecords'));assert(q('report-review-workspace-save').disabled);assert(q('report-batch-summary').textContent===summary);
      q('report-review-source-save').click();assert(downloads.pop().text===text);q('session-save').click();assert(downloads.pop().text===original);
      q('report-batch-clear').click();assert(!q('report-review-source-save').disabled);
    }finally{page.dispose();host.remove();}
  });
  test('rehearsal batch CSV: native download keeps every selected filename and original receipt scope',async()=>{
    const response=await fetch('/rehearsal/'),parsed=new DOMParser().parseFromString(await response.text(),'text/html'),host=document.importNode(parsed.querySelector('main'),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector('#'+CSS.escape(id)),createElement:tag=>document.createElement(tag)},downloads=[];
    const panel=mountRehearsalBatchReviewPanel(view,{download:({prepared})=>downloads.push(prepared)}),q=id=>view.getElementById('report-batch-'+id);
    try{const input=rehearsalExampleV2(),text=encodeRehearsalScenario(input,input),files=new DataTransfer();files.items.add(new File([text],'=source.json'));files.items.add(new File(['{}'],'形式外.json'));q('files').closest('details').open=true;q('files').files=files.files;q('files').dispatchEvent(new Event('change'));q('run').click();const end=Date.now()+10000;while(q('status').getAttribute('aria-busy')==='true'&&Date.now()<end)await tick();
      q('csv').click();const csv=downloads.pop();assert(csv.filename==='ThreeCore-report-batch-summary.csv'&&csv.text.startsWith('\ufeff')&&csv.text.split('\r\n').length===4);assert(csv.text.includes("'=source.json")&&csv.text.includes('形式外.json')&&csv.text.includes('"unsupported"'));q('save').click();const saved=JSON.parse(downloads.pop().text);assert(saved.summary.selected===2&&saved.files[0].name==='=source.json');
    }finally{panel.dispose();host.remove();}
  });
  test('rehearsal batch: previous native checksum file detects changed bytes without replacing the reference',async()=>{
    const response=await fetch('/rehearsal/'),parsed=new DOMParser().parseFromString(await response.text(),'text/html'),host=document.importNode(parsed.querySelector('main'),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector('#'+CSS.escape(id)),createElement:tag=>document.createElement(tag)},downloads=[];
    const panel=mountRehearsalBatchReviewPanel(view,{download:({prepared})=>downloads.push(prepared)}),q=id=>view.getElementById('report-batch-'+id);
    const select=(id,files)=>{const transfer=new DataTransfer();for(const file of files)transfer.items.add(file);q(id).files=transfer.files;q(id).dispatchEvent(new Event('change'));};
    const idle=async id=>{const end=Date.now()+10000;while(q(id).getAttribute('aria-busy')==='true'&&Date.now()<end)await tick();assert(q(id).getAttribute('aria-busy')==='false');};
    try{
      const input=rehearsalExampleV2(),text=encodeRehearsalScenario(input,{...input,policy:{...input.policy,paused:true}}),digest=await crypto.subtle.digest('SHA-256',bytes(text)),hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join(''),reference=hex+'  original.json\n';
      q('files').closest('details').open=true;select('reference-file',[new File([reference],'SHA256SUMS.txt')]);await idle('reference-status');
      select('files',[new File([text+'\n'],'original.json')]);assert(!q('run').disabled);q('run').click();await idle('status');q('save').click();
      const result=JSON.parse(downloads.pop().text);assert(result.schema==='threecore.operation-rehearsal-batch-review.v2'&&result.files[0].status==='checksum-mismatch'&&result.files[0].differenceCount===null&&result.reference.text===reference);
      assert(q('rows').textContent.includes('再計算は未実施'));q('manifest').click();assert(downloads.pop().filename==='ThreeCore-selected-content-SHA256SUMS.txt');assert(q('reference-text').value===reference);
      q('reference-clear').click();assert(!q('run').disabled);q('run').click();await idle('status');q('save').click();const without=JSON.parse(downloads.pop().text);assert(without.schema==='threecore.operation-rehearsal-batch-review.v1'&&without.files[0].status==='matched');
    }finally{panel.dispose();host.remove();}
  });
  test('rehearsal batch: native multiple files retain exact hashes, failures and the original session',async()=>{
    const response=await fetch('/rehearsal/'),parsed=new DOMParser().parseFromString(await response.text(),'text/html'),host=document.importNode(parsed.querySelector('main'),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector('#'+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    try{
      q('example').click();q('session-save').click();const original=downloads.pop().text;
      q('record-browser-save').click();const good=downloads.pop().text,changed=JSON.parse(good);changed.matchedRecords=999;
      const before=rehearsalExampleV2(),suite=structuredClone(captureRehearsalCheckSuite({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:'same',label:'Same',before,after:before}]}));
      suite.expectationOrigin='manually-specified';suite.expected[0].before.metrics.cash='999';
      const inputs=[['元資料.json',good],['changed.json',JSON.stringify(changed)],['invalid.json','{oops'],['expectations.json',encodeRehearsalCheckReport(suite)]];
      const transfer=new DataTransfer();for(const[name,text]of inputs)transfer.items.add(new File([text],name,{type:'application/json'}));
      q('report-batch-files').closest('details').open=true;q('report-batch-files').files=transfer.files;q('report-batch-files').dispatchEvent(new Event('change'));
      assert(!q('report-batch-run').disabled&&q('report-batch-save').disabled);q('report-batch-run').click();const end=Date.now()+10000;
      while(q('report-batch-status').getAttribute('aria-busy')==='true'&&Date.now()<end)await tick();
      assert(!q('report-batch-save').disabled&&q('report-batch-rows').children.length===4);q('report-batch-save').click();const receipt=JSON.parse(downloads.pop().text);
      assert(receipt.complete&&receipt.summary.matching===2&&receipt.summary.differing===1&&receipt.summary.invalid===1&&receipt.summary.reportsWithFailedExpectations===1);
      q('report-batch-manifest').click();const manifest=downloads.pop();assert(manifest.filename==='SHA256SUMS.txt');
      for(const[name,text]of inputs){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)),hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');assert(manifest.text.includes(hex+'  '+name+'\n'));}
      q('session-save').click();assert(downloads.pop().text===original);q('report-batch-clear').click();assert(q('report-batch-save').disabled&&q('report-batch-manifest').disabled);
    }finally{page.dispose();host.remove();}
  });
  test('rehearsal batch: native cancel preserves checked rows and ignores a late digest',async()=>{
    const response=await fetch('/rehearsal/'),parsed=new DOMParser().parseFromString(await response.text(),'text/html'),host=document.importNode(parsed.querySelector('main'),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector('#'+CSS.escape(id)),createElement:tag=>document.createElement(tag)},downloads=[];let calls=0,release;
    const panel=mountRehearsalBatchReviewPanel(view,{download:({prepared})=>downloads.push(prepared),subtle:{digest(...args){calls++;return calls===2?new Promise(resolve=>{release=resolve;}):crypto.subtle.digest(...args);}}}),q=id=>view.getElementById('report-batch-'+id);
    try{
      const input=rehearsalExampleV2(),text=encodeRehearsalScenario(input,{...input,policy:{...input.policy,paused:true}}),transfer=new DataTransfer();
      transfer.items.add(new File([text],'first.json'));transfer.items.add(new File([text],'second.json'));q('files').closest('details').open=true;q('files').files=transfer.files;q('files').dispatchEvent(new Event('change'));q('run').click();let end=Date.now()+10000;
      while(calls<2&&Date.now()<end)await tick();assert(calls===2);q('cancel').click();end=Date.now()+10000;
      while(q('status').getAttribute('aria-busy')==='true'&&Date.now()<end)await tick();assert(!q('save').disabled&&q('manifest').disabled);
      q('save').click();const result=JSON.parse(downloads.pop().text);assert(result.phase==='cancelled'&&result.summary.reviewed===1&&result.summary.pending===1);
      const summary=q('summary').textContent;release(new Uint8Array(32).buffer);await tick();assert(q('summary').textContent===summary);
    }finally{release?.(new Uint8Array(32).buffer);panel.dispose();host.remove();}
  });
  test('rehearsal query reuse: verified older criteria search current inputs without restoring older settlements',async()=>{
    const response=await fetch('/rehearsal/'),parsed=new DOMParser().parseFromString(await response.text(),'text/html'),host=document.importNode(parsed.querySelector('main'),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector('#'+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    try{q('example').click();q('agent').value='EMA';q('agent').dispatchEvent(new Event('change'));q('example').click();
      q('record-browser-agent').value='EMA';q('record-browser-agent').dispatchEvent(new Event('change'));q('record-browser-kind').value='settle';q('record-browser-kind').dispatchEvent(new Event('change'));q('record-browser-save').click();const old=downloads.pop().text;assert(JSON.parse(old).matchedRecords===1);
      q('scenario').value='pending';q('example').click();q('record-browser-clear').click();q('session-save').click();const current=downloads.pop().text;
      q('report-review-text').value=old;q('report-review-text').dispatchEvent(new Event('input'));q('report-review-paste').click();const end=Date.now()+10000;
      while(q('report-review-status').getAttribute('aria-busy')==='true'&&Date.now()<end)await tick();assert(!q('report-review-query-apply').disabled);
      q('report-review-query-apply').click();assert(q('record-browser-agent').value==='EMA'&&q('record-browser-kind').value==='settle');assert(q('record-browser-status').textContent.includes('一致 0件'));
      assert(q('report-review-query-status').textContent.includes('現在の履歴から再計算'));assert(document.activeElement===q('record-browser-search'));
      q('record-browser-save').click();const fresh=JSON.parse(downloads.pop().text);assert(fresh.matchedRecords===0&&fresh.inputs.ledgers.find(row=>row.agent==='EMA').events.length===1);
      q('session-save').click();assert(downloads.pop().text===current);q('report-review-clear').click();assert(q('report-review-query-apply').disabled);
    }finally{page.dispose();host.remove();}
  });
  for(const mode of ['summary','prefix'])test('rehearsal record analysis: '+mode+' exports recomputable data without changing the session',async()=>{
    const response=await fetch('/rehearsal/'),parsed=new DOMParser().parseFromString(await response.text(),'text/html'),host=document.importNode(parsed.querySelector('main'),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector('#'+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    try{q('example').click();q('agent').value='EMA';q('agent').dispatchEvent(new Event('change'));q('scenario').value='pending';q('example').click();q('session-save').click();const current=downloads.pop().text;let text;
      if(mode==='summary'){
        q('record-browser-kind').value='settle';q('record-browser-kind').dispatchEvent(new Event('change'));assert(q('record-browser-summary').textContent.includes('DAT: 一致 1件'));assert(q('record-browser-summary').textContent.includes('CAWELON: 未作成'));
        q('record-browser-summary-csv-save').click();const csv=downloads.pop();assert(csv.text.startsWith('\uFEFF')&&csv.mimeType==='text/csv;charset=utf-8');
        q('record-browser-summary-save').click();text=downloads.pop().text;const data=JSON.parse(text);assert(data.rows[0].balanceChanges.cash==='129000000'&&data.rows[1].balanceChanges.cash==='0'&&data.rows[2].balanceChanges.cash===null);
      }else{
        q('record-browser-select').value='DAT:open-one';q('record-browser-select').dispatchEvent(new Event('change'));assert(q('record-browser-prefix-note').textContent.includes('後続1件'));
        q('record-browser-prefix-save').click();const input=JSON.parse(downloads.pop().text);assert(input.agent==='DAT'&&input.events.length===1&&input.events[0].id==='open-one');
        q('record-browser-prefix-report-save').click();text=downloads.pop().text;const data=JSON.parse(text);assert(data.inputs.ledgers.length===2&&data.includedRecords===1&&data.result.openPositions===1);
      }
      q('session-save').click();assert(downloads.pop().text===current);
      q('report-review-text').value=text;q('report-review-text').dispatchEvent(new Event('input'));q('report-review-paste').click();const end=Date.now()+10000;
      while(q('report-review-status').getAttribute('aria-busy')==='true'&&Date.now()<end)await tick();assert(q('report-review-status').getAttribute('aria-busy')==='false'&&q('report-review-status').textContent.includes('再計算と一致'));
      if(mode==='prefix'){q('report-review-input-part').value='record-prefix';q('report-review-input-part').dispatchEvent(new Event('change'));q('report-review-input-save').click();assert(JSON.parse(downloads.pop().text).events.length===1);}
      q('session-save').click();assert(downloads.pop().text===current);
    }finally{page.dispose();host.remove();}
  });
  for(const kind of ['workspace','scenario','scenario-set','check-suite'])test('rehearsal source parts: '+kind+' requires explicit selection and preserves current session',async()=>{
    const before=rehearsalExampleV2(),after={...before,policy:{...before.policy,paused:true}},workspace={schema:REHEARSAL_WORKSPACE_SCHEMA,simulationOnly:true,activeAgent:'DAT',ledgers:[before]},nextWorkspace={...workspace,ledgers:[after]};
    const cases={schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:'paused',label:'停止条件',before,after}]};
    const suite=structuredClone(captureRehearsalCheckSuite(cases));suite.expectationOrigin='manually-specified';suite.expected[0].before.metrics.cash='999';
    const sample={workspace:{text:encodeRehearsalComparison(workspace,nextWorkspace),part:'workspace-after',output:encodeRehearsalWorkspace(nextWorkspace)},
      scenario:{text:encodeRehearsalScenario(before,after),part:'scenario-after',output:encodeRehearsal(after)},
      'scenario-set':{text:encodeRehearsalScenarioSetReport(cases),part:'scenario-set',output:encodeRehearsalScenarioSet(cases)},
      'check-suite':{text:encodeRehearsalCheckReport(suite),part:'check-suite',output:encodeRehearsalCheckSuite(suite)}}[kind];
    const response=await fetch('/rehearsal/'),parsed=new DOMParser().parseFromString(await response.text(),'text/html'),host=document.importNode(parsed.querySelector('main'),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector('#'+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    try{q('example').click();q('session-save').click();const current=downloads.pop().text;
      q('report-review-text').value=sample.text;q('report-review-text').dispatchEvent(new Event('input'));q('report-review-paste').click();
      const end=Date.now()+10000;while(q('report-review-status').getAttribute('aria-busy')==='true'&&Date.now()<end)await tick();assert(q('report-review-status').getAttribute('aria-busy')==='false');
      assert(q('report-review-input-part').value===''&&q('report-review-input-save').disabled);q('report-review-input-part').value=sample.part;q('report-review-input-part').dispatchEvent(new Event('change'));
      assert(!q('report-review-input-save').disabled&&q('report-review-input-note').textContent.includes('読み込む場所'));q('report-review-input-save').click();const file=downloads.pop();assert(file.text===sample.output&&file.filename==='ThreeCore-recovered-'+sample.part+'.json');
      if(kind==='check-suite'){assert(q('report-review-status').textContent.includes('期待結果との差'));assert(JSON.parse(file.text).expected[0].before.metrics.cash==='999');}
      q('session-save').click();assert(downloads.pop().text===current);q('report-review-clear').click();assert(q('report-review-input-recovery').hidden&&q('report-review-input-save').disabled);
    }finally{page.dispose();host.remove();}
  });
  for(const mode of ['agent','comparison'])test('rehearsal reviewed inputs: '+mode+' action leaves newer current session unchanged',async()=>{
    const response=await fetch('/rehearsal/'),parsed=new DOMParser().parseFromString(await response.text(),'text/html'),host=document.importNode(parsed.querySelector('main'),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector('#'+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const agent=value=>{q('agent').value=value;q('agent').dispatchEvent(new Event('change'));};
    async function review(text){q('report-review-text').value=text;q('report-review-text').dispatchEvent(new Event('input'));q('report-review-paste').click();
      const end=Date.now()+10000;while(q('report-review-status').getAttribute('aria-busy')==='true'&&Date.now()<end)await tick();assert(q('report-review-status').getAttribute('aria-busy')==='false');}
    try{q('example').click();agent('EMA');q('scenario').value='pending';q('example').click();
      q('record-browser-agent').value='DAT';q('record-browser-agent').dispatchEvent(new Event('change'));q('record-browser-save').click();const report=downloads.pop().text;
      agent('CAWELON');q('scenario').value='loss';q('example').click();q('session-save').click();const current=downloads.pop().text;await review(report);
      if(mode==='agent'){
        assert(Array.from(q('report-review-agent-select').options).map(o=>o.value).join(',')==='DAT,EMA');q('report-review-agent-select').value='EMA';q('report-review-agent-save').click();
        const file=downloads.pop(),input=JSON.parse(file.text);assert(file.filename==='ThreeCore-EMA-recovered-rehearsal.json'&&input.agent==='EMA'&&input.events.length===1);
      }else{
        q('report-review-workspace-compare').click();assert(!q('report-review-workspace-comparison').hidden);
        assert(q('report-review-workspace-comparison-details').textContent.includes('現在側だけにある'));assert(!q('report-review-workspace-comparison-details').textContent.includes('履歴を消去する'));
        q('report-review-workspace-comparison-save').click();const comparison=downloads.pop();const data=JSON.parse(comparison.text);
        assert(data.inputs.before.ledgers.length===3&&data.inputs.after.ledgers.length===2&&data.inputs.after.activeAgent==='EMA');
        q('session-save').click();assert(downloads.pop().text===current);q('scenario').value='profit';q('example').click();assert(q('report-review-workspace-comparison-save').disabled);
        assert(!q('report-review-agent-save').disabled);await review(comparison.text);assert(q('report-review-status').textContent.includes('一致'));return;
      }
      q('session-save').click();assert(downloads.pop().text===current,'Viewing or extracting old inputs must not restore the session');
    }finally{page.dispose();host.remove();}
  });
  test("rehearsal reference CSV: includes hidden settlement and retires when the selected reference disappears",async()=>{
    const response=await fetch("/rehearsal/"),parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    try{q("example").click();q("session-save").click();const before=downloads.pop().text;
      q("record-browser-search").value="open-one";q("record-browser-search").dispatchEvent(new Event("input"));
      assert(q("record-browser-rows").children.length===1);q("record-browser-reference-csv-save").click();const file=downloads.pop();
      assert(file.mimeType==="text/csv;charset=utf-8"&&file.text.startsWith("\uFEFF"));
      const rows=file.text.slice(1,-2).split("\r\n").map(line=>JSON.parse("["+line+"]"));assert(rows.length===3);
      assert(rows[2][rows[0].indexOf("recordId")]==="settle-one");assert(rows[1][rows[0].indexOf("realizedPnlUnits")]==="28000000");
      q("record-browser-search").value="absent";q("record-browser-search").dispatchEvent(new Event("input"));assert(q("record-browser-reference-csv-save").disabled);
      q("session-save").click();assert(downloads.pop().text===before);
    }finally{page.dispose();host.remove();}
  });
  test("rehearsal reviewed workspace: extracts all original inputs without applying them to the newer live session",async()=>{
    const response=await fetch("/rehearsal/"),parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const agent=value=>{q("agent").value=value;q("agent").dispatchEvent(new Event("change"));};
    async function review(text){q("report-review-text").value=text;q("report-review-text").dispatchEvent(new Event("input"));q("report-review-paste").click();
      const end=Date.now()+10000;while(q("report-review-status").getAttribute("aria-busy")==="true"&&Date.now()<end)await tick();assert(q("report-review-status").getAttribute("aria-busy")==="false");}
    try{q("example").click();agent("EMA");q("scenario").value="pending";q("example").click();
      q("record-browser-agent").value="DAT";q("record-browser-agent").dispatchEvent(new Event("change"));q("record-browser-save").click();const report=downloads.pop().text;
      agent("CAWELON");q("scenario").value="loss";q("example").click();q("session-save").click();const current=downloads.pop().text;
      await review(report);assert(!q("report-review-workspace-save").disabled&&!q("report-review-workspace-save").hidden);
      q("report-review-workspace-save").click();const recovered=JSON.parse(downloads.pop().text);assert(recovered.ledgers.length===2&&recovered.activeAgent==="EMA");
      q("session-save").click();assert(downloads.pop().text===current,"Extracting an older workspace must not restore it automatically");
      const altered=JSON.parse(report);altered.matchedRecords=999;await review(JSON.stringify(altered));assert(q("report-review-workspace-save").disabled&&q("report-review-workspace-save").hidden);
    }finally{page.dispose();host.remove();}
  });
  test("rehearsal exact reason: structured reason filters, navigation Back and independent report review preserve the original session",async()=>{
    const response=await fetch("/rehearsal/"),parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const change=(id,value)=>{q(id).value=value;q(id).dispatchEvent(new Event(id==="record-browser-search"?"input":"change"));};
    try{
      q("scenario").value="limit";q("example").click();q("session-save").click();const before=downloads.pop().text;
      change("record-browser-reason","PER_OPERATION_LIMIT");assert(q("record-browser-status").textContent.includes("一致 1件"));
      change("record-browser-decision","accepted");assert(q("record-browser-status").textContent.includes("一致 0件")&&q("record-browser-decision").value==="accepted");
      change("record-browser-decision","all");q("record-browser-save").click();const text=downloads.pop().text;
      const button=q("overview-rows").querySelector("button");button.click();assert(q("record-browser-reason").value==="all");q("record-browser-back").click();assert(q("record-browser-reason").value==="PER_OPERATION_LIMIT");
      q("report-review-text").value=text;q("report-review-text").dispatchEvent(new Event("input"));q("report-review-paste").click();
      const end=Date.now()+10000;while(q("report-review-status").getAttribute("aria-busy")==="true"&&Date.now()<end)await tick();
      assert(q("report-review-status").className==="passed");assert(q("report-review-outcome").textContent.includes("1回の上限超過"));
      q("session-save").click();assert(downloads.pop().text===before);
    }finally{page.dispose();host.remove();}
  });

  test("rehearsal overview: opens an exact pending record and restores the previous empty search without changing history",async()=>{
    const response=await fetch("/rehearsal/"),parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window};
    const page=mountOperationRehearsal(view,()=>{}),q=id=>view.getElementById(id);
    try{
      q("scenario").value="pending";q("example").click();q("record-browser-search").value="absent";q("record-browser-search").dispatchEvent(new Event("input"));
      const before=q("rows").innerHTML,button=q("overview-rows").querySelector("button");assert(button?.getAttribute("aria-label").includes("open-one"));
      q("append-amount").value="2";q("append-amount").dispatchEvent(new Event("input"));
      button.click();assert(q("record-browser-select").value==="DAT:open-one"&&document.activeElement===q("record-browser-select"));
      q("record-browser-back").click();assert(q("record-browser-search").value==="absent"&&q("record-browser-select").disabled);assert(q("rows").innerHTML===before);
      q("scenario").value="profit";q("example").click();q("record-browser-search").value="absent";q("record-browser-search").dispatchEvent(new Event("input"));
      button.click();assert(q("record-browser-search").value==="absent"&&q("record-browser-select").disabled,"Detached overview button cannot select from a newer source");
    }finally{page.dispose();host.remove();}
  });
  test("rehearsal reference lifecycle: whole operation summary survives a narrow search and its exported report detects altered profit",async()=>{
    const response=await fetch("/rehearsal/"),parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    async function review(text){q("report-review-text").value=text;q("report-review-text").dispatchEvent(new Event("input"));q("report-review-paste").click();const end=Date.now()+10000;while(q("report-review-status").getAttribute("aria-busy")==="true"&&Date.now()<end)await tick();assert(q("report-review-status").getAttribute("aria-busy")==="false");}
    try{
      q("example").click();q("session-save").click();const before=downloads.pop().text;
      q("record-browser-search").value="open-one";q("record-browser-search").dispatchEvent(new Event("input"));
      assert(q("record-browser-reference-summary").textContent.includes("関連する全2件"));assert(q("record-browser-reference-summary").textContent.includes("累計実現損益: 28 SIM"));
      q("record-browser-reference-save").click();const source=downloads.pop().text;await review(source);
      assert(q("report-review-status").className==="passed"&&q("report-review-outcome").textContent.includes("関連記録 2件"));
      const altered=JSON.parse(source);altered.summary.realizedPnlUnits="999";await review(JSON.stringify(altered));
      assert(q("report-review-status").className==="blocked"&&q("report-review-differences").textContent.includes("realizedPnlUnits"));
      q("session-save").click();assert(downloads.pop().text===before,"Navigation and report review preserve original session");
    }finally{page.dispose();host.remove();}
  });

  test("saved comparison review: rechecks both current originals and detects altered claims before any receipt save",async()=>{
    const parent=document.createElement("div");document.body.append(parent);const files=[];
    const guide=mountSavedFileInspectionPanel({document,parent,download:file=>files.push(file)}),q=name=>parent.querySelector(".saved-file-guide-"+name);
    async function load(name,text){const transfer=new DataTransfer();transfer.items.add(new File([text],"synthetic.json"));q(name).files=transfer.files;q(name).dispatchEvent(new Event("change",{bubbles:true}));while(guide.getState().busy)await tick();}
    try{
      const source=(await prepareReportHistoryFile(sampleHistory())).text;await load("file",source);await load("compare-file",JSON.stringify(JSON.parse(source),null,2));
      const comparison=guide.getState().comparison;await load("review-file",JSON.stringify(comparison));
      assert(guide.getState().comparisonReview.matchesRecomputation&&q("review-save").disabled);
      q("review-ack").checked=true;q("review-ack").dispatchEvent(new Event("change",{bubbles:true}));q("review-save").click();
      assert(files.length===1&&JSON.parse(files[0].text).matchesRecomputation&&!files[0].restorable);
      await load("review-file",JSON.stringify({...comparison,sameOriginal:false}));
      assert(!guide.getState().comparisonReview.matchesRecomputation&&guide.getState().comparison===comparison&&!q("review-ack").checked);
    }finally{guide.dispose();parent.remove();}
  });
  test("saved bundle: original File bytes survive acknowledged bundle export and two separately acknowledged extractions",async()=>{
    const parent=document.createElement("div");document.body.append(parent);const files=[];
    const guide=mountSavedFileInspectionPanel({document,parent,download:file=>files.push(file)}),q=name=>parent.querySelector(".saved-file-guide-"+name),b=name=>parent.querySelector(".saved-bundle-"+name);
    async function load(field,text){const transfer=new DataTransfer();transfer.items.add(new File([text],"synthetic.json"));field.files=transfer.files;field.dispatchEvent(new Event("change",{bubbles:true}));while(guide.getState().busy||!b("stop").disabled)await tick();}
    function ack(field){field.checked=true;field.dispatchEvent(new Event("change",{bubbles:true}));}
    try{
      const before=(await prepareReportHistoryFile(sampleHistory())).text,after=JSON.stringify(JSON.parse(before),null,2)+"\r\n";
      await load(q("file"),before);await load(q("compare-file"),after);assert(b("export").disabled);ack(b("export-ack"));b("export").click();while(!b("stop").disabled)await tick();
      assert(files.length===1&&JSON.parse(files[0].text).afterFileText===after&&!b("export-ack").checked);
      await load(b("file"),files[0].text);assert(b("before").disabled);ack(b("source-ack"));b("before").click();assert(files[1].text===before&&b("after").disabled);
      ack(b("source-ack"));b("after").click();assert(files[2].text===after&&files[2].automaticallyImported===false);
      await load(q("file"),before);assert(b("export").disabled&&b("output").textContent.includes("再計算と一致"));
    }finally{guide.dispose();parent.remove();}
  });
  test("saved bundle: substituted comparison claims disable extraction and corrupt new files clear old results",async()=>{
    const parent=document.createElement("div");document.body.append(parent);const files=[];
    const guide=mountSavedFileInspectionPanel({document,parent,download:file=>files.push(file)}),q=name=>parent.querySelector(".saved-file-guide-"+name),b=name=>parent.querySelector(".saved-bundle-"+name);
    async function load(field,text){const transfer=new DataTransfer();transfer.items.add(new File([text],"synthetic.json"));field.files=transfer.files;field.dispatchEvent(new Event("change",{bubbles:true}));while(guide.getState().busy||!b("stop").disabled)await tick();}
    try{
      const source=(await prepareReportHistoryFile(sampleHistory())).text;await load(q("file"),source);await load(q("compare-file"),source);
      b("export-ack").checked=true;b("export-ack").dispatchEvent(new Event("change",{bubbles:true}));b("export").click();while(!b("stop").disabled)await tick();
      const bundle=JSON.parse(files[0].text),comparison=JSON.parse(bundle.comparisonText);comparison.sameOriginal=false;bundle.comparisonText=JSON.stringify(comparison);
      await load(b("file"),JSON.stringify(bundle));assert(b("source-ack").disabled&&b("before").disabled&&b("output").textContent.includes("不一致"));assert(files.length===1);
      await load(b("file"),"{}");assert(b("before").disabled&&b("output").textContent==="");
    }finally{guide.dispose();parent.remove();}
  });

  test("saved file comparison: identical originals with different formatting keep the baseline and require a separate save acknowledgement", async () => {
    const parent = document.createElement("div"); document.body.append(parent); const files = [];
    const guide = mountSavedFileInspectionPanel({ document, parent, download: file => files.push(file) });
    const q = name => parent.querySelector(".saved-file-guide-" + name);
    async function load(name, text) {
      const transfer = new DataTransfer(); transfer.items.add(new File([text], "original.json", { type: "application/json" }));
      q(name).files = transfer.files; q(name).dispatchEvent(new Event("change", { bubbles: true })); while (guide.getState().busy) await tick();
    }
    try {
      parent.querySelector("details").open = true; q("comparison").open = true;
      assert(q("compare-file").disabled); const source = (await prepareReportHistoryFile(sampleHistory())).text; await load("file", source);
      const baseline = guide.getState().result; await load("compare-file", JSON.stringify(JSON.parse(source), null, 2));
      assert(guide.getState().result === baseline && guide.getState().comparison.kind === "format-only");
      assert(q("comparison-output").textContent.includes("書式に違い") && q("comparison-save").disabled);
      q("comparison-ack").checked = true; q("comparison-ack").dispatchEvent(new Event("change", { bubbles: true })); q("comparison-save").click();
      assert(files.length === 1 && JSON.parse(files[0].text).sameOriginal === true && files[0].restorable === false);
      await load("file", source); assert(!guide.getState().comparison && q("comparison-output").textContent === "");
    } finally { guide.dispose(); parent.remove(); }
  });
  test("saved file comparison: corruption cannot replace the baseline and auxiliary claims do not establish equality", async () => {
    const parent = document.createElement("div"); document.body.append(parent);
    const guide = mountSavedFileInspectionPanel({ document, parent }); const q = name => parent.querySelector(".saved-file-guide-" + name);
    async function load(name, text) {
      const transfer = new DataTransfer(); transfer.items.add(new File([text], "original.json"));
      q(name).files = transfer.files; q(name).dispatchEvent(new Event("change", { bubbles: true })); while (guide.getState().busy) await tick();
    }
    try {
      const source = (await prepareReportHistoryFile(sampleHistory())).text; await load("file", source); const baseline = guide.getState().result;
      await load("compare-file", source); assert(guide.getState().comparison.kind === "identical");
      const corrupt = JSON.parse(source); corrupt.digest = "0".repeat(64); await load("compare-file", JSON.stringify(corrupt));
      assert(guide.getState().result === baseline && !guide.getState().comparison && q("comparison-save").disabled);
      assert(q("status").textContent.includes("チェックサムが一致しません"));
      await load("compare-file", JSON.stringify({ schema: "threecore.saved-file-comparison.v1", sameOriginal: true }));
      assert(guide.getState().comparison.kind === "unverified" && guide.getState().comparison.sameOriginal === null);
      assert(q("comparison-output").textContent.includes("一致を判断していません"));
    } finally { guide.dispose(); parent.remove(); }
  });
  test("saved file guide: verifies an original backup, gives its destination and saves only an inspection", async () => {
    const parent = document.createElement("div"); document.body.append(parent); const files = [];
    const guide = mountSavedFileInspectionPanel({ document, parent, download: file => files.push(file) });
    const q = name => parent.querySelector(".saved-file-guide-" + name);
    async function load(text) {
      const transfer = new DataTransfer(); transfer.items.add(new File([text], "history.json", { type: "application/json" }));
      q("file").files = transfer.files; q("file").dispatchEvent(new Event("change", { bubbles: true }));
      while (guide.getState().busy) await tick();
    }
    try {
      parent.querySelector("details").open = true;
      assert(!guide.getState().result && q("save").disabled);
      const source = (await prepareReportHistoryFile(sampleHistory())).text; await load(source);
      assert(guide.getState().result.checksumVerified && guide.getState().result.scope.reportCount === 4);
      assert(q("output").textContent.includes("報告履歴のバックアップJSONから追加復元")); assert(!q("output").textContent.includes("担当メモ"));
      q("ack").checked = true; q("ack").dispatchEvent(new Event("change", { bubbles: true })); q("save").click();
      assert(files.length === 1 && JSON.parse(files[0].text).restorable === false && !q("ack").checked);
      const bad = JSON.parse(source); bad.digest = "0".repeat(64); await load(JSON.stringify(bad));
      assert(!guide.getState().result && q("save").disabled && q("status").textContent.includes("チェックサムが一致しません"));
    } finally { guide.dispose(); parent.remove(); }
  });
  test("saved file guide: auxiliary claims remain unverified and stopped reads cannot replace the result", async () => {
    const parent = document.createElement("div"); document.body.append(parent); const gate = deferred(); let delayed = false;
    const guide = mountSavedFileInspectionPanel({ document, parent, readText: async file => delayed ? gate.promise : file.text() });
    const q = name => parent.querySelector(".saved-file-guide-" + name);
    function choose(text) { const transfer = new DataTransfer(); transfer.items.add(new File([text], "guide.json")); q("file").files = transfer.files; q("file").dispatchEvent(new Event("change", { bubbles: true })); }
    try {
      parent.querySelector("details").open = true;
      choose(JSON.stringify({ schema: "threecore.report-set-history-coverage.v1", checksumVerified: true, privateText: "PRIVATE" }));
      while (guide.getState().busy) await tick();
      assert(guide.getState().result.validation === "declared-only" && !guide.getState().result.checksumVerified);
      assert(q("output").textContent.includes("検証していません") && !q("output").textContent.includes("PRIVATE"));
      delayed = true; choose("{}"); assert(guide.getState().busy); q("stop").click();
      gate.resolve((await prepareReportHistoryFile(sampleHistory())).text); await tick(); await tick();
      assert(!guide.getState().result && !guide.getState().busy && q("status").textContent.includes("中止"));
    } finally { guide.dispose(); parent.remove(); }
  });
  test("file-read: narrow discrepancy previews wrap exact values and remain keyboard scrollable",async()=>{
    const [html,css]=await Promise.all([fetch("/rehearsal/").then(r=>r.text()),fetch("/examples/operation-rehearsal.css").then(r=>r.text())]);
    const parsed=new DOMParser().parseFromString(html,"text/html"),host=document.createElement("div");host.style.width="360px";document.body.append(host);
    const shadow=host.attachShadow({mode:"open"}),style=document.createElement("style");style.textContent=css;shadow.append(style);
    const main=document.createElement("main"),section=document.createElement("section");main.append(section);shadow.append(main);
    try{
      for(const target of ["review","evidence"]){
        const detail=document.importNode(parsed.getElementById("report-"+target+"-difference-detail"),true);detail.hidden=false;section.append(detail);
        const text="<img src=x>"+"long-value-".repeat(190)+"\n"+"比較する値\n".repeat(100);detail.textContent=text;detail.focus();
        assert(shadow.activeElement===detail,"Detail focus is retained");assert(detail.textContent===text&&!detail.querySelector("img"),"Long value remains exact plain text");
        assert(detail.clientWidth>0&&detail.scrollWidth<=detail.clientWidth+1,"Long value must not cause horizontal overflow");
        assert(detail.getBoundingClientRect().right<=section.getBoundingClientRect().right,"Preview remains inside its section");
        assert(detail.scrollHeight>detail.clientHeight,"Long detail can scroll vertically");detail.scrollTop=detail.scrollHeight;assert(detail.scrollTop>0);detail.remove();
      }
    }finally{host.remove();}
  });
  test("file-read: rehearsal navigation focuses every destination and opens evidence without changing records",async()=>{
    const response=await fetch("/rehearsal/"),parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),querySelectorAll:selector=>host.querySelectorAll(selector),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    try{
      q("example").click();q("session-save").click();const before=downloads.pop().text;
      const links=[...host.querySelectorAll("a[data-rehearsal-target]")];assert(links.length>=18);
      for(const link of links){link.addEventListener("click",event=>event.preventDefault());link.click();assert(document.activeElement===q(link.dataset.rehearsalTarget),"Link must move keyboard focus to its own destination");}
      const summary=q("report-evidence-title");assert(summary.parentElement.open,"Evidence disclosure opens");assert(!summary.hasAttribute("tabindex"),"Evidence summary remains a normal Tab stop");
      q("session-save").click();assert(downloads.pop().text===before,"Navigation preserves rehearsal data");
      page.dispose();q("example").focus();const prior=document.activeElement;links[0].click();assert(document.activeElement===prior,"Retired navigation does not move focus");
    }finally{page.dispose();host.remove();}
  });


  test("file-read: native discrepancy filters retain full totals and select the original value",async()=>{
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const edit=(id,value,event="input")=>{q(id).value=value;q(id).dispatchEvent(new Event(event));};
    const finish=async id=>{const end=Date.now()+10000;while(q(id).getAttribute("aria-busy")==="true"&&Date.now()<end)await tick();assert(q(id).getAttribute("aria-busy")==="false");};
    try{
      q("example").click();q("session-save").click();const before=downloads.pop().text;
      q("overview-save").click();const source=JSON.parse(downloads.pop().text);source.sourceVerified=true;
      for(let i=0;i<83;i++)source["extra"+String(i).padStart(3,"0")]=i;
      edit("report-review-text",JSON.stringify(source));q("report-review-paste").click();await finish("report-review-status");
      edit("report-review-difference-search","extra08");edit("report-review-difference-type","unexpected","change");
      assert(q("report-review-differences").children.length===3);
      q("report-review-difference-query-save").click();const allFiltered=JSON.parse(downloads.pop().text);
      assert(allFiltered.allMatchingDifferencesIncluded&&allFiltered.matchedDifferences===3&&allFiltered.totalDifferences===84&&allFiltered.differences[2].index===83);
      q("report-review-differences").querySelectorAll("button")[2].click();q("report-review-difference-save").click();
      const selected=JSON.parse(downloads.pop().text);assert(selected.actual.value===82&&selected.index===83&&selected.totalDifferences===84);
      edit("report-review-difference-type","value","change");
      assert(q("report-review-differences").children.length===0&&q("report-review-difference-status").textContent.includes("相違は84箇所"));
      assert(q("report-review-status").className==="blocked"&&q("report-review-difference-save").disabled);
      q("report-review-save").click();assert(JSON.parse(downloads.pop().text).differenceCount===84);
      q("report-review-difference-query-save").click();const empty=JSON.parse(downloads.pop().text);assert(empty.matchedDifferences===0&&empty.totalDifferences===84&&!empty.summary.matchesRecomputation);
      q("report-review-difference-filter-clear").click();assert(q("report-review-differences").children.length===40);
      q("report-review-next").click();q("report-review-difference-query-save").click();assert(JSON.parse(downloads.pop().text).differences.length===84);
      q("report-review-evidence-save").click();const evidence=JSON.parse(downloads.pop().text);evidence.receipt.differenceCount=9;evidence.receipt.extra="receipt";
      edit("report-evidence-text",JSON.stringify(evidence));q("report-evidence-paste").click();await finish("report-evidence-status");
      edit("report-evidence-difference-search","/differenceCount");edit("report-evidence-difference-type","value","change");
      assert(q("report-evidence-differences").children.length===1);q("report-evidence-differences").querySelector("button").click();q("report-evidence-difference-save").click();
      const saved=JSON.parse(downloads.pop().text);assert(saved.actual.value===9&&saved.totalDifferences===2);
      q("report-evidence-difference-query-save").click();const allReceipt=JSON.parse(downloads.pop().text);assert(allReceipt.target==="evidence-receipt"&&allReceipt.matchedDifferences===1&&allReceipt.totalDifferences===2&&!allReceipt.summary.matchesReceipt);
      edit("report-evidence-difference-kind","source","change");assert(q("report-evidence-difference-search").value===""&&q("report-evidence-differences").children.length===40);
      q("report-evidence-difference-query-save").click();const allSource=JSON.parse(downloads.pop().text);assert(allSource.target==="evidence-source"&&allSource.differences.length===84&&!allSource.summary.matchesReceipt);
      q("session-save").click();assert(downloads.pop().text===before,"Filtered inspection preserves rehearsal data");
    }finally{page.dispose();host.remove();}
  });



  test("file-read: discrepancy values remain exact, readable and tied to the current native review",async()=>{
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const edit=(id,value,event="input")=>{q(id).value=value;q(id).dispatchEvent(new Event(event));};
    const finish=async id=>{const end=Date.now()+10000;while(q(id).getAttribute("aria-busy")==="true"&&Date.now()<end)await tick();assert(q(id).getAttribute("aria-busy")==="false");};
    try{
      q("example").click();q("session-save").click();const before=downloads.pop().text;
      q("overview-save").click();const source=JSON.parse(downloads.pop().text);
      source.extra="<img src=x>"+"x".repeat(3000);edit("report-review-text",JSON.stringify(source));q("report-review-paste").click();await finish("report-review-status");
      const old=q("report-review-differences").querySelector("button");old.click();
      const detail=q("report-review-difference-detail");assert(document.activeElement===detail&&!detail.hidden);
      assert(detail.textContent.includes("<img src=x>")&&detail.textContent.includes("表示を省略")&&!detail.querySelector("img"));
      q("report-review-difference-save").click();const fullReport=JSON.parse(downloads.pop().text);assert(fullReport.valuesComplete&&fullReport.actual.value===source.extra);
      q("report-review-evidence-save").click();const evidence=JSON.parse(downloads.pop().text);evidence.receipt.differenceCount=81;
      edit("report-evidence-text",JSON.stringify(evidence));q("report-evidence-paste").click();await finish("report-evidence-status");
      const receiptButton=q("report-evidence-differences").querySelector("button");receiptButton.click();
      assert(q("report-evidence-difference-detail").textContent.includes("再計算で得た値: 1"));
      assert(q("report-evidence-difference-detail").textContent.includes("控えにある値: 81"));
      q("report-evidence-difference-save").click();const fullReceipt=JSON.parse(downloads.pop().text);assert(fullReceipt.target==="evidence-receipt"&&fullReceipt.actual.value===81&&fullReceipt.expected.value===1);
      edit("report-evidence-difference-kind","source","change");receiptButton.click();assert(q("report-evidence-difference-detail").hidden);
      q("report-evidence-differences").querySelector("button").click();assert(q("report-evidence-difference-detail").textContent.includes("<img src=x>"));
      q("report-evidence-difference-save").click();const fullSource=JSON.parse(downloads.pop().text);assert(fullSource.target==="evidence-source"&&fullSource.actual.value===source.extra&&!fullSource.summary.matchesReceipt);
      edit("report-review-text","{}");old.click();assert(detail.hidden&&q("report-review-difference-save").disabled);
      q("session-save").click();assert(downloads.pop().text===before,"Inspection keeps current rehearsal exactly unchanged");
    }finally{page.dispose();host.remove();}
  });



  for (const kind of ["settings", "workspace"]) test("file-read: "+kind+" input cancellation preserves a newer native preview", async () => {
    const host=document.createElement("div");document.body.append(host);
    const fields=["DAT","EMA","CAWELON"].map((agent,index)=>({agent,account:"0x"+String(index+1).repeat(40),chainId:84532}));
    const draft=fields.map(row=>({...row,tokenAddress:"",tokens:"",history:createPortfolioHistory().exportText()}));
    const source=kind==="settings"?JSON.stringify({schema:WALLET_SETUP_SCHEMA,entries:fields}):JSON.stringify(workspaceFromDraft(draft));
    let writes=0,entered=false,armed=false;
    const panel=kind==="settings"?mountWalletSetupPanel({document,parent:host,readFields:()=>fields,applyPlan(){writes++;}})
      :mountWorkspacePanel({document,parent:host,readDraft:()=>draft,writeDraft(){writes++;}});
    const prefix=kind==="settings"?"wallet-setup-":"workspace-",field=name=>host.querySelector("."+prefix+name);
    const baseline=walletFileReadService.state().cancelled,off=walletFileReadService.subscribe(state=>{
      if(!armed||entered||state.cancelled<=baseline)return;entered=true;
      field("json").value=source;field("json").dispatchEvent(new Event("input"));field("preview").click();
    });
    try {
      const transfer=new DataTransfer();transfer.items.add(new File(["{}"],"older.json",{type:"application/json"}));
      field("file").files=transfer.files;field("file").dispatchEvent(new Event("change"));armed=true;
      field("json").value="{}";field("json").dispatchEvent(new Event("input"));await tick();
      assert(entered,"Cancellation observer ran");
      assert(field(kind==="settings"?"details":"detail").textContent.length>0,"New preview survives");
      assert(!field(kind==="settings"?"confirm":"confirmed").disabled,"New preview remains confirmable");
      assert(field("status").textContent.includes("まだ")&&writes===0,"Preview only, no writes");
    }finally{armed=false;off();panel.dispose();host.remove();await tick();}
  });

  test("file-read: checkpoint replacement respects cancellation before admitting its file",async()=>{
    const host=document.createElement("div");document.body.append(host);
    const source=emptyCheckpointDocument(),storage={async read(){return source;},async change(){throw Error("Must not write");},close(){}};
    let entered=false,armed=false;
    const panel=mountCheckpointPanel({document,parent:host,storage,readDraft:()=>[],onStage(){throw Error("Must not stage");}});
    const field=name=>host.querySelector(".checkpoint-"+name);
    const choose=name=>{const transfer=new DataTransfer();transfer.items.add(new File(["{}"],name,{type:"application/json"}));field("import-file").files=transfer.files;field("import-file").dispatchEvent(new Event("change"));};
    const baseline=walletFileReadService.state().cancelled,off=walletFileReadService.subscribe(state=>{
      if(!armed||entered||state.cancelled<=baseline)return;entered=true;field("import-cancel").click();
    });
    try{
      field("refresh").click();await tick();
      choose("older.json");armed=true;choose("replacement.json");await tick();
      assert(entered,"Cancellation observer ran");
      assert(field("panel").getAttribute("aria-busy")==="false","Cancelled replacement does not start another read");
      assert(field("status").textContent.includes("取り消しました"),"Newer cancellation guidance survives");
      assert(source.entries.length===0,"No checkpoint writes");
    }finally{armed=false;off();panel.dispose();host.remove();await tick();}
  });


  for(const kind of ["check","cases","session","report","workspace"])test("file-read: "+kind+" keeps a newer review started during native file cancellation",async()=>{
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    let armed=false,entered=false,unsubscribe=()=>{};
    try{
      q("agent").value="EMA";q("agent").dispatchEvent(new Event("change"));q("example").click();q("overview-save").click();const report=downloads.pop().text;
      q("agent").value="DAT";q("agent").dispatchEvent(new Event("change"));q("example").click();q("session-save").click();const before=downloads.pop().text;
      const input=rehearsalExampleV2("EMA"),workspace={schema:"threecore.operation-rehearsal-workspace.v1",simulationOnly:true,activeAgent:"EMA",ledgers:[input]},cases={schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:"newer",label:"Newer review",before:input,after:input}]};
      const sources={workspace:JSON.stringify(workspace),cases:JSON.stringify(cases),check:encodeRehearsalCheckSuite(captureRehearsalCheckSuite(cases)),report,session:JSON.stringify({schema:"threecore.operation-rehearsal-session.v1",simulationOnly:true,workspace,cases})};
      const prefix={check:"check-suite-",cases:"scenario-set-",session:"session-",report:"report-review-",workspace:"workspace-"}[kind],field=name=>q(prefix+name),ready=()=>!field(["check","report"].includes(kind)?"save":"apply").disabled;
      const baseline=walletFileReadService.state().cancelled;unsubscribe=walletFileReadService.subscribe(state=>{if(armed&&!entered&&state.cancelled>baseline){entered=true;field("text").value=sources[kind];field("text").dispatchEvent(new Event("input"));field(kind==="workspace"?"text-review":"paste").click();}});
      const transfer=new DataTransfer();transfer.items.add(new File(["{}"],"older.json",{type:"application/json"}));field("file").files=transfer.files;field("file").dispatchEvent(new Event("change"));armed=true;
      field(["check","report"].includes(kind)?"clear":"cancel").click();assert(entered,"Native cancellation observer ran");
      for(let i=0;i<100&&!ready();i++)await tick();assert(ready(),"Newer review remains usable");assert(field("status").getAttribute("aria-busy")!=="true");
      q("session-save").click();assert(downloads.pop().text===before,"Review never applies new source data");
    }finally{armed=false;unsubscribe();page.dispose();host.remove();await tick();}
  });

  test("file-read: recorded-account search saves and rechecks the exact new scope without changing the ledger",async()=>{
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const edit=(id,value,event="input")=>{q(id).value=value;q(id).dispatchEvent(new Event(event));};
    try{
      const source=rehearsalExampleV2(),account="0x"+"2".repeat(40),input={schema:"threecore.operation-rehearsal-workspace.v1",simulationOnly:true,activeAgent:"DAT",ledgers:[{...source,events:[{...source.events[0],account},source.events[1]]}]};
      edit("workspace-text",JSON.stringify(input));q("workspace-text-review").click();q("workspace-apply").click();q("session-save").click();const before=downloads.pop().text;
      edit("record-browser-search",account);assert(q("record-browser-rows").rows.length===0);edit("record-browser-search-scope","recorded","change");assert(q("record-browser-rows").rows.length===1);
      q("record-browser-save").click();const text=downloads.pop().text,report=JSON.parse(text);assert(report.schema.endsWith(".v2")&&report.query.searchScope==="recorded");assert(report.rows[0].agent==="DAT");assert(report.rows[0].event.account===account);
      edit("report-review-text",text);q("report-review-paste").click();for(let i=0;i<100&&q("report-review-save").disabled;i++)await tick();assert(!q("report-review-save").disabled);
      q("report-review-save").click();const receipt=JSON.parse(downloads.pop().text);assert(receipt.differenceCount===0&&receipt.reportOutcome.query.searchScope==="recorded");
      q("session-save").click();assert(downloads.pop().text===before);q("record-browser-clear").click();assert(q("record-browser-search-scope").value==="stored");
    }finally{page.dispose();host.remove();}
  });

  test("file-read: search CSV exports all 600 matching rows and retains the original session",async()=>{
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    try{
      const input={schema:"threecore.operation-rehearsal-workspace.v1",simulationOnly:true,activeAgent:"DAT",ledgers:["DAT","EMA","CAWELON"].map(agent=>{
        const source=rehearsalExampleV2(agent,"deposit");return {...source,events:Array.from({length:200},(_,i)=>({...source.events[0],id:"deposit-"+i,amount:"1"}))};})};
      q("workspace-text").value=JSON.stringify(input);q("workspace-text").dispatchEvent(new Event("input"));q("workspace-text-review").click();assert(!q("workspace-apply").disabled);q("workspace-apply").click();
      q("session-save").click();const before=downloads.pop().text;q("record-browser-next").click();assert(q("record-browser-rows").rows.length===10);
      q("record-browser-csv-save").click();const csv=downloads.pop();assert(csv.filename==="ThreeCore-record-query.csv");assert(csv.text.startsWith("\uFEFF"));assert(csv.text.split("\r\n").length===602);
      assert(q("record-browser-export-status").textContent.includes("全600件"));assert(q("record-browser-status").textContent.includes("11～20"));
      q("record-browser-search").value="absent";q("record-browser-search").dispatchEvent(new Event("input"));q("record-browser-csv-save").click();assert(downloads.pop().text.split("\r\n").length===2);
      assert(q("record-browser-export-status").textContent.includes("列名だけ"));
      q("session-save").click();assert(downloads.pop().text===before);
    }finally{page.dispose();host.remove();}
  });

  test("file-read: confirmed restores keep keyboard focus on their completed outcomes",async()=>{
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const edit=(id,value,event="input")=>{q(id).value=value;q(id).dispatchEvent(new Event(event));};
    try{
      q("example").click();q("session-save").click();const original=downloads.pop().text;
      q("whatif-compare").click();edit("scenario-set-id","focus-case");edit("scenario-set-label","Focus case");q("scenario-set-add").click();
      q("scenario-set-apply").focus();q("scenario-set-apply").click();assert(document.activeElement===q("scenario-set-status"));
      assert(q("scenario-set-rows").rows.length===1);
      edit("session-text",original);q("session-paste").click();q("session-apply").focus();q("session-apply").click();
      assert(document.activeElement===q("session-status"));assert(q("session-status").textContent.includes("まとめて復旧しました"));
      assert(q("scenario-set-rows").rows.length===0);assert(q("session-receipt").textContent.includes("比較ケース 0件"));
      const transfer=new DataTransfer();transfer.items.add(new File([JSON.stringify(rehearsalExampleV2("EMA"))],"synthetic-record.json",{type:"application/json"}));q("file").files=transfer.files;q("file").dispatchEvent(new Event("change"));
      for(let i=0;i<100&&q("apply").disabled;i++)await tick();assert(!q("apply").disabled);
      q("apply").focus();q("apply").click();assert(document.activeElement===q("result-title"));assert(q("agent").value==="EMA");assert(q("rows").rows.length===2);
    }finally{page.dispose();host.remove();}
  });

  test("file-read: each searched record row opens its own detail without changing saved history",async()=>{
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    try{
      q("example").click();q("session-save").click();const before=downloads.pop().text;
      const row=q("record-browser-rows").rows[1],pick=row.querySelector("button");assert(pick.getAttribute("aria-label").includes("settle-one"));pick.click();
      assert(q("record-browser-select").value==="DAT:settle-one");assert(document.activeElement===q("record-browser-select"));assert(q("record-browser-detail").textContent.includes("2番目"));
      q("session-save").click();assert(downloads.pop().text===before);
      q("record-browser-search").value="open-one";q("record-browser-search").dispatchEvent(new Event("input"));pick.click();
      assert(q("record-browser-select").value==="DAT:open-one");assert(q("record-browser-detail").textContent.includes("1番目"));
    }finally{page.dispose();host.remove();}
  });

  test("file-read: report and evidence difference pages expose the complete native DOM result",async()=>{
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const finish=async id=>{const end=Date.now()+10000;while(q(id).getAttribute("aria-busy")==="true"&&Date.now()<end)await tick();assert(q(id).getAttribute("aria-busy")==="false");};
    try{
      q("example").click();q("overview-save").click();const source=JSON.parse(downloads.pop().text);for(let i=0;i<103;i++)source["extra"+i]=i;
      q("report-review-text").value=JSON.stringify(source);q("report-review-text").dispatchEvent(new Event("input"));q("report-review-paste").click();await finish("report-review-status");
      assert(q("report-review-differences").children.length===40);q("report-review-next").click();q("report-review-next").click();
      assert(q("report-review-differences").children.length===23&&q("report-review-next").disabled);assert(q("report-review-difference-status").textContent.includes("81〜103"));
      q("report-review-evidence-save").click();const evidence=JSON.parse(downloads.pop().text);for(let i=0;i<87;i++)evidence.receipt["extra"+i]=i;
      q("report-evidence-text").value=JSON.stringify(evidence);q("report-evidence-text").dispatchEvent(new Event("input"));q("report-evidence-paste").click();await finish("report-evidence-status");
      assert(q("report-evidence-difference-kind").value==="receipt");q("report-evidence-next").click();q("report-evidence-next").click();
      assert(q("report-evidence-differences").children.length===7&&q("report-evidence-next").disabled);
      q("report-evidence-difference-kind").value="source";q("report-evidence-difference-kind").dispatchEvent(new Event("change"));
      assert(q("report-evidence-previous").disabled&&q("report-evidence-differences").children.length===40);q("report-evidence-next").click();q("report-evidence-next").click();
      assert(q("report-evidence-differences").children.length===23);q("report-evidence-save").click();const result=JSON.parse(downloads.pop().text);
      assert(result.differenceCount===87&&result.reportReview.differenceCount===103&&result.reportReview.differences.length===40);
    }finally{page.dispose();host.remove();}
  });

  for(const altered of [false,true])test("file-read: portable evidence native round trip"+(altered?" detects a changed receipt":" preserves independent views"),async()=>{
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const finish=async id=>{const end=Date.now()+10000;while(q(id).getAttribute("aria-busy")==="true"&&Date.now()<end)await tick();assert(q(id).getAttribute("aria-busy")==="false");};
    const pick=(id,text)=>{const transfer=new DataTransfer();transfer.items.add(new File([text],"evidence.json",{type:"application/json"}));q(id).files=transfer.files;q(id).dispatchEvent(new Event("change"));};
    try{
      q("example").click();q("session-save").click();const before=downloads.pop().text;
      q("overview-save").click();const source=downloads.pop().text;
      q("report-review-text").value=source;q("report-review-text").dispatchEvent(new Event("input"));q("report-review-paste").click();await finish("report-review-status");
      const ordinaryStatus=q("report-review-status").textContent;q("report-review-evidence-save").click();const encoded=downloads.pop().text;
      const evidence=JSON.parse(encoded);assert(evidence.sourceText===source);
      if(altered)evidence.receipt["<img src=x onerror=alert(1)>"]=true;
      pick("report-evidence-file",JSON.stringify(evidence));await finish("report-evidence-status");
      assert(q("report-evidence-status").className===(altered?"blocked":"passed"));assert(!q("report-evidence-save").disabled);
      assert(q("report-review-status").textContent===ordinaryStatus&&!q("report-review-evidence-save").disabled,"Separate verification retains the original review");
      assert(!q("report-evidence-results").querySelector("img"));
      q("report-evidence-source-save").click();assert(downloads.pop().text===source);
      q("report-evidence-save").click();assert(JSON.parse(downloads.pop().text).matchesReceipt===!altered);
      q("session-save").click();assert(downloads.pop().text===before,"Evidence inspection never restores or modifies live ledgers");
      q("report-evidence-file").dispatchEvent(new Event("cancel"));assert(!q("report-evidence-save").disabled);
      if(!altered){pick("report-review-file",encoded);await finish("report-review-status");assert(q("report-review-status").textContent.includes("まとめて保存した証拠を再確認する"));
        pick("report-evidence-file",source);await finish("report-evidence-status");assert(q("report-evidence-status").textContent.includes("保存した資料を再計算して確認"));}
    }finally{page.dispose();host.remove();}
  });

  test("file-read: saved checksum text uses a native file picker and retains its selected source", async () => {
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const finish=async id=>{const end=Date.now()+10000;while(q(id).getAttribute("aria-busy")==="true"&&Date.now()<end)await tick();assert(q(id).getAttribute("aria-busy")==="false");};
    try{
      q("example").click();q("overview-save").click();const source=downloads.pop().text;
      q("report-review-text").value=source;q("report-review-text").dispatchEvent(new Event("input"));q("report-review-paste").click();await finish("report-review-status");
      q("report-review-checksum-save").click();const checksum=downloads.pop().text;
      const transfer=new DataTransfer();transfer.items.add(new File([checksum],"saved-checksum.txt",{type:"text/plain"}));
      q("report-review-checksum-file").files=transfer.files;q("report-review-checksum-file").dispatchEvent(new Event("change"));await finish("report-review-checksum-file-status");
      assert(q("report-review-expected").value===checksum.trim());assert(!q("report-review-run").disabled&&q("report-review-save").disabled);
      q("report-review-run").click();await finish("report-review-status");assert(q("report-review-summary").textContent.includes("照合値: 一致"));
      q("report-review-checksum-file").dispatchEvent(new Event("cancel"));assert(!q("report-review-save").disabled);assert(q("report-review-checksum-file-note").textContent.includes("変更していません"));
    }finally{page.dispose();host.remove();}
  });
  test("file-read: unfinished numeric edits retain the saved ledger and restore native undo", async () => {
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const edit=(id,value,type="input")=>{q(id).value=value;q(id).dispatchEvent(new Event(type));};
    try{
      q("example").click();edit("append-kind","reserve","change");edit("append-reference","reward");edit("append-amount","1");q("append-preview").click();q("append-confirm").click();
      q("workspace-save").click();const before=downloads.pop().text;assert(!q("undo").disabled);
      edit("principal","invalid");q("calculate").click();assert(!q("form-draft-note").hidden&&!q("form-restore").disabled);assert(q("save").disabled);
      q("workspace-save").click();assert(downloads.pop().text===before);q("form-restore").focus();q("form-restore").click();
      assert(document.activeElement===q("result-title"));assert(q("status").textContent.startsWith("入力変更前の履歴を再表示しました。"));
      assert(q("rows").children.length===3&&!q("undo").disabled&&q("form-draft-note").hidden);q("undo").click();assert(q("rows").children.length===2);
    }finally{page.dispose();host.remove();}
  });
  test("file-read: expected-result filters expose later differences in a native browser", async () => {
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window};
    const page=mountOperationRehearsal(view,()=>{}),q=id=>view.getElementById(id);
    try{
      const source=rehearsalExampleV2(),many={...source,events:Array.from({length:25},(_,i)=>({id:"deposit-"+i,kind:"deposit",agent:source.agent,chainId:source.chainId,account:source.account,amount:"1"}))};
      const suite=JSON.parse(JSON.stringify(captureRehearsalCheckSuite({schema:REHEARSAL_SCENARIO_SET_SCHEMA,simulationOnly:true,cases:[{id:"all",label:"相違のあるケース",before:many,after:many}]})));
      for(const side of ["before","after"])for(const row of suite.expected[0][side].records){row.withinEnteredLimits=false;row.reasons=["EXPECTED_ONLY"];}
      q("check-suite-text").value=encodeRehearsalCheckSuite(suite);q("check-suite-text").dispatchEvent(new Event("input"));q("check-suite-paste").click();
      q("check-suite-rows").querySelector("button").click();assert(document.activeElement===q("check-suite-case"));assert(q("check-suite-case").value==="all");
      assert(q("check-suite-differences").children.length===40);q("check-suite-next").click();q("check-suite-next").click();
      assert(q("check-suite-differences").children.length===20&&q("check-suite-next").disabled);assert(q("check-suite-difference-status").textContent.includes("81〜100"));
      q("check-suite-filter").value="matched";q("check-suite-filter").dispatchEvent(new Event("change"));assert(q("check-suite-rows").children.length===0);assert(q("check-suite-difference-status").textContent.includes("該当するケースはありません"));assert(!q("check-suite-save").disabled);
    }finally{page.dispose();host.remove();}
  });
  test("file-read: reviewed source and checksum exports match the real digest and invalid checksum focus", async () => {
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html"),host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window},downloads=[];
    const page=mountOperationRehearsal(view,({prepared})=>downloads.push(prepared)),q=id=>view.getElementById(id);
    const finish=async()=>{const end=Date.now()+10000;while(q("report-review-status").getAttribute("aria-busy")==="true"&&Date.now()<end)await tick();assert(q("report-review-status").getAttribute("aria-busy")==="false");};
    try{
      q("example").click();q("overview-save").click();const source=downloads.pop().text;
      q("report-review-expected").value="invalid";q("report-review-expected").dispatchEvent(new Event("input"));
      q("report-review-text").value=source;q("report-review-text").dispatchEvent(new Event("input"));q("report-review-paste").click();await finish();
      assert(document.activeElement===q("report-review-expected"));assert(q("report-review-expected").getAttribute("aria-invalid")==="true");
      q("report-review-expected").value="";q("report-review-expected").dispatchEvent(new Event("input"));q("report-review-run").click();await finish();
      q("report-review-source-save").click();q("report-review-checksum-save").click();q("report-review-save").click();
      assert(downloads.length===3);assert(downloads[0].text===source);const receipt=JSON.parse(downloads[2].text);assert(downloads[1].text===receipt.sha256+"\n");assert(receipt.matchesRecomputation);
      q("report-review-clear").click();assert(q("report-review-source-save").disabled&&q("report-review-checksum-save").disabled);
    }finally{page.dispose();host.remove();}
  });
  test("file-read: append kinds and recorded ID choices guide the native form", async () => {
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html");
    const host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window};
    const page=mountOperationRehearsal(view,()=>{}),q=id=>view.getElementById(id);
    const edit=(id,value,type="input")=>{q(id).value=value;q(id).dispatchEvent(new Event(type));};
    try{
      assert(q("append-amount").disabled&&q("append-reference-choice").disabled);
      edit("scenario","pending","change");q("example").click();edit("append-kind","settle","change");
      assert(q("append-exit-reserve").disabled&&!q("append-fee").disabled);assert(!q("append-reference-choice").disabled);
      assert([...q("append-reference-choice").options].some(option=>option.value==="one"));
      edit("append-reference-choice","one","change");assert(q("append-reference").value==="one");
      edit("append-amount","130");edit("append-fee","1");q("append-preview").click();assert(!q("append-confirm").disabled);
      q("append-confirm").click();assert(q("append-reference-choice").disabled);assert(q("append-capacity").textContent.includes("あと198件"));
      edit("append-kind","deposit","change");assert(q("append-reference").disabled&&q("append-fee").disabled&&!q("append-amount").disabled);
      for(const id of ["append-kind","append-reference-choice","append-reference"]){for(const ref of q(id).getAttribute("aria-describedby").split(" "))assert(q(ref),"Append description target exists");}
    }finally{page.dispose();host.remove();}
  });
  test("file-read: case editing identifies duplicate IDs and row buttons select saved details", async () => {
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html");
    const host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window};
    const page=mountOperationRehearsal(view,()=>{}),q=id=>view.getElementById(id);
    const edit=(id,value)=>{q(id).value=value;q(id).dispatchEvent(new Event("input"));};
    try{
      q("example").click();q("whatif-compare").click();edit("scenario-set-id","case-one");edit("scenario-set-label","比較ケース");
      q("scenario-set-add").click();q("scenario-set-apply").click();assert(q("scenario-set-capacity").textContent.includes("あと11件"));
      q("scenario-set-add").click();assert(document.activeElement===q("scenario-set-id"));assert(q("scenario-set-id").getAttribute("aria-invalid")==="true");assert(q("scenario-set-status").textContent.includes("すでに使われています"));
      edit("scenario-set-id","changed-draft");const button=q("scenario-set-rows").querySelector("button");assert(button?.getAttribute("aria-label").includes("case-one"));button.click();
      assert(document.activeElement===q("scenario-set-select"));assert(q("scenario-set-id").value==="case-one"&&q("scenario-set-label").value==="比較ケース");assert(!q("scenario-set-id").hasAttribute("aria-invalid"));
    }finally{page.dispose();host.remove();}
  });
  test("file-read: rehearsal invalid fields receive native focus and clear after correction", async () => {
    const response=await fetch("/rehearsal/");assert(response.ok);
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html");
    const host=document.importNode(parsed.querySelector("main"),true);document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window};
    const page=mountOperationRehearsal(view,()=>{}),q=id=>view.getElementById(id);
    const edit=(id,value,type="input")=>{q(id).value=value;q(id).dispatchEvent(new Event(type));};
    const marked=(id,status)=>{assert(document.activeElement===q(id),"Focus must identify the failed field");assert(q(id).getAttribute("aria-invalid")==="true");assert(q(id).getAttribute("aria-errormessage")===status);assert(q(id).getAttribute("aria-describedby").split(" ").includes(status));};
    try{
      q("example").click();edit("principal","bad");q("calculate").click();marked("principal","status");
      edit("principal","10");assert(!q("principal").hasAttribute("aria-invalid"));q("calculate").click();assert(!q("save").disabled);
      const before=q("rows").innerHTML;
      edit("whatif-buybackBps","101");q("whatif-compare").click();marked("whatif-buybackBps","whatif-status");
      q("whatif-reset").click();assert(!q("whatif-buybackBps").hasAttribute("aria-invalid"));
      edit("append-kind","deposit","change");edit("append-amount","bad");q("append-preview").click();marked("append-amount","append-summary");assert(q("append-confirm").disabled);
      edit("append-amount","1");q("append-preview").click();assert(!q("append-confirm").disabled);assert(!q("append-amount").hasAttribute("aria-invalid"));assert(q("rows").innerHTML===before,"Invalid drafts and previews preserve committed rows");
    }finally{page.dispose();host.remove();}
  });
  test("file-read: rehearsal related navigation restores its search and focuses the detail chooser", async () => {
    const response=await fetch("/rehearsal/");
    assert(response.ok,"Rehearsal template must be served");
    const parsed=new DOMParser().parseFromString(await response.text(),"text/html");
    const host=document.importNode(parsed.querySelector("main"),true);
    document.body.append(host);
    const view={getElementById:id=>host.querySelector("#"+CSS.escape(id)),createElement:tag=>document.createElement(tag),defaultView:window};
    const page=mountOperationRehearsal(view,()=>{}),q=id=>view.getElementById(id);
    try{
      for(const link of host.querySelectorAll(".file-format-guide a")){
        const href=link.getAttribute("href");
        assert(href.startsWith("#")&&q(href.slice(1)),"Guide links to an existing local section");
      }
      q("example").click();
      q("record-browser-search").value="open-one";
      q("record-browser-search").dispatchEvent(new Event("input"));
      const before=q("rows").innerHTML;
      const button=q("record-browser-related").querySelector("button");
      assert(button?.getAttribute("aria-label").includes("settle-one"),"Related action identifies its destination");
      button.click();
      assert(q("record-browser-select").value==="DAT:settle-one","Related settlement is selected");
      assert(document.activeElement===q("record-browser-select"),"Keyboard focus follows the opened record");
      assert(q("record-browser-search").value===""&&!q("record-browser-back").disabled,"Expanded query exposes a return action");
      q("record-browser-back").click();
      assert(q("record-browser-search").value==="open-one"&&q("record-browser-select").value==="DAT:open-one","Return restores search and selected record");
      assert(q("record-browser-back").disabled&&q("rows").innerHTML===before,"Navigation leaves the source ledger unchanged");
    }finally{page.dispose();host.remove();}
  });

  test("file-read: rehearsal picker guidance is linked and preserves real DOM selection state", async () => {
    const response = await fetch("/rehearsal/");
    assert(response.ok, "Rehearsal template must be served");
    const pageDocument = new DOMParser().parseFromString(await response.text(), "text/html");
    const page = mountOperationRehearsal(pageDocument, () => {});
    const q = id => pageDocument.getElementById(id);
    try {
      q("example").click();
      for (const id of ["file","workspace-file","session-file","scenario-set-file","check-suite-file","report-review-file"]) {
        const picker=q(id),note=q(id+"-note");
        assert(picker instanceof HTMLInputElement, id+" is a native picker");
        assert(note?.getAttribute("role")==="status",id+" has an accessible notice");
        assert(picker.getAttribute("aria-describedby").split(/\s+/).includes(id+"-note"),id+" links its notice");
        picker.dispatchEvent(new Event("cancel"));
        assert(note.textContent.includes("変更していません"),id+" explains unchanged records");
      }
      const picker=q("file"),transfer=new DataTransfer();
      transfer.items.add(new File([JSON.stringify(rehearsalExampleV2("EMA"))],"ema.json",{type:"application/json"}));
      picker.files=transfer.files;
      picker.dispatchEvent(new Event("change",{bubbles:true}));
      assert(q("file-note").textContent==="","New selection clears dismissal");
      for(let i=0;i<200&&q("apply").disabled;i++)await new Promise(resolve=>setTimeout(resolve,10));
      assert(!q("apply").disabled,"Valid File reaches preview");
      assert(picker.files.length===0,"Native FileList was cleared only after capture");
      const preview=q("preview").textContent,status=q("status").textContent;
      picker.dispatchEvent(new Event("cancel"));
      assert(q("preview").textContent===preview&&q("status").textContent===status&&!q("apply").disabled,"Picker dismissal preserves preview authority");
      const currentRows=q("rows").innerHTML;
      q("session-text").value=JSON.stringify(rehearsalExampleV2("EMA"));
      q("session-text").dispatchEvent(new Event("input"));
      q("session-paste").click();
      assert(q("session-status").textContent.includes("記録を保存・再確認"),"Wrong format names the correct section");
      assert(q("session-apply").disabled&&q("rows").innerHTML===currentRows,"Format guidance does not restore data");
      page.dispose();
      picker.dispatchEvent(new Event("cancel"));
      assert(q("file-note").textContent==="","Disposed notices cannot revive");
    } finally {page.dispose();}
  });

  for (const kind of ["settings", "workspace", "history"]) {
    test(`file-read: ${kind} native import clears content before cleanup and contains rejected notifications`, async () => {
      const fields = ["DAT", "EMA", "CAWELON"].map((agent, index) => ({
        agent, account: "0x" + String(index + 1).repeat(40), chainId: 84532,
      }));
      const history = createPortfolioHistory().exportText();
      const draft = fields.map(row => ({ ...row, tokenAddress: "", tokens: "", history }));
      const text = kind === "settings" ? prepareWalletSetupFile({ schema: WALLET_SETUP_SCHEMA, entries: fields }).text
        : kind === "workspace" ? (await prepareWorkspaceFile(workspaceFromDraft(draft))).text : history;
      const file = new File([text], "synthetic.json", { type: "application/json" });
      let reader, observed, notifications = 0;
      const options = { agent: "DAT", onChange() {
        notifications++;
        return Promise.reject(Error("synthetic import observer rejection"));
      }, readBytes(input, config) {
        config.signal.addEventListener("abort", () => { observed = reader.state(); }, { once: true });
        return readSecurityFileBytes(input, config);
      } };
      reader = kind === "settings" ? createWalletSetupFileReader(options)
        : kind === "workspace" ? createWorkspaceFileReader(options) : createHistoryFileReader(options);
      try {
        await reader.load(file);
        assert(reader.state().phase === "ready", "native file accepted");
        reader.cancel();
        assert(observed.phase === (kind === "settings" ? "idle" : "cancelled"), "cleanup sees stopped state");
        assert((observed.result ?? observed.text ?? null) === null, "plaintext absent during cleanup");
        await tick();
        await reader.load(file);
        assert(reader.state().phase === "ready", "fresh selection succeeds");
        assert(notifications === 5, "bounded reading/ready/stop/reading/ready notifications");
      } finally { reader.dispose(); }
      await tick();
      let nested, stopOnce = false, reads = 0;
      const stoppedOptions = { agent: "DAT", readBytes(input, config) {
        reads++;
        return readSecurityFileBytes(input, config);
      }, onChange(state) {
        if (state.phase === "reading" && !stopOnce) { stopOnce = true; reader.cancel(); }
        else if (state.phase === (kind === "settings" ? "idle" : "cancelled")) nested = reader.load(file);
      } };
      reader = kind === "settings" ? createWalletSetupFileReader(stoppedOptions)
        : kind === "workspace" ? createWorkspaceFileReader(stoppedOptions) : createHistoryFileReader(stoppedOptions);
      try {
        await reader.load(file); await nested;
        assert(reads === 0, "deferred stop delivery cannot start another native read");
        assert((reader.state().result ?? reader.state().text ?? null) === null, "no revoked import revived");
      } finally { reader.dispose(); }
    });
  }

  for (const kind of ["settings", "workspace"]) {
    test(`file-read: ${kind} inaccessible error cannot wedge the panel or overwrite its draft`, async () => {
      const parent = document.createElement("section");
      document.body.append(parent);
      const fields = ["DAT", "EMA", "CAWELON"].map((agent, index) => ({
        agent, account: "0x" + String(index + 1).repeat(40), chainId: 84532,
      }));
      const draft = fields.map(row => ({ ...row, tokenAddress: "", tokens: "",
        history: createPortfolioHistory().exportText() }));
      const prepared = kind === "settings" ? prepareWalletSetupFile({ schema: WALLET_SETUP_SCHEMA, entries: fields })
        : await prepareWorkspaceFile(workspaceFromDraft(draft));
      const prefix = kind === "settings" ? "wallet-setup-" : "workspace-";
      const field = suffix => parent.querySelector("." + prefix + suffix);
      let reads = 0, accesses = 0, writes = 0;
      const failure = kind === "settings" ? new WalletSetupError("SETUP_SIZE") : new WorkspaceError("WORKSPACE_FILE_SIZE");
      Object.defineProperty(failure, "code", { get() { accesses++; throw Error("synthetic private diagnostic"); } });
      const readBytes = (input, options) => {
        if (++reads === 1) throw failure;
        return readSecurityFileBytes(input, options);
      };
      const panel = kind === "settings"
        ? mountWalletSetupPanel({ document, parent, readFields: () => fields, applyPlan() { writes++; }, readBytes })
        : mountWorkspacePanel({ document, parent, readDraft: () => draft, writeDraft() { writes++; }, readBytes });
      function choose() {
        const transfer = new DataTransfer();
        transfer.items.add(new File([prepared.text], "synthetic.json", { type: "application/json" }));
        field("file").files = transfer.files;
        field("file").dispatchEvent(new Event("change"));
      }
      async function idle() {
        const start = Date.now();
        while (field("file").disabled && Date.now() - start < 5000) await tick();
        assert(!field("file").disabled, "file input recovers after error");
      }
      try {
        field("json").value = "preserved unfinished draft";
        field("json").dispatchEvent(new Event("input"));
        choose(); await idle();
        assert(accesses === 0, "error accessor not invoked");
        assert(!parent.textContent.includes("private diagnostic"), "private diagnostics absent from DOM");
        assert(field("json").value === "preserved unfinished draft", "original edit preserved");
        assert(field("apply").disabled && writes === 0, "error cannot authorize restore");
        choose(); await idle();
        assert(reads === 2 && field("json").value !== "preserved unfinished draft", "fresh valid import offered");
        assert(field("apply").disabled && writes === 0, "new import still requires review");
      } finally { panel.dispose(); parent.remove(); }
    });
  }

  for (const kind of ["settings", "workspace"]) {
    test(`file-read: ${kind} panel cancellation cannot open a file from cleanup`, async () => {
      const parent = document.createElement("section");
      document.body.append(parent);
      const fields = ["DAT", "EMA", "CAWELON"].map((agent, index) => ({
        agent, account: "0x" + String(index + 1).repeat(40), chainId: 84532,
      }));
      const draft = fields.map(row => ({ ...row, tokenAddress: "", tokens: "",
        history: createPortfolioHistory().exportText() }));
      const prepared = kind === "settings" ? prepareWalletSetupFile({ schema: WALLET_SETUP_SCHEMA, entries: fields })
        : await prepareWorkspaceFile(workspaceFromDraft(draft));
      const gate = deferred();
      const signals = [];
      let applied = 0;
      const prefix = kind === "settings" ? "wallet-setup-" : "workspace-";
      const field = suffix => parent.querySelector("." + prefix + suffix);
      function choose() {
        const transfer = new DataTransfer();
        transfer.items.add(new File([prepared.text], "synthetic.json", { type: "application/json" }));
        field("file").files = transfer.files;
        field("file").dispatchEvent(new Event("change"));
      }
      const readBytes = (file, { signal }) => {
        signals.push(signal);
        if (signals.length === 1) signal.addEventListener("abort", choose, { once: true });
        return gate.promise;
      };
      const panel = kind === "settings"
        ? mountWalletSetupPanel({ document, parent, readFields: () => fields,
          applyPlan() { applied++; }, readBytes })
        : mountWorkspacePanel({ document, parent, readDraft: () => draft,
          writeDraft() { applied++; }, readBytes });
      try {
        field("json").value = "keep this unfinished draft";
        field("json").dispatchEvent(new Event("input"));
        choose();
        assert(signals.length === 1, "first file started");
        field("cancel").click();
        gate.resolve(bytes(prepared.text));
        await tick(); await tick();
        assert(signals.length === 1, "cleanup opened another file");
        assert(signals[0].aborted, "original IO not stopped");
        assert(field("json").value === "keep this unfinished draft", "cancelled result replaced draft");
        assert(!field("file").disabled && field("apply").disabled, "cancelled review state incorrect");
        assert(applied === 0, "file selection applied settings or history");
        // A separate, later selection is still usable and requires fresh review.
        choose();
        const started = Date.now();
        while (field("file").disabled && Date.now() - started < 5000) await tick();
        assert(signals.length === 2 && !field("file").disabled, "explicit new selection could not finish");
        assert(field("json").value !== "keep this unfinished draft", "new draft not offered");
        assert(field("apply").disabled && applied === 0, "new file bypassed review");
      } finally {
        panel.dispose(); gate.resolve(bytes(prepared.text)); parent.remove();
      }
    });
  }

  test("file-read: production screen mounts status without wallet requests", async fixture => {
    const f = fixture();
    const panel = document.querySelector(".file-read-panel");
    assert(panel);
    assert(panel.querySelector("h3").textContent === "ファイル読み込みの保護");
    assert(panel.querySelector(".file-read-headline").getAttribute("aria-live") === "polite");
    assert(panel.querySelector(".file-read-stop").type === "button");
    assert(f.calls.length === 0);
  });

  test("file-read: stop button ends waiter but keeps native reservation", async () => {
    await isolated(async ({ service, start, field, level }) => {
      const operation = start(2);
      await tick();
      assert(level() === "reading");
      field("stop").click();
      assert((await operation.result).code === "FILE_CANCELLED");
      assert(level() === "retained");
      assert(service.state().reservedBytes === 2);
      assert(field("action").textContent.includes("1件"));
      operation.gate.resolve(bytes("ok").buffer);
      await tick();
      assert(level() === "ready");
      assert(service.state().completed === 0);
    });
  });

  test("file-read: four pending reads refuse a fifth without calling it", async () => {
    await isolated(async ({ service, start, level, field }) => {
      const operations = Array.from({ length: 4 }, () => start());
      await tick();
      assert(level() === "limited");
      let calls = 0;
      const refused = await outcome(service.readText({ size: 1, arrayBuffer() { calls++; return new ArrayBuffer(1); } }));
      assert(refused.code === "FILE_BUSY");
      assert(calls === 0);
      field("stop").click();
      assert((await Promise.all(operations.map(item => item.result))).every(item => item.code === "FILE_CANCELLED"));
      assert(level() === "limited");
      operations.forEach(item => item.gate.resolve(new ArrayBuffer(0)));
      await tick();
      assert(level() === "ready");
    });
  });

  test("file-read: byte reservation cap is visible separately from job count", async () => {
    await isolated(async ({ service, start, level, field }) => {
      start(96 * 1024 * 1024);
      start(32 * 1024 * 1024);
      await tick();
      assert(service.state().active === 2);
      assert(level() === "limited");
      assert(field("counts").textContent.includes("134217728 / 134217728"));
      assert(field("scope").textContent.includes("メモリ使用量ではありません"));
    });
  });

  test("file-read: native File stream ignores a broken unused fallback getter", async () => {
    await isolated(async ({ service, level, field }) => {
      const file = new File(["DAT・EMA・CAWELON🔐"], "synthetic.json");
      Object.defineProperty(file, "arrayBuffer", { get() { throw Error("unused fallback"); } });
      assert(await service.readText(file) === "DAT・EMA・CAWELON🔐");
      assert(level() === "ready");
      assert(field("counts").textContent.includes("完了 1件"));
    });
  });

  test("file-read: native stream cancellation releases its browser lock", async () => {
    await isolated(async ({ service, field }) => {
      let cancelled = 0;
      const stream = new ReadableStream({ cancel() { cancelled++; } });
      const result = outcome(service.readText({ size: 1, stream: () => stream }));
      await tick();
      field("stop").click();
      assert((await result).code === "FILE_CANCELLED");
      await tick();
      assert(cancelled === 1);
      assert(!stream.locked);
      assert(service.state().active === 0);
    });
  });

  test("file-read: global protection stop also stops file reads", async fixture => {
    const service = createFileReadService();
    const gate = deferred();
    const f = fixture(undefined, { fileReadService: service });
    const result = outcome(service.readText({ size: 1, arrayBuffer: () => gate.promise }));
    try {
      await tick();
      document.querySelector(".security-stop").click();
      assert((await result).code === "FILE_CANCELLED");
      assert(service.state().retained === 1);
      assert(f.calls.length === 0);
      gate.resolve(new ArrayBuffer(1));
      await tick();
      assert(service.state().completed === 0);
    } finally { service.dispose(); gate.resolve(new ArrayBuffer(0)); }
  });

  test("file-read: clock fault appears without echoing adapter errors", async () => {
    let time = 100;
    await isolated(async ({ service, start, level, field }) => {
      const operation = start();
      await tick();
      time = 99;
      const second = await outcome(service.readText(new File(["x"], "synthetic.json")));
      assert(second.code === "FILE_CLOCK");
      assert((await operation.result).code === "FILE_CLOCK");
      assert(level() === "stopped");
      assert(field("detail").textContent.includes("経過時間"));
      assert(service.state().canStart === false);
    }, { now: () => time });
  });

  test("file-read: throttled timer cannot accept result after deadline", async () => {
    let time = 0;
    await isolated(async ({ service, level }) => {
      const gate = deferred();
      const result = outcome(service.readText({ size: 2, arrayBuffer: () => gate.promise }, { timeoutMs: 10 }));
      await tick(); time = 10;
      gate.resolve(bytes("ok").buffer);
      assert((await result).code === "FILE_TIMEOUT");
      assert(level() === "ready");
      assert(service.state().completed === 0);
    }, { now: () => time, schedule: () => 1, unschedule() {} });
  });

  test("file-read: native settings import keeps existing three-account schema", async () => {
    const prepared = prepareWalletSetupFile({ schema: WALLET_SETUP_SCHEMA,
      entries: ["DAT", "EMA", "CAWELON"].map((agent, i) => ({ agent,
        account: "0x" + String(i + 1).repeat(40), chainId: 84532 })) });
    const reader = createWalletSetupFileReader();
    try {
      await reader.load(new File([prepared.text], prepared.filename));
      assert(reader.state().phase === "ready");
      assert(reader.state().text === prepared.text);
    } finally { reader.dispose(); }
  });

  for (const encoding of [[0xff], [0xc3], [0xf4, 0x90, 0x80, 0x80]]) {
    test("file-read: native malformed UTF-8 is rejected " + encoding, async () => {
      await isolated(async ({ service, field }) => {
        const file = new File([Uint8Array.from(encoding)], "synthetic.json");
        assert((await outcome(service.readText(file))).code === "FILE_ENCODING");
        assert(field("counts").textContent.includes("読み込み失敗 1件"));
        assert(service.state().active === 0);
      });
    });
  }

  test("file-read: partial native stream is rejected without a completed count", async () => {
    await isolated(async ({ service }) => {
      const stream = new ReadableStream({ start(controller) { controller.enqueue(bytes("x")); controller.close(); } });
      assert((await outcome(service.readBytes({ size: 2, stream: () => stream }))).code === "FILE_SIZE");
      assert(service.state().completed === 0);
      assert(!stream.locked);
    });
  });

  test("file-read: stopped panel does not stop a shared service used elsewhere", async () => {
    await isolated(async ({ service, panel, start, host }) => {
      const operation = start(2);
      await tick(); panel.dispose();
      assert(!host.querySelector(".file-read-panel"));
      operation.gate.resolve(bytes("ok").buffer);
      assert((await operation.result).value === "ok");
      assert(service.state().completed === 1);
    });
  });

  test("file-read: detached button cannot cancel later work", async () => {
    await isolated(async ({ service, panel, start, field }) => {
      const button = field("stop");
      panel.dispose();
      const operation = start(2);
      await tick(); button.click();
      assert(service.state().waiting === 1);
      operation.gate.resolve(bytes("ok").buffer);
      assert((await operation.result).value === "ok");
    });
  });

  for (const property of ["name", "path", "content", "account", "debug"]) {
    test("file-read: unknown aggregate field never appears in DOM " + property, async () => {
      const service = createFileReadService();
      const host = document.createElement("div");
      document.body.append(host);
      const input = { ...service.state(), [property]: "<img src=x onerror=alert(1)>private-marker" };
      const panel = mountFileReadPanel({ document, parent: host,
        service: { state: () => input, subscribe(callback) { callback(input); return () => {}; }, cancelAll: () => 0 } });
      try {
        assert(host.querySelector(".file-read-panel").getAttribute("data-level") === "unavailable");
        assert(!host.textContent.includes("private-marker"));
        assert(!host.querySelector("img"));
      } finally { panel.dispose(); host.remove(); service.dispose(); }
    });
  }

  test("file-read: fixed cancellation failure message never displays thrown text", async () => {
    const real = createFileReadService();
    const host = document.createElement("div");
    document.body.append(host);
    const panel = mountFileReadPanel({ document, parent: host, service: {
      state: real.state, subscribe: real.subscribe, cancelAll() { throw Error("private marker"); },
    } });
    try {
      host.querySelector(".file-read-stop").click();
      assert(host.querySelector(".file-read-action").textContent.includes("確認できません"));
      assert(!host.textContent.includes("private marker"));
    } finally { panel.dispose(); host.remove(); real.dispose(); }
  });

  test("file-read: normal demo import cancellation leaves saved browser sentinel intact", async () => {
    await isolated(async ({ service, start, field }) => {
      const key = "threecore-test-file-boundary-" + crypto.randomUUID();
      localStorage.setItem(key, "synthetic preserved data");
      try {
        const operation = start();
        await tick(); field("stop").click(); await operation.result;
        assert(localStorage.getItem(key) === "synthetic preserved data");
        assert(service.state().cancelled === 1);
      } finally { localStorage.removeItem(key); }
    });
  });
}
